/**
 * DEV-ONLY in-memory backend so the full UI (including the real Excalidraw
 * editor) can be exercised in a plain browser with `npm run dev`. It mirrors
 * the Rust commands' behavior closely enough for UI testing; it is never
 * included in production builds (see main.tsx).
 *
 * The virtual filesystem persists in localStorage so "relaunching" (reload)
 * can be tested. Dialog results can be queued via `window.__mockDialog.push()`.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

type Entry = { kind: "file"; content: string; mtime: number; b64?: boolean } | { kind: "dir"; mtime: number };

const HOME = "/Users/me";
const DATA = `${HOME}/Library/Application Support/com.local.whiteboard`;
const KEY = "whiteboard.mockfs";

const fs = new Map<string, Entry>();
let clock = Date.now();
const now = () => (clock = Math.max(clock + 1, Date.now()));

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) for (const [k, v] of JSON.parse(raw)) fs.set(k, v);
  } catch {
    /* ignore */
  }
}
let saveTimer: number | undefined;
function persist() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...fs.entries()]));
    } catch (e) {
      console.warn("mock fs persist failed", e);
    }
  }, 50);
}

const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

function mkdirp(p: string) {
  const parts = p.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur += "/" + part;
    if (!fs.has(cur)) fs.set(cur, { kind: "dir", mtime: now() });
  }
}

function write(p: string, content: string, b64 = false) {
  mkdirp(parent(p));
  fs.set(p, { kind: "file", content, mtime: now(), b64 });
  persist();
}

function children(dir: string) {
  return [...fs.keys()].filter((k) => parent(k) === dir);
}

function scan(dir: string): any[] {
  const folders: any[] = [];
  const boards: any[] = [];
  for (const p of children(dir)) {
    const e = fs.get(p)!;
    const name = base(p);
    if (name.startsWith(".")) continue;
    if (e.kind === "dir") folders.push({ name, path: p, kind: "folder", mtime: e.mtime, children: scan(p) });
    else if (name.endsWith(".excalidraw")) boards.push({ name: name.replace(/\.excalidraw$/, ""), path: p, kind: "board", mtime: e.mtime });
  }
  const sort = (a: any, b: any) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  return [...folders.sort(sort), ...boards.sort(sort)];
}

function moveTree(from: string, to: string) {
  for (const k of [...fs.keys()]) {
    if (k === from || k.startsWith(from + "/")) {
      const e = fs.get(k)!;
      fs.delete(k);
      fs.set(to + k.slice(from.length), e);
    }
  }
  mkdirp(parent(to));
  persist();
}

function fnv(path: string) {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(path)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

const err = (code: string, msg: string) => Promise.reject(`${code}: ${msg}`);

function validScene(content: string) {
  try {
    const v = JSON.parse(content);
    return v.type === "excalidraw" && Array.isArray(v.elements);
  } catch {
    return false;
  }
}

function snapshots(path: string) {
  const dir = `${DATA}/history/${fnv(path)}`;
  return children(dir)
    .map((p) => ({ id: Number(base(p).replace(".excalidraw", "")), size: (fs.get(p) as any).content.length }))
    .sort((a, b) => b.id - a.id);
}

/** A generated PNG standing in for remote thumbnails / screenshots. */
function fakePng(w: number, h: number, color: string, label: string) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#fff";
  g.font = `bold ${Math.round(h / 6)}px sans-serif`;
  g.textAlign = "center";
  g.fillText(label, w / 2, h / 2 + h / 18);
  return c.toDataURL("image/png").split(",")[1];
}

const linkCache = new Map<string, any>();
async function mockPreview(url: string, refresh: boolean) {
  if (!refresh && linkCache.has(url)) return linkCache.get(url);
  await new Promise((r) => setTimeout(r, 700)); // network latency
  const base = { url, title: null, author: null, description: null, siteName: null, image: null, favicon: null, fetchedAt: Date.now() };
  let p: any;
  if (url.includes("offline")) p = { ...base, kind: "web", status: "offline" };
  else if (/youtu/.test(url)) {
    p = url.includes("deleted")
      ? { ...base, kind: "youtube", siteName: "YouTube", description: "Video unavailable", status: "unavailable" }
      : { ...base, kind: "youtube", siteName: "YouTube", title: "How We Grew to 10K Users Without Paid Ads — Founder Story", author: "Acme Startup", image: { data: fakePng(320, 180, "#364fc7", "▶ video"), mime: "image/png" }, status: "ok" };
  } else if (/instagram/.test(url)) p = { ...base, kind: "instagram", status: "unavailable" };
  else if (url.includes("noog")) p = { ...base, kind: "web", title: "Plain Page Without Metadata", status: "partial" };
  else p = { ...base, kind: "web", title: "Product Hunt – The best new products in tech.", description: "Product Hunt is a curation of the best new products, every day.", siteName: "Product Hunt", image: { data: fakePng(600, 314, "#da552f", "og:image"), mime: "image/png" }, favicon: { data: fakePng(32, 32, "#da552f", "P"), mime: "image/png" }, status: "ok" };
  if (p.status === "ok" || p.status === "partial") linkCache.set(url, p);
  return p;
}

const dialogQueue: unknown[] = [];
(window as any).__mockDialog = dialogQueue;
(window as any).__mockfs = fs;

const handlers: Record<string, (a: any) => unknown> = {
  app_paths: () => ({
    dataDir: DATA,
    defaultRoot: `${HOME}/Documents/Whiteboard`,
    templatesDir: `${DATA}/templates`,
    libraryFile: `${DATA}/library.excalidrawlib`,
    stateFile: `${DATA}/state.json`,
  }),
  take_pending_opens: () => [],
  quit_app: () => {
    console.info("[mock] quit_app");
    (window as any).__quit = true;
  },
  read_text: ({ path }) => {
    const e = fs.get(path);
    if (!e || e.kind !== "file") return err("NOT_FOUND", `read: ${path}`);
    return { content: e.b64 ? atob(e.content) : e.content, mtime: e.mtime };
  },
  write_board: ({ path, content, expectedMtime }) => {
    if (!validScene(content)) return err("INVALID", "not an Excalidraw scene");
    const e = fs.get(path);
    if (expectedMtime != null) {
      if (!e) return err("NOT_FOUND", `${path} no longer exists`);
      if (e.mtime !== expectedMtime) return err("CONFLICT", `${path} changed on disk`);
    }
    write(path, content);
    return fs.get(path)!.mtime;
  },
  write_text: ({ path, content }) => (write(path, content), fs.get(path)!.mtime),
  write_base64: ({ path, data }) => void write(path, data, true),
  read_base64: ({ path }) => {
    const e = fs.get(path);
    if (!e || e.kind !== "file") return err("NOT_FOUND", path);
    return e.b64 ? e.content : btoa(unescape(encodeURIComponent(e.content)));
  },
  stat_path: ({ path }) => {
    const e = fs.get(path);
    return e ? { exists: true, mtime: e.mtime, size: e.kind === "file" ? e.content.length : 0, is_dir: e.kind === "dir" } : { exists: false, mtime: 0, size: 0, is_dir: false };
  },
  scan_tree: ({ root }) => (mkdirp(root), persist(), scan(root)),
  create_folder: ({ path }) => (fs.has(path) ? err("EXISTS", path) : (mkdirp(path), persist(), null)),
  create_board: ({ path, content }) => {
    if (!validScene(content)) return err("INVALID", "not a scene");
    if (fs.has(path)) return err("EXISTS", path);
    write(path, content);
    return fs.get(path)!.mtime;
  },
  move_path: ({ from, to }) => {
    if (!fs.has(from)) return err("NOT_FOUND", from);
    if (fs.has(to) && from.toLowerCase() !== to.toLowerCase()) return err("EXISTS", to);
    moveTree(from, to);
    return null;
  },
  copy_file: ({ from, to }) => {
    const e = fs.get(from);
    if (!e || e.kind !== "file") return err("NOT_FOUND", from);
    if (fs.has(to)) return err("EXISTS", to);
    write(to, e.content, e.b64);
    return null;
  },
  unique_path: ({ dir, base: b, ext }) => {
    const suffix = ext ? `.${ext}` : "";
    let c = `${dir}/${b}${suffix}`;
    let n = 2;
    while (fs.has(c)) c = `${dir}/${b} ${n++}${suffix}`;
    return c;
  },
  locate_file: () => null,
  thumb_info: ({ paths }) =>
    paths.map((p: string) => {
      const t = `${DATA}/thumbs/${fnv(p)}.png`;
      const te = fs.get(t);
      const be = fs.get(p);
      return { path: p, thumb: te ? t : null, thumbMtime: te?.mtime ?? 0, boardMtime: be?.mtime ?? 0, exists: !!be };
    }),
  thumb_write: ({ path, data }) => {
    const t = `${DATA}/thumbs/${fnv(path)}.png`;
    write(t, data, true);
    return t;
  },
  history_snapshot: ({ path, content, minIntervalMs }) => {
    const list = snapshots(path);
    const latest = list[0];
    if (latest && now() - latest.id < minIntervalMs) return false;
    if (latest && (fs.get(`${DATA}/history/${fnv(path)}/${latest.id}.excalidraw`) as any)?.content === content) return false;
    write(`${DATA}/history/${fnv(path)}/${now()}.excalidraw`, content);
    return true;
  },
  history_list: ({ path }) => snapshots(path),
  history_read: ({ path, id }) => (fs.get(`${DATA}/history/${fnv(path)}/${id}.excalidraw`) as any)?.content ?? err("NOT_FOUND", "snapshot"),
  rekey_paths: ({ pairs }) => {
    for (const [a, b] of pairs) {
      moveTree(`${DATA}/history/${fnv(a)}`, `${DATA}/history/${fnv(b)}`);
      if (fs.has(`${DATA}/thumbs/${fnv(a)}.png`)) moveTree(`${DATA}/thumbs/${fnv(a)}.png`, `${DATA}/thumbs/${fnv(b)}.png`);
    }
    return null;
  },
  trash_item: ({ path }) => {
    if (!fs.has(path)) return err("NOT_FOUND", path);
    const id = String(now());
    const dest = `${DATA}/trash/${id}/${base(path)}`;
    const kind = fs.get(path)!.kind === "dir" ? "folder" : "board";
    moveTree(path, dest);
    const entry = { id, name: base(path).replace(/\.excalidraw$/, ""), originalPath: path, kind, deletedAt: Date.now(), trashedPath: dest };
    write(`${DATA}/trash/${id}/.trash.json`, JSON.stringify(entry));
    return entry;
  },
  trash_list: () =>
    children(`${DATA}/trash`)
      .map((d) => JSON.parse((fs.get(`${d}/.trash.json`) as any)?.content ?? "null"))
      .filter(Boolean)
      .sort((a: any, b: any) => b.deletedAt - a.deletedAt),
  trash_restore: ({ id }) => {
    const entry = JSON.parse((fs.get(`${DATA}/trash/${id}/.trash.json`) as any).content);
    let target = entry.originalPath;
    let n = 2;
    while (fs.has(target)) target = entry.originalPath.replace(/(\.excalidraw)?$/, ` (restored ${n++})$1`);
    moveTree(entry.trashedPath, target);
    for (const k of [...fs.keys()]) if (k.startsWith(`${DATA}/trash/${id}`)) fs.delete(k);
    persist();
    return target;
  },
  trash_delete: ({ id }) => {
    for (const k of [...fs.keys()]) if (k === `${DATA}/trash/${id}` || k.startsWith(`${DATA}/trash/${id}/`)) fs.delete(k);
    persist();
    return null;
  },
  trash_empty: () => {
    for (const k of [...fs.keys()]) if (k.startsWith(`${DATA}/trash/`)) fs.delete(k);
    persist();
    return null;
  },
  search_text: ({ root, query }) => {
    const q = query.toLowerCase();
    const hits: any[] = [];
    for (const [p, e] of fs) {
      if (!p.startsWith(root) || !p.endsWith(".excalidraw") || e.kind !== "file") continue;
      try {
        const text = JSON.parse(e.content).elements.filter((el: any) => !el.isDeleted && el.text).map((el: any) => el.text).join(" · ");
        const i = text.toLowerCase().indexOf(q);
        if (i >= 0) hits.push({ path: p, snippet: text.slice(Math.max(0, i - 30), i + 50) });
      } catch {
        /* skip */
      }
    }
    return hits;
  },
  update_menu: () => null,
  board_digests: ({ root }) => {
    const out: any[] = [];
    for (const [p, e] of fs) {
      if (!p.startsWith(root) || !p.endsWith(".excalidraw") || e.kind !== "file") continue;
      try {
        const els = JSON.parse(e.content).elements.filter((x: any) => !x.isDeleted);
        const own = els.filter((x: any) => !x.customData?.wbRef);
        const texts = own.filter((x: any) => x.text).map((x: any) => ({ t: x.text.replace(/\s+/g, " "), size: x.fontSize ?? 20, raw: x.text }));
        const todos = texts.flatMap((x: any) => x.raw.split("\n")).map((l: string) => l.trim().match(/^(?:todo:?|next:|\[ \]|☐)\s*(.{3,})$/i)?.[1]).filter(Boolean);
        out.push({
          path: p,
          mtime: e.mtime,
          text: texts.map((x: any) => x.t).join(" · "),
          headings: [...own.filter((x: any) => x.type === "frame" && x.name).map((x: any) => x.name), ...texts.filter((x: any) => x.t.length <= 60 && x.size >= ([...texts].map((t: any) => t.size).sort((a: number, b: number) => a - b)[Math.floor(texts.length / 2)] ?? 20) * 1.4).sort((a: any, b: any) => b.size - a.size).slice(0, 5).map((x: any) => x.t)],
          todos,
          arrows: els.filter((x: any) => x.type === "arrow").length,
          elements: els.length,
        });
      } catch {
        /* skip */
      }
    }
    return out;
  },
  local_ai: () => null,
  local_ai_models: () => null,
  link_preview: ({ url, refresh }) => mockPreview(url, refresh),
  screen_capture_access: () => true,
  open_screen_recording_settings: () => null,
  set_global_capture_shortcut: () => null,
  capture_screen: async ({ mode }) => {
    await new Promise((r) => setTimeout(r, 300));
    return (window as any).__mockCaptureCancel ? null : fakePng(mode === "screen" ? 1600 : 640, mode === "screen" ? 1000 : 360, "#2b8a3e", `screenshot (${mode})`);
  },
  clipboard_image_png: () => fakePng(400, 240, "#862e9c", "clipboard image"),
  "plugin:clipboard-manager|read_text": () => (window as any).__mockClipboardText ?? "",
  "plugin:clipboard-manager|write_text": ({ text }) => ((window as any).__mockClipboardText = text, null),
  "plugin:dialog|open": () => dialogQueue.shift() ?? null,
  "plugin:dialog|save": () => dialogQueue.shift() ?? null,
  "plugin:dialog|ask": () => dialogQueue.shift() ?? true,
  "plugin:dialog|confirm": () => dialogQueue.shift() ?? true,
  "plugin:dialog|message": () => true,
  "plugin:opener|open_url": ({ url }) => console.info("[mock] open url", url),
  "plugin:opener|reveal_item_in_dir": ({ paths }) => console.info("[mock] reveal", paths),
  "plugin:app|version": () => "1.0.0-dev",
};

load();
if (!fs.size) {
  // A normal Excalidraw file "downloaded" from elsewhere, for compatibility tests.
  write(
    `${HOME}/Downloads/sample.excalidraw`,
    JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [
        { id: "r1", type: "rectangle", x: 100, y: 100, width: 200, height: 100, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: { type: 3 }, seed: 1, version: 3, versionNonce: 1, isDeleted: false, boundElements: [{ id: "t1", type: "text" }], updated: 1, link: null, locked: false, index: "a0" },
        { id: "t1", type: "text", x: 150, y: 137, width: 100, height: 25, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 2, version: 3, versionNonce: 2, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, text: "Hello world", fontSize: 20, fontFamily: 5, textAlign: "center", verticalAlign: "middle", containerId: "r1", originalText: "Hello world", autoResize: true, lineHeight: 1.25, index: "a1" },
      ],
      appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
      files: {},
    }),
  );
}

mockWindows("main");
mockIPC(
  (cmd, args) => {
    const h = handlers[cmd];
    if (h) return h(args ?? {});
    if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) return null;
    console.warn("[mock] unhandled command", cmd, args);
    return null;
  },
  { shouldMockEvents: true },
);
const blobUrls = new Map<string, string>();
(window as any).__TAURI_INTERNALS__.convertFileSrc = (p: string) => {
  const e = fs.get(p);
  if (!e || e.kind !== "file") return "";
  const key = `${p}@${e.mtime}`;
  if (!blobUrls.has(key)) {
    const bin = atob(e.content);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    blobUrls.set(key, URL.createObjectURL(new Blob([bytes], { type: "image/png" })));
  }
  return blobUrls.get(key)!;
};
console.info("[mock] Whiteboard dev backend installed");
