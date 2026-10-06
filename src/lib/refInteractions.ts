/**
 * Canvas interactions for references, layered in front of Excalidraw with
 * capture-phase listeners that only act in specific cases and otherwise let
 * Excalidraw behave normally:
 *
 *  - paste a single URL           → web reference card (instead of text/iframe)
 *  - paste an image, pointer off  → image (Excalidraw ignores pastes unless the
 *    the canvas                     pointer is over the canvas)
 *  - paste with nothing readable  → read the clipboard image natively
 *  - drop a link from a browser   → card at the drop point
 *  - double-click a card          → open the link (single click/drag never does)
 *  - right-click a card           → short card menu
 *  - "/" on the canvas            → command palette with slash commands
 */
import { activeTab, getApp, setApp } from "../state/store";
import { activeSession, editorContainer } from "../editor/registry";
import { clientToScene } from "./canvasInsert";
import { insertClipboardImage, insertImageBlob } from "./capture";
import {
  cardAt,
  convertToPlainLink,
  copyRef,
  deleteCard,
  duplicateCard,
  insertWebReference,
  openRef,
  parseLink,
  refreshCard,
  removePreview,
  selectCard,
  type WbRef,
} from "./webref";
import { openContextMenu } from "../shell/ContextMenu";

const lastClient = { x: -1, y: -1 };

function isWritable(el: Element | null) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

/** Active editor container, if the canvas (or nothing) has focus and no overlay is open. */
function activeCanvasContext() {
  const s = getApp();
  if (s.dialog || s.page || s.quickLook || s.mode !== "brainstorm") return null;
  const tab = activeTab();
  const session = activeSession();
  const container = tab && editorContainer(tab.id);
  if (!session?.api || !container) return null;
  const a = document.activeElement;
  if (isWritable(a)) return null;
  if (a && a !== document.body && !container.contains(a)) return null;
  return { session, api: session.api, container };
}

function eventOnVisibleCanvas(e: Event) {
  const t = e.target as Element | null;
  return t instanceof HTMLCanvasElement && !!t.closest(".editor-slot.visible");
}

function linkFromDataTransfer(dt: DataTransfer | null): string | null {
  if (!dt) return null;
  const uriList = dt.getData("text/uri-list");
  const first = uriList
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  return parseLink(first) ?? parseLink(dt.getData("text/plain"));
}

function hasImage(dt: DataTransfer | null) {
  if (!dt) return false;
  return Array.from(dt.items ?? []).some((i) => i.kind === "file" && i.type.startsWith("image/"));
}

function pointerOverCanvas(container: HTMLElement) {
  const el = document.elementFromPoint(lastClient.x, lastClient.y);
  return el instanceof HTMLCanvasElement && container.contains(el);
}

function onPaste(e: ClipboardEvent) {
  const ctx = activeCanvasContext();
  if (!ctx) return;
  const dt = e.clipboardData;
  const types = Array.from(dt?.types ?? []);
  // Images (screenshots, copied images) take priority over any URL text.
  if (hasImage(dt)) {
    if (pointerOverCanvas(ctx.container)) return; // Excalidraw's own image paste
    const file = Array.from(dt!.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void insertImageBlob(ctx.session, file);
    return;
  }
  // Excalidraw clipboard content (copied shapes) is JSON text: leave it alone.
  const text = dt?.getData("text/plain") ?? "";
  const url = parseLink(text);
  if (url) {
    e.preventDefault();
    e.stopImmediatePropagation();
    void insertWebReference(ctx.session, url);
    return;
  }
  if (!types.length || (!text && !types.some((t) => t.startsWith("text/")))) {
    // WebKit sometimes exposes nothing for images copied in other apps.
    e.preventDefault();
    e.stopImmediatePropagation();
    void insertClipboardImage({ quiet: true });
  }
}

function onDragOver(e: DragEvent) {
  const types = Array.from(e.dataTransfer?.types ?? []);
  if (!types.includes("Files") && types.includes("text/uri-list") && eventOnVisibleCanvas(e)) e.preventDefault();
}

function onDrop(e: DragEvent) {
  const dt = e.dataTransfer;
  if (!dt || !eventOnVisibleCanvas(e)) return;
  const types = Array.from(dt.types);
  if (types.includes("Files") || types.some((t) => t.includes("excalidraw"))) return; // Excalidraw handles
  const url = linkFromDataTransfer(dt);
  const session = activeSession();
  if (!url || !session?.api) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  void insertWebReference(session, url, clientToScene(session.api, e.clientX, e.clientY));
}

function cardUnderEvent(e: MouseEvent): WbRef | null {
  if (!eventOnVisibleCanvas(e)) return null;
  const api = activeSession()?.api;
  if (!api) return null;
  const st = api.getAppState() as any;
  if (st.editingTextElement || st.newElement || st.activeTool?.type !== "selection") return null;
  return cardAt(api, clientToScene(api, e.clientX, e.clientY));
}

function onDoubleClick(e: MouseEvent) {
  const ref = cardUnderEvent(e);
  if (!ref) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  openRef(ref);
}

export function cardMenuItems(ref: WbRef) {
  const session = activeSession();
  if (!session) return [];
  return [
    { label: "Open Link", onSelect: () => openRef(ref) },
    { label: "Copy URL", onSelect: () => void copyRef(ref) },
    { label: "Refresh Preview", onSelect: () => void refreshCard(session, ref) },
    "separator" as const,
    { label: "Duplicate", onSelect: () => duplicateCard(session, ref) },
    { label: "Remove Preview", onSelect: () => removePreview(session, ref) },
    { label: "Convert to Plain Link", onSelect: () => convertToPlainLink(session, ref) },
    "separator" as const,
    { label: "Delete", danger: true, onSelect: () => deleteCard(session, ref) },
  ];
}

function onContextMenu(e: MouseEvent) {
  const ref = cardUnderEvent(e);
  if (!ref) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const api = activeSession()!.api!;
  selectCard(api, ref.cardId);
  openContextMenu(e, cardMenuItems(ref));
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || !e.isTrusted) return;
  const ctx = activeCanvasContext();
  if (!ctx) return;
  const st = ctx.api.getAppState() as any;
  if (st.editingTextElement || st.openDialog) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  setApp({ dialog: { kind: "palette", query: "/" } });
}

export function installRefInteractions() {
  window.addEventListener("pointermove", (e) => {
    lastClient.x = e.clientX;
    lastClient.y = e.clientY;
  }, { passive: true, capture: true });
  window.addEventListener("paste", onPaste, true);
  window.addEventListener("dragover", onDragOver, true);
  window.addEventListener("drop", onDrop, true);
  window.addEventListener("dblclick", onDoubleClick, true);
  window.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("keydown", onKeyDown, true);
}
