/**
 * Web reference cards: a pasted YouTube / Instagram / website link becomes a
 * small card made of ordinary Excalidraw elements — a rounded rectangle, an
 * optional thumbnail image, and text — grouped together. They save, export
 * to PNG/SVG and open in plain Excalidraw like any other drawing.
 *
 * Each element carries `customData.wbRef` (Excalidraw's official field for
 * app metadata) with the card id and URL; the card's rectangle also gets the
 * standard Excalidraw `link`, so the link works even outside Whiteboard.
 */
import {
  CaptureUpdateAction,
  FONT_FAMILY,
  convertToExcalidrawElements,
  getCommonBounds,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ipc, type LinkPreview } from "../platform/ipc";
import type { BoardSession } from "../editor/BoardSession";
import {
  base64ToBlob,
  fileData,
  insertionPoint,
  prepareImage,
  type PreparedImage,
  type ScenePoint,
} from "./canvasInsert";
import { toast } from "./toast";

export type RefKind = "youtube" | "instagram" | "web";

export interface WbRef {
  cardId: string;
  url: string;
  kind: RefKind;
  role: "card" | "thumb" | "title" | "subtitle" | "source" | "favicon" | "status";
}

// ------------------------------------------------------------- URL parsing

/** Returns a normalized http(s) URL if `text` is exactly one link. */
export function parseLink(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t || /\s/.test(t) || t.length > 2048) return null;
  const candidate = /^https?:\/\//i.test(t)
    ? t
    : /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t)
      ? `https://${t}`
      : null;
  if (!candidate) return null;
  try {
    const u = new URL(candidate);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function classify(url: string): { kind: RefKind; host: string; label: string; color: string } {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (/(^|\.)youtube\.com$|^youtu\.be$|youtube-nocookie\.com$/.test(host)) {
    return { kind: "youtube", host, label: "YouTube", color: "#e03131" };
  }
  if (/(^|\.)instagram\.com$/.test(host)) {
    return { kind: "instagram", host, label: "Instagram", color: "#c2255c" };
  }
  return { kind: "web", host, label: host, color: "#868e96" };
}

function instagramKindLabel(url: string) {
  const p = new URL(url).pathname;
  if (/\/reels?\//.test(p)) return "Reel";
  if (/\/p\//.test(p)) return "Post";
  if (/\/stories\//.test(p)) return "Story";
  const seg = p.split("/").filter(Boolean);
  return seg.length === 1 ? `@${seg[0]}` : "Link";
}

export function shortUrl(url: string, max = 52) {
  const u = new URL(url);
  const s = (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "") + u.search).replace(/\?$/, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// --------------------------------------------------------------- layout

const W = 280;
const PAD = 12;
const INNER = W - PAD * 2;
const TEXT = "#1e1e1e";
const MUTED = "#868e96";
let measureCtx: CanvasRenderingContext2D | null = null;

function textWidth(text: string, size: number) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * size * 0.55;
  measureCtx.font = `${size}px Nunito, Assistant, sans-serif`;
  return measureCtx.measureText(text).width;
}

/** Word-wraps to `width`, keeping at most `lines` lines (ellipsis on overflow). */
function wrap(text: string, size: number, width: number, lines: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, size) <= width || !cur) {
      cur = next;
    } else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  let result = out.slice(0, lines);
  if (out.length > lines) {
    let last = result[lines - 1];
    while (last.length > 1 && textWidth(`${last}…`, size) > width) last = last.slice(0, -1);
    result[lines - 1] = `${last.trimEnd()}…`;
  }
  // A single overlong word (e.g. a URL) still needs hard truncation.
  result = result.map((line) => {
    if (textWidth(line, size) <= width) return line;
    let l = line;
    while (l.length > 1 && textWidth(`${l}…`, size) > width) l = l.slice(0, -1);
    return `${l}…`;
  });
  return result.join("\n");
}

interface CardSpec {
  cardId: string;
  url: string;
  kind: RefKind;
  image?: PreparedImage | null;
  favicon?: PreparedImage | null;
  title?: string | null;
  subtitle?: string | null;
  source?: string | null;
  sourceColor: string;
  /** Placeholder band shown instead of a thumbnail (fallback cards). */
  band?: { label: string; color: string; bg: string } | null;
  status?: string | null;
  /** Taller thumbnails allowed (Instagram is often square/portrait). */
  tallImage?: boolean;
}

function newCardId() {
  return `ref-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Builds card elements with their top-left at `origin`. */
function buildCard(spec: CardSpec, origin: ScenePoint): ExcalidrawElement[] {
  const ref = (role: WbRef["role"]): { wbRef: WbRef } => ({
    wbRef: { cardId: spec.cardId, url: spec.url, kind: spec.kind, role },
  });
  const parts: ExcalidrawElement[] = [];
  let y = origin.y + PAD;

  if (spec.band && !spec.image) {
    const BAND_H = 64;
    const [band] = convertToExcalidrawElements(
      [
        {
          type: "rectangle",
          x: origin.x + PAD,
          y,
          width: INNER,
          height: BAND_H,
          strokeColor: "transparent",
          backgroundColor: spec.band.bg,
          fillStyle: "solid",
          roughness: 0,
          roundness: { type: 3 },
        } as any,
      ],
      { regenerateIds: true },
    );
    const [label] = convertToExcalidrawElements(
      [
        {
          type: "text",
          x: 0,
          y: 0,
          text: spec.band.label,
          fontSize: 18,
          fontFamily: FONT_FAMILY.Nunito,
          strokeColor: spec.band.color,
        } as any,
      ],
      { regenerateIds: true },
    );
    parts.push(
      { ...band, customData: ref("thumb") } as ExcalidrawElement,
      {
        ...label,
        x: origin.x + PAD + (INNER - label.width) / 2,
        y: y + (BAND_H - label.height) / 2,
        customData: ref("thumb"),
      } as ExcalidrawElement,
    );
    y += BAND_H + 10;
  }

  if (spec.image) {
    const maxH = spec.tallImage ? 300 : 180;
    let iw = INNER;
    let ih = (spec.image.height / spec.image.width) * iw;
    if (ih > maxH) {
      iw *= maxH / ih;
      ih = maxH;
    }
    const [img] = convertToExcalidrawElements(
      [
        {
          type: "image",
          fileId: spec.image.fileId,
          x: origin.x + PAD + (INNER - iw) / 2,
          y,
          width: iw,
          height: ih,
        } as any,
      ],
      { regenerateIds: true },
    );
    parts.push({ ...img, customData: ref("thumb") } as ExcalidrawElement);
    y += ih + 10;
  }

  const addText = (text: string, size: number, color: string, role: WbRef["role"], dx = 0) => {
    const [t] = convertToExcalidrawElements(
      [
        {
          type: "text",
          x: origin.x + PAD + dx,
          y,
          text,
          fontSize: size,
          fontFamily: FONT_FAMILY.Nunito,
          strokeColor: color,
        } as any,
      ],
      { regenerateIds: true },
    );
    parts.push({ ...t, customData: ref(role) } as ExcalidrawElement);
    y += t.height + 4;
  };

  if (spec.title) addText(wrap(spec.title, 16, INNER, 2), 16, TEXT, "title");
  if (spec.subtitle) addText(wrap(spec.subtitle, 13, INNER, spec.title ? 1 : 2), 13, MUTED, "subtitle");

  // Source line: favicon + label.
  let dx = 0;
  if (spec.favicon) {
    const [fav] = convertToExcalidrawElements(
      [{ type: "image", fileId: spec.favicon.fileId, x: origin.x + PAD, y: y + 1, width: 14, height: 14 } as any],
      { regenerateIds: true },
    );
    parts.push({ ...fav, customData: ref("favicon") } as ExcalidrawElement);
    dx = 20;
  }
  if (spec.source) addText(wrap(spec.source, 12, INNER - dx, 1), 12, spec.sourceColor, "source", dx);
  if (spec.status) addText(wrap(spec.status, 12, INNER, 1), 12, MUTED, "status");

  const height = y - origin.y + PAD - 4;
  const [rect] = convertToExcalidrawElements(
    [
      {
        type: "rectangle",
        x: origin.x,
        y: origin.y,
        width: W,
        height,
        strokeColor: "#ced4da",
        backgroundColor: "#ffffff",
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: 0,
        roundness: { type: 3 },
      } as any,
    ],
    { regenerateIds: true },
  );
  const groupId = `${spec.cardId}-g`;
  return [{ ...rect, link: spec.url, customData: ref("card") } as ExcalidrawElement, ...parts].map(
    (el) => ({ ...el, groupIds: [groupId] }) as ExcalidrawElement,
  );
}

// ------------------------------------------------------- scene helpers

export function refOf(el: ExcalidrawElement | undefined): WbRef | null {
  const r = (el?.customData as any)?.wbRef;
  return r && typeof r.cardId === "string" && typeof r.url === "string" ? (r as WbRef) : null;
}

function cardElements(api: ExcalidrawImperativeAPI, cardId: string) {
  return api.getSceneElements().filter((e) => refOf(e)?.cardId === cardId);
}

/** The card (if any) the current selection belongs to. */
export function selectedCard(api: ExcalidrawImperativeAPI): WbRef | null {
  const ids = api.getAppState().selectedElementIds;
  for (const el of api.getSceneElements()) {
    if (ids[el.id]) {
      const r = refOf(el);
      if (r) return r;
    }
  }
  return null;
}

/** Topmost card under a scene point. */
export function cardAt(api: ExcalidrawImperativeAPI, p: ScenePoint): WbRef | null {
  const els = api.getSceneElements();
  for (let i = els.length - 1; i >= 0; i--) {
    const r = refOf(els[i]);
    if (!r || r.role !== "card") continue;
    const [x1, y1, x2, y2] = getCommonBounds([els[i]]);
    if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) return r;
  }
  return null;
}

export function selectCard(api: ExcalidrawImperativeAPI, cardId: string) {
  const els = cardElements(api, cardId);
  if (!els.length) return;
  api.updateScene({
    appState: {
      selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true])),
      selectedGroupIds: { [`${cardId}-g`]: true },
    } as any,
  });
}

/** Replaces a card's elements in place (keeping its position). */
function replaceCard(
  api: ExcalidrawImperativeAPI,
  cardId: string,
  make: (origin: ScenePoint) => ExcalidrawElement[],
): boolean {
  const old = cardElements(api, cardId);
  const rect = old.find((e) => refOf(e)?.role === "card");
  if (!rect) return false; // deleted by the user meanwhile
  const wasSelected = old.some((e) => api.getAppState().selectedElementIds[e.id]);
  const next = make({ x: rect.x, y: rect.y });
  const oldIds = new Set(old.map((e) => e.id));
  const elements = api
    .getSceneElementsIncludingDeleted()
    .map((e) => (oldIds.has(e.id) ? newElementWith(e as any, { isDeleted: true }) : e));
  // Insert the new card where the old one was in the stacking order.
  const at = elements.findIndex((e) => oldIds.has(e.id));
  elements.splice(at < 0 ? elements.length : at, 0, ...next);
  api.updateScene({
    elements,
    ...(wasSelected
      ? {
          appState: {
            selectedElementIds: Object.fromEntries(next.map((e) => [e.id, true])),
            selectedGroupIds: { [`${next[0].groupIds[0]}`]: true },
          } as any,
        }
      : {}),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return true;
}

function addCard(api: ExcalidrawImperativeAPI, elements: ExcalidrawElement[]) {
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...elements],
    appState: {
      selectedElementIds: Object.fromEntries(elements.map((e) => [e.id, true])),
      selectedGroupIds: { [elements[0].groupIds[0]]: true },
    } as any,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

// --------------------------------------------------- preview → card spec

async function toImage(img: LinkPreview["image"], opts: { maxSide: number; jpeg?: boolean }) {
  if (!img) return null;
  try {
    return await prepareImage(base64ToBlob(img.data, img.mime), {
      maxSide: opts.maxSide,
      preferJpeg: opts.jpeg,
      maxBytes: 400_000,
    });
  } catch {
    return null; // undecodable image: just skip it
  }
}

async function specFromPreview(cardId: string, url: string, p: LinkPreview | null): Promise<CardSpec> {
  const c = classify(url);
  const base = { cardId, url, kind: c.kind, sourceColor: c.color };
  const offline = p?.status === "offline";
  const rich = p && (p.status === "ok" || p.status === "partial");

  if (c.kind === "youtube") {
    if (rich) {
      return {
        ...base,
        image: await toImage(p!.image, { maxSide: 640, jpeg: true }),
        title: p!.title ?? "YouTube video",
        subtitle: p!.author,
        source: "YouTube",
      };
    }
    return {
      ...base,
      band: { label: "▶  YouTube", color: "#e03131", bg: "#fff5f5" },
      title: offline ? "YouTube video" : (p?.description ?? "YouTube video"),
      subtitle: shortUrl(url),
      status: offline ? "Preview unavailable offline" : "Open Link ↗",
    };
  }

  if (c.kind === "instagram") {
    if (rich && (p!.image || p!.title)) {
      return {
        ...base,
        image: await toImage(p!.image, { maxSide: 640, jpeg: true }),
        tallImage: true,
        title: p!.author ? `@${p!.author.replace(/^@/, "")}` : p!.title,
        subtitle: p!.description,
        source: `Instagram ${instagramKindLabel(url)}`,
      };
    }
    return {
      ...base,
      band: { label: "Instagram", color: "#c2255c", bg: "#fff0f6" },
      title: `Instagram ${instagramKindLabel(url)}`,
      subtitle: shortUrl(url),
      status: offline ? "Preview unavailable offline" : "Open Link ↗",
    };
  }

  if (rich) {
    const favicon = await toImage(p!.favicon, { maxSide: 64 });
    return {
      ...base,
      image: await toImage(p!.image, { maxSide: 720, jpeg: true }),
      favicon,
      title: p!.title ?? c.host,
      subtitle: p!.description && p!.description !== p!.title ? p!.description : null,
      source: p!.siteName && p!.siteName.toLowerCase() !== c.host ? `${p!.siteName} · ${c.host}` : c.host,
    };
  }
  return {
    ...base,
    title: c.host,
    subtitle: shortUrl(url),
    status: offline ? "Preview unavailable offline" : "Open Link ↗",
  };
}

function addFilesFor(api: ExcalidrawImperativeAPI, spec: CardSpec) {
  const files = [spec.image, spec.favicon].filter(Boolean).map((i) => fileData(i!));
  if (files.length) api.addFiles(files);
}

// ------------------------------------------------------------- actions

/**
 * Inserts a card for `url` at `at` (or the pointer / viewport center).
 * Cached previews appear instantly; otherwise a light placeholder is shown
 * and replaced when the preview arrives. Never throws.
 */
export async function insertWebReference(session: BoardSession, rawUrl: string, at?: ScenePoint) {
  const api = session.api;
  const url = parseLink(rawUrl);
  if (!api) return;
  if (!url) {
    toast("That doesn't look like a web link.");
    return;
  }
  const point = at ?? insertionPoint(session);
  const cardId = newCardId();
  const origin = { x: point.x - W / 2, y: point.y - 40 };
  const c = classify(url);

  // Show a placeholder unless the preview comes back almost immediately (cache).
  let placed = false;
  const placeholderTimer = window.setTimeout(() => {
    addCard(
      api,
      buildCard(
        {
          cardId,
          url,
          kind: c.kind,
          title: null,
          subtitle: "Loading preview…",
          source: c.kind === "web" ? c.host : c.label,
          sourceColor: c.color,
        },
        origin,
      ),
    );
    placed = true;
  }, 120);

  let preview: LinkPreview | null = null;
  try {
    preview = await ipc.linkPreview(url, false);
  } catch {
    preview = null;
  }
  window.clearTimeout(placeholderTimer);
  const spec = await specFromPreview(cardId, url, preview);
  if (!session.api) return;
  addFilesFor(api, spec);
  if (placed) replaceCard(api, cardId, (o) => buildCard(spec, o));
  else addCard(api, buildCard(spec, origin));
}

export async function refreshCard(session: BoardSession, ref: WbRef) {
  const api = session.api;
  if (!api) return;
  replaceCard(api, ref.cardId, (o) =>
    buildCard(
      {
        cardId: ref.cardId,
        url: ref.url,
        kind: ref.kind,
        subtitle: "Refreshing preview…",
        source: classify(ref.url).label,
        sourceColor: MUTED,
      },
      o,
    ),
  );
  let preview: LinkPreview | null = null;
  try {
    preview = await ipc.linkPreview(ref.url, true);
  } catch {
    preview = null;
  }
  const spec = await specFromPreview(ref.cardId, ref.url, preview);
  addFilesFor(api, spec);
  replaceCard(api, ref.cardId, (o) => buildCard(spec, o));
  if (preview?.status === "offline") toast("You're offline — showing a basic link card.");
}

/** Keeps the card but drops the thumbnail/favicon (a compact link card). */
export function removePreview(session: BoardSession, ref: WbRef) {
  const api = session.api;
  if (!api) return;
  const els = cardElements(api, ref.cardId);
  const text = (role: string) => (els.find((e) => refOf(e)?.role === role) as any)?.text?.replace(/\n/g, " ") ?? null;
  const c = classify(ref.url);
  replaceCard(api, ref.cardId, (o) =>
    buildCard(
      {
        cardId: ref.cardId,
        url: ref.url,
        kind: ref.kind,
        title: text("title") ?? c.host,
        subtitle: shortUrl(ref.url),
        source: c.kind === "web" ? null : c.label,
        sourceColor: c.color,
      },
      o,
    ),
  );
}

/** Replaces the card with a single plain text link. */
export function convertToPlainLink(session: BoardSession, ref: WbRef) {
  const api = session.api;
  if (!api) return;
  replaceCard(api, ref.cardId, (o) => {
    const [t] = convertToExcalidrawElements(
      [
        {
          type: "text",
          x: o.x,
          y: o.y,
          text: ref.url,
          fontSize: 16,
          fontFamily: FONT_FAMILY.Nunito,
          strokeColor: "#1971c2",
        } as any,
      ],
      { regenerateIds: true },
    );
    return [{ ...t, link: ref.url, groupIds: [`${ref.cardId}-g`] } as ExcalidrawElement];
  });
}

export function duplicateCard(session: BoardSession, ref: WbRef) {
  const api = session.api;
  if (!api) return;
  const els = cardElements(api, ref.cardId);
  const cardId = newCardId();
  const gid = `${cardId}-g`;
  const copies = els.map((e) => {
    const [copy] = convertToExcalidrawElements([{ ...e, x: e.x + 24, y: e.y + 24 } as any], { regenerateIds: true });
    const r = refOf(e)!;
    return { ...copy, groupIds: [gid], customData: { wbRef: { ...r, cardId } }, link: e.link } as ExcalidrawElement;
  });
  addCard(api, copies);
}

export function deleteCard(session: BoardSession, ref: WbRef) {
  const api = session.api;
  if (!api) return;
  const ids = new Set(cardElements(api, ref.cardId).map((e) => e.id));
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((e) => (ids.has(e.id) ? newElementWith(e as any, { isDeleted: true }) : e)),
    appState: { selectedElementIds: {}, selectedGroupIds: {} } as any,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

export function openRef(ref: WbRef) {
  openUrl(ref.url).catch(() => toast("Couldn't open the link.", "error"));
}

export async function copyRef(ref: WbRef) {
  try {
    await writeText(ref.url);
  } catch {
    await navigator.clipboard?.writeText(ref.url).catch(() => {});
  }
  toast("Link copied");
}
