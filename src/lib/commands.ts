/**
 * Command registry shared by keyboard shortcuts, the native menu bar and the
 * Cmd+K palette.
 *
 * Shortcut routing on macOS: a key press may reach the web page as a keydown,
 * fire the native menu item with the same accelerator, or both. Whiteboard
 * commands are handled on keydown (capture phase, before Excalidraw) and the
 * matching menu event is ignored if it arrives right after. Excalidraw's own
 * shortcuts (undo, zoom, select all…) are left to Excalidraw; their menu items
 * only act when the key press did not already reach and get handled by the page.
 */
import { listen } from "@tauri-apps/api/event";
import { activeTab, getApp, setApp, effectiveTheme, type ThemePref } from "../state/store";
import { schedulePersist } from "../state/persist";
import { activeSession, editorContainer } from "../editor/registry";
import { focusEditor } from "../editor/BoardEditor";
import {
  activateTab,
  closeTab,
  cycleTab,
  newBoard,
  newFolder,
  openBoard,
  openWithDialog,
  reopenClosed,
  reveal,
  saveActive,
  setDesignBoard,
  saveAs,
  saveAsTemplate,
} from "./boards";
import { copyPNG, exportPNG, exportSVG } from "./exporting";
import { importLibraryFile } from "./library";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { requestQuit } from "./lifecycle";
import { captureScreenshot, insertClipboardImage, replaceSelectedImage } from "./capture";
import { convertToPlainLink, copyRef, openRef, refreshCard, removePreview, selectedCard, type WbRef } from "./webref";
import { toast } from "./toast";
import type { BoardSession } from "../editor/BoardSession";
import { openSendToAction } from "../action/bridge";
import { setMode } from "../shell/ModeSwitch";

/** Runs `fn` on the selected web reference card, if any. */
function withCard(fn: (ref: WbRef, session: BoardSession) => unknown) {
  const session = activeSession();
  const ref = session?.api ? selectedCard(session.api) : null;
  if (!session || !ref) {
    toast("Select a link card first.");
    return;
  }
  return fn(ref, session);
}

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  keywords?: string;
  /** Shown in the Cmd+K palette. */
  palette?: boolean;
  needsBoard?: boolean;
  /** Slash aliases typed on the canvas, e.g. "/shot". */
  slash?: string[];
  run: () => unknown;
}

const hasBoard = () => !!activeTab() && getApp().mode === "brainstorm";
const toBrainstorm = () => getApp().mode !== "brainstorm" && setMode("brainstorm");

function setTheme(theme: ThemePref) {
  setApp((s) => ({ prefs: { ...s.prefs, theme } }));
  schedulePersist();
}

export function toggleFocusMode(on?: boolean) {
  const next = on ?? !getApp().focusMode;
  setApp({ focusMode: next, quickLook: null });
  const tab = activeTab();
  if (tab) window.setTimeout(() => focusEditor(tab.id), 50);
}

export function toggleSidebar() {
  const s = getApp();
  if (s.focusMode) setApp({ focusMode: false, sidebarCollapsed: false });
  else setApp({ sidebarCollapsed: !s.sidebarCollapsed });
  schedulePersist();
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

/** Sends a synthetic key press to the active Excalidraw instance. */
export function forwardKey(init: KeyboardEventInit) {
  const tab = activeTab();
  const el = tab && editorContainer(tab.id);
  if (!el) return;
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

function editOrForward(execName: string, init: KeyboardEventInit) {
  if (isEditable(document.activeElement)) document.execCommand(execName);
  else forwardKey(init);
}

export const commands: Command[] = [
  { id: "new-board", title: "New Board", shortcut: "⌘N", palette: true, keywords: "create", run: () => newBoard() },
  {
    id: "new-from-template",
    title: "New Board from Template…",
    shortcut: "⌥⌘N",
    palette: true,
    keywords: "template mind map swot flow",
    run: () => setApp({ dialog: { kind: "templates" } }),
  },
  {
    id: "new-design",
    title: "New Design…",
    shortcut: "⌥⌘D",
    palette: true,
    keywords: "wireframe mockup ui screen app layout design kit",
    run: () => setApp({ dialog: { kind: "templates", tab: "design" } }),
  },
  {
    id: "toggle-design",
    title: "Show/Hide Design Panel for This Board",
    palette: true,
    needsBoard: true,
    keywords: "design kit wireframe components ui",
    run: () => {
      const t = activeTab();
      if (t) setDesignBoard(t.path, !getApp().designBoards.includes(t.path));
    },
  },
  {
    id: "new-folder",
    title: "New Folder",
    shortcut: "⇧⌘N",
    palette: true,
    keywords: "workspace create",
    run: () => newFolder(),
  },
  {
    id: "open",
    title: "Open File…",
    shortcut: "⌘O",
    palette: true,
    keywords: "import excalidraw",
    run: openWithDialog,
  },
  { id: "save", title: "Save", shortcut: "⌘S", needsBoard: true, run: saveActive },
  { id: "save-as", title: "Save As…", shortcut: "⇧⌘S", palette: true, needsBoard: true, run: saveAs },
  { id: "save-as-template", title: "Save Board as Template", palette: true, needsBoard: true, run: saveAsTemplate },
  {
    id: "close-tab",
    title: "Close Board",
    shortcut: "⌘W",
    palette: true,
    needsBoard: true,
    run: () => {
      const t = activeTab();
      if (t) void closeTab(t.id);
    },
  },
  { id: "reopen-closed", title: "Reopen Closed Board", shortcut: "⇧⌘T", palette: true, run: reopenClosed },
  { id: "export-png", title: "Export PNG…", palette: true, needsBoard: true, keywords: "image", run: exportPNG },
  { id: "export-svg", title: "Export SVG…", palette: true, needsBoard: true, keywords: "image vector", run: exportSVG },
  {
    id: "copy-png",
    title: "Copy Board as PNG",
    palette: true,
    needsBoard: true,
    keywords: "clipboard image",
    run: copyPNG,
  },
  {
    id: "export-dialog",
    title: "Export Image Options…",
    shortcut: "⇧⌘E",
    palette: true,
    needsBoard: true,
    run: () => forwardKey({ key: "E", code: "KeyE", metaKey: true, shiftKey: true }),
  },
  {
    id: "import-library",
    title: "Import Library…",
    palette: true,
    keywords: "excalidrawlib shapes",
    run: async () => {
      const p = await openDialog({ filters: [{ name: "Excalidraw Library", extensions: ["excalidrawlib", "json"] }] });
      if (typeof p === "string") await importLibraryFile(p);
    },
  },
  {
    id: "history",
    title: "Show Version History",
    shortcut: "⌘Y",
    palette: true,
    needsBoard: true,
    keywords: "versions restore snapshot",
    run: () => setApp((s) => ({ historyOpen: !s.historyOpen })),
  },
  {
    id: "reveal",
    title: "Show in Finder",
    palette: true,
    needsBoard: true,
    run: () => {
      const t = activeTab();
      if (t) void reveal(t.path);
    },
  },
  { id: "toggle-sidebar", title: "Toggle Sidebar", shortcut: "⌘\\", palette: true, run: toggleSidebar },
  {
    id: "focus-mode",
    title: "Toggle Focus Mode",
    shortcut: "⇧⌘F",
    palette: true,
    keywords: "zen distraction",
    run: () => toggleFocusMode(),
  },
  {
    id: "toggle-theme",
    title: "Toggle Theme",
    palette: true,
    keywords: "dark light",
    run: () => setTheme(effectiveTheme(getApp()) === "dark" ? "light" : "dark"),
  },
  { id: "theme-light", title: "Theme: Light", run: () => setTheme("light") },
  { id: "theme-dark", title: "Theme: Dark", run: () => setTheme("dark") },
  { id: "theme-system", title: "Theme: Match System", palette: true, run: () => setTheme("system") },
  { id: "home", title: "Go to Home", palette: true, run: () => setApp({ page: "home" }) },
  { id: "show-recents", title: "Show Recents", palette: true, run: () => setApp({ page: "recents" }) },
  { id: "show-favorites", title: "Show Favorites", palette: true, run: () => setApp({ page: "favorites" }) },
  { id: "show-archive", title: "Show Archive", palette: true, run: () => setApp({ page: "archive" }) },
  { id: "show-trash", title: "Show Trash", palette: true, run: () => setApp({ page: "trash" }) },
  {
    id: "settings",
    title: "Settings…",
    shortcut: "⌘,",
    palette: true,
    keywords: "preferences",
    run: () => setApp({ dialog: { kind: "settings" } }),
  },
  {
    id: "shortcuts",
    title: "Keyboard Shortcuts",
    shortcut: "⌘/",
    palette: true,
    keywords: "help keys",
    run: () => setApp({ dialog: { kind: "shortcuts" } }),
  },
  {
    id: "licenses",
    title: "Licenses & Acknowledgements",
    palette: true,
    run: () => setApp({ dialog: { kind: "licenses" } }),
  },
  {
    id: "add-link",
    title: "Add Link to Selection",
    shortcut: "",
    palette: true,
    needsBoard: true,
    keywords: "url hyperlink",
    run: () => forwardKey({ key: "k", code: "KeyK", metaKey: true }),
  },
  {
    id: "find-on-canvas",
    title: "Find on Canvas",
    shortcut: "⌘F",
    palette: true,
    needsBoard: true,
    keywords: "search text",
    run: () => forwardKey({ key: "f", code: "KeyF", metaKey: true }),
  },
  {
    id: "zoom-in",
    title: "Zoom In",
    shortcut: "⌘+",
    needsBoard: true,
    run: () => forwardKey({ key: "=", code: "Equal", metaKey: true }),
  },
  {
    id: "zoom-out",
    title: "Zoom Out",
    shortcut: "⌘−",
    needsBoard: true,
    run: () => forwardKey({ key: "-", code: "Minus", metaKey: true }),
  },
  {
    id: "zoom-reset",
    title: "Actual Size",
    shortcut: "⌘0",
    needsBoard: true,
    run: () => forwardKey({ key: "0", code: "Digit0", metaKey: true }),
  },
  {
    id: "zoom-fit",
    title: "Zoom to Fit",
    shortcut: "⇧1",
    palette: true,
    needsBoard: true,
    run: () => forwardKey({ key: "!", code: "Digit1", shiftKey: true }),
  },
  { id: "undo", title: "Undo", run: () => editOrForward("undo", { key: "z", code: "KeyZ", metaKey: true }) },
  {
    id: "redo",
    title: "Redo",
    run: () => editOrForward("redo", { key: "z", code: "KeyZ", metaKey: true, shiftKey: true }),
  },
  {
    id: "select-all",
    title: "Select All",
    run: () => editOrForward("selectAll", { key: "a", code: "KeyA", metaKey: true }),
  },
  { id: "next-tab", title: "Next Tab", run: () => cycleTab(1) },
  { id: "prev-tab", title: "Previous Tab", run: () => cycleTab(-1) },
  // ---- Brainstorm ⇄ Action
  {
    id: "toggle-mode",
    title: "Switch Brainstorm / Action",
    shortcut: "⇧⌘A",
    palette: true,
    keywords: "mode execute do",
    run: () => setMode(getApp().mode === "action" ? "brainstorm" : "action"),
  },
  {
    id: "mode-brainstorm",
    title: "Go to Brainstorm",
    palette: true,
    keywords: "boards canvas",
    run: () => setMode("brainstorm"),
  },
  {
    id: "mode-action",
    title: "Go to Action",
    palette: true,
    keywords: "today priorities tasks",
    run: () => setMode("action"),
  },
  {
    id: "send-to-action",
    title: "Send Selection to Action…",
    shortcut: "⌥⌘A",
    palette: true,
    needsBoard: true,
    keywords: "priority next move milestone blocker task",
    run: () => openSendToAction(),
  },
  {
    id: "make-priority",
    title: "Make Priority from Selection…",
    palette: true,
    needsBoard: true,
    keywords: "today action",
    run: () => openSendToAction("priority"),
  },
  {
    id: "make-move",
    title: "Make Next Move from Selection…",
    palette: true,
    needsBoard: true,
    keywords: "action",
    run: () => openSendToAction("move"),
  },
  {
    id: "make-milestone",
    title: "Make Milestone from Selection…",
    palette: true,
    needsBoard: true,
    keywords: "action date",
    run: () => openSendToAction("milestone"),
  },
  {
    id: "make-blocker",
    title: "Make Blocker from Selection…",
    palette: true,
    needsBoard: true,
    keywords: "action",
    run: () => openSendToAction("blocker"),
  },
  {
    id: "show-journey",
    title: "Open Startup Journey",
    palette: true,
    keywords: "check-in history log",
    run: () => {
      setMode("action");
      setApp({ actionTab: "journey" });
    },
  },
  {
    id: "check-in",
    title: "Daily Check-in",
    palette: true,
    keywords: "journey evening review",
    run: () => {
      setMode("action");
      setApp({ actionTab: "plan" });
    },
  },
  // ---- references & capture
  {
    id: "insert-web-ref",
    title: "Insert Web Reference…",
    palette: true,
    slash: ["/embed", "/url"],
    keywords: "link url bookmark card embed",
    run: () => setApp({ dialog: { kind: "insert-link", variant: "web" } }),
  },
  {
    id: "add-youtube",
    title: "Add YouTube Link…",
    palette: true,
    slash: ["/youtube"],
    keywords: "video embed",
    run: () => setApp({ dialog: { kind: "insert-link", variant: "youtube" } }),
  },
  {
    id: "add-instagram",
    title: "Add Instagram Link…",
    palette: true,
    slash: ["/instagram"],
    keywords: "reel post embed",
    run: () => setApp({ dialog: { kind: "insert-link", variant: "instagram" } }),
  },
  {
    id: "capture-region",
    title: "Capture Screenshot",
    shortcut: "⇧⌘2",
    palette: true,
    slash: ["/shot"],
    keywords: "screenshot region capture screen grab",
    run: () => (toBrainstorm(), captureScreenshot("region")),
  },
  {
    id: "capture-window",
    title: "Capture Window",
    palette: true,
    slash: ["/window"],
    keywords: "screenshot",
    run: () => (toBrainstorm(), captureScreenshot("window")),
  },
  {
    id: "capture-screen",
    title: "Capture Full Screen",
    palette: true,
    slash: ["/screen"],
    keywords: "screenshot",
    run: () => (toBrainstorm(), captureScreenshot("screen")),
  },
  {
    id: "paste-image",
    title: "Insert Image from Clipboard",
    palette: true,
    slash: ["/paste"],
    keywords: "screenshot paste picture",
    run: () => (toBrainstorm(), insertClipboardImage()),
  },
  {
    id: "replace-image",
    title: "Replace Selected Image…",
    palette: true,
    needsBoard: true,
    keywords: "swap picture",
    run: replaceSelectedImage,
  },
  {
    id: "open-link",
    title: "Open Link",
    palette: true,
    needsBoard: true,
    keywords: "url browser reference",
    run: () => withCard((r) => openRef(r)),
  },
  {
    id: "copy-link",
    title: "Copy Link",
    palette: true,
    needsBoard: true,
    keywords: "url reference",
    run: () => withCard((r) => copyRef(r)),
  },
  {
    id: "refresh-link",
    title: "Refresh Link Preview",
    palette: true,
    needsBoard: true,
    keywords: "reference reload",
    run: () => withCard((r, s) => refreshCard(s, r)),
  },
  {
    id: "remove-link-preview",
    title: "Remove Link Preview",
    palette: true,
    needsBoard: true,
    keywords: "reference thumbnail",
    run: () => withCard((r, s) => removePreview(s, r)),
  },
  {
    id: "plain-link",
    title: "Convert to Plain Link",
    palette: true,
    needsBoard: true,
    keywords: "reference text url",
    run: () => withCard((r, s) => convertToPlainLink(s, r)),
  },
  {
    id: "palette",
    title: "Search Boards & Commands",
    shortcut: "⌘K",
    run: () => setApp((s) => ({ dialog: s.dialog?.kind === "palette" ? null : { kind: "palette" } })),
  },
  {
    id: "clear-recents",
    title: "Clear Recents",
    run: () => {
      setApp({ recents: [] });
      schedulePersist();
    },
  },
  { id: "quit", title: "Quit", run: requestQuit },
];

const byId = new Map(commands.map((c) => [c.id, c]));

export function runCommand(id: string) {
  if (id.startsWith("recent:")) return void openBoard(id.slice(7));
  if (id.startsWith("tab:")) {
    const n = Number(id.slice(4));
    const tabs = getApp().tabs;
    const tab = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
    if (tab) activateTab(tab.id);
    return;
  }
  const cmd = byId.get(id);
  if (!cmd || (cmd.needsBoard && !hasBoard())) return;
  void Promise.resolve(cmd.run()).catch((e) => console.error(`command ${id} failed`, e));
}

// ------------------------------------------------------------ keyboard

/** Whiteboard-owned shortcuts, keyed by normalized combo. */
const KEYMAP: Record<string, string> = {
  "mod+n": "new-board",
  "mod+t": "new-board",
  "mod+alt+n": "new-from-template",
  "mod+alt+d": "new-design",
  "mod+shift+n": "new-folder",
  "mod+o": "open",
  "mod+s": "save",
  "mod+shift+s": "save-as",
  "mod+w": "close-tab",
  "mod+shift+t": "reopen-closed",
  "mod+k": "palette",
  "mod+\\": "toggle-sidebar",
  "mod+shift+f": "focus-mode",
  "mod+y": "history",
  "mod+,": "settings",
  "mod+/": "shortcuts",
  "mod+shift+2": "capture-region",
  "mod+shift+a": "toggle-mode",
  "mod+alt+a": "send-to-action",
  "ctrl+tab": "next-tab",
  "ctrl+shift+tab": "prev-tab",
};
for (let n = 1; n <= 9; n++) KEYMAP[`mod+${n}`] = `tab:${n}`;

const CODE_KEYS: Record<string, string> = {
  Backslash: "\\",
  Comma: ",",
  Slash: "/",
  Tab: "tab",
  Escape: "escape",
  Equal: "=",
  Minus: "-",
};

export function comboOf(e: KeyboardEvent): string {
  let key = CODE_KEYS[e.code];
  if (!key) {
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else key = e.key.toLowerCase();
  }
  const parts = [];
  if (e.metaKey) parts.push("mod");
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

let lastKeyCommand = { id: "", at: 0 };
let lastKeydown = { combo: "", at: 0, prevented: false };

/** Returns true when the canvas has nothing Escape would cancel. */
function editorIsIdle(): boolean {
  const api = activeSession()?.api;
  if (!api) return true;
  const st = api.getAppState() as any;
  return (
    Object.keys(st.selectedElementIds ?? {}).length === 0 &&
    !st.editingTextElement &&
    !st.newElement &&
    !st.multiElement &&
    !st.openMenu &&
    !st.openPopup &&
    !st.openDialog &&
    !st.contextMenu &&
    (st.activeTool?.type ?? "selection") === "selection"
  );
}

function onKeyDownCapture(e: KeyboardEvent) {
  if (!e.isTrusted) return; // our own forwarded events
  const combo = comboOf(e);
  const s = getApp();

  if (combo === "escape") {
    if (s.quickLook) {
      setApp({ quickLook: null });
      e.preventDefault();
      e.stopPropagation();
    } else if (s.focusMode && !s.dialog && !isEditable(e.target as Element) && editorIsIdle()) {
      toggleFocusMode(false);
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }

  const id = KEYMAP[combo];
  if (!id) {
    // A key pressed while nothing has focus (e.g. right after a click on the
    // shell), or while focus is still in a tab that was just hidden, belongs
    // to the visible canvas: hand it to the active editor.
    const target = e.target as Element | null;
    const stray =
      !target ||
      target === document.body ||
      target === document.documentElement ||
      !!target.closest?.(".editor-slot:not(.visible)");
    if (stray && !s.dialog && !s.page && s.mode === "brainstorm") {
      const tab = activeTab();
      const el = tab && editorContainer(tab.id);
      if (el && !el.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
        el.focus({ preventScroll: true });
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: e.key,
            code: e.code,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }
    return;
  }
  // In text fields, leave text-editing combos alone.
  if (isEditable(e.target as Element) && (combo === "mod+/" || combo === "mod+y")) return;
  e.preventDefault();
  e.stopPropagation();
  lastKeyCommand = { id: id.startsWith("tab:") ? id : id, at: performance.now() };
  runCommand(id);
}

function onKeyDownBubble(e: KeyboardEvent) {
  if (!e.isTrusted) return;
  lastKeydown = { combo: comboOf(e), at: performance.now(), prevented: e.defaultPrevented };
}

const PASSTHROUGH_COMBOS: Record<string, string> = {
  undo: "mod+z",
  redo: "mod+shift+z",
  "select-all": "mod+a",
  "zoom-in": "mod+=",
  "zoom-out": "mod+-",
  "zoom-reset": "mod+0",
  "find-on-canvas": "mod+f",
  "export-dialog": "mod+shift+e",
};

function onMenu(id: string) {
  const now = performance.now();
  if (lastKeyCommand.id === id && now - lastKeyCommand.at < 500) return;
  const combo = PASSTHROUGH_COMBOS[id];
  if (combo && lastKeydown.combo === combo && now - lastKeydown.at < 500 && lastKeydown.prevented) return;
  runCommand(id);
}

export async function installCommandRouting() {
  window.addEventListener("keydown", onKeyDownCapture, true);
  window.addEventListener("keydown", onKeyDownBubble, false);
  await listen<string>("menu", (e) => onMenu(e.payload));
}
