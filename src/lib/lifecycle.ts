/**
 * App startup, session restore, quitting safely, OS file-open events, drag &
 * drop from Finder, external-change polling, and native menu syncing.
 */
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { ipc } from "../platform/ipc";
import { mergeLibraryItems } from "@excalidraw/excalidraw";
import { parseScene } from "../editor/scene";
import { effectiveTheme, getApp, newTabId, setApp, useApp, type Tab } from "../state/store";
import { loadPersisted, mergeDefaults, persistNow, schedulePersist, viewports } from "../state/persist";
import { sessions, activeSession } from "../editor/registry";
import { newBoard, openBoard, refreshTree, seedLibrary } from "./boards";
import { libraryItems, loadLibrary, onLibraryChange } from "./library";
import { boardName } from "./paths";
import { toast } from "./toast";
import { installRefInteractions } from "./refInteractions";
import { flushAction, loadAction } from "../action/store";
import { installSendToActionMenu } from "../action/bridge";

export async function bootstrap() {
  const paths = await ipc.appPaths();
  const persisted = await loadPersisted(paths.stateFile);
  const firstLaunch = !persisted;
  const m = mergeDefaults(persisted, paths.defaultRoot);
  Object.assign(viewports, m.viewports);

  // Restore tabs that still exist; only the active one mounts right away.
  let tabs: Tab[] = [];
  let activeTabId: string | null = null;
  if (m.prefs.reopenSession) {
    const stats = await Promise.all(m.tabs.map((p) => ipc.stat(p)));
    tabs = m.tabs.filter((_, i) => stats[i].exists).map((path) => ({ id: newTabId(), path }));
    activeTabId = tabs.find((t) => t.path === m.activePath)?.id ?? tabs[0]?.id ?? null;
  }

  setApp({
    paths,
    prefs: m.prefs,
    favorites: m.favorites,
    archived: m.archived,
    recents: m.recents,
    expanded: m.expanded,
    sidebarWidth: m.sidebarWidth,
    sidebarCollapsed: m.sidebarCollapsed,
    mode: m.mode,
    designBoards: m.designBoards,
    closedStack: m.closedStack,
    tabs,
    activeTabId,
    mounted: activeTabId ? { [activeTabId]: true } : {},
    page: null,
  });

  if (firstLaunch) await seedLibrary();
  await Promise.all([refreshTree(), loadLibrary(), loadAction()]);
  setApp({ ready: true });
  if (firstLaunch) await persistNow();

  installListeners();
  const pending = await ipc.takePendingOpens();
  for (const p of pending) await openBoard(p);
}

// ------------------------------------------------------------- quitting

let quitting = false;

/** Flushes every open board, saves session state, then exits. */
export async function requestQuit() {
  if (quitting) return;
  quitting = true;
  try {
    const failed: string[] = [];
    await Promise.all(
      [...sessions.values()].map(async (s) => {
        const ok = await Promise.race([s.flush(), new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]);
        if (!ok && s.isDirty) failed.push(boardName(s.path));
      }),
    );
    if (failed.length) {
      const quit = await ask(
        `Some changes couldn't be saved (${failed.join(", ")}). Quit anyway and lose them?`,
        { title: "Unsaved changes", kind: "warning", okLabel: "Quit Anyway", cancelLabel: "Don't Quit" },
      );
      if (!quit) {
        quitting = false;
        return;
      }
    }
    await persistNow();
    await flushAction();
  } catch (e) {
    console.error("error while quitting", e);
  }
  await ipc.quitApp();
}

// ----------------------------------------------------------- listeners

const BOARD_FILE = /\.excalidraw$/i;

/**
 * Drops are handled by Excalidraw itself (images, SVG, libraries, library
 * items dragged from its sidebar). Whiteboard only steps in for:
 *  - `.excalidraw` files: open as a tab instead of replacing the current board
 *  - drops outside the canvas (sidebar, home screen)
 */
async function openDroppedBoard(file: File) {
  const root = getApp().prefs.libraryRoot;
  const hints = [root, ...getApp().recents.map((r) => r.path.slice(0, r.path.lastIndexOf("/")))];
  const path = await ipc.locateFile(file.name, file.size, file.lastModified, [...new Set(hints)]);
  if (path) return openBoard(path);
  // Couldn't find the original on disk: import a copy into the library.
  const content = await file.text();
  try {
    parseScene(content);
  } catch (e) {
    toast(e instanceof Error ? e.message : "That file couldn't be opened.", "error");
    return;
  }
  const created = await newBoard({ folder: root, content, name: boardName(file.name) });
  if (created) toast(`Imported a copy of “${file.name}” into Whiteboard`);
}

function installDropHandling() {
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
  // Capture phase: claim .excalidraw files before Excalidraw's drop handler.
  window.addEventListener(
    "drop",
    (e) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      const boards = files.filter((f) => BOARD_FILE.test(f.name));
      if (!boards.length) return;
      e.preventDefault();
      e.stopPropagation();
      for (const f of boards) void openDroppedBoard(f);
    },
    true,
  );
  // Bubble phase: anything nobody handled (dropped outside the canvas).
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (e.defaultPrevented || !hasFiles(e)) return;
    e.preventDefault();
    for (const f of Array.from(e.dataTransfer?.files ?? [])) {
      if (/\.excalidrawlib$/i.test(f.name)) {
        void f.text().then(async (t) => {
          const { loadLibraryFromBlob } = await import("@excalidraw/excalidraw");
          const items = await loadLibraryFromBlob(new Blob([t]), "unpublished");
          onLibraryChange(mergeLibraryItems(libraryItems(), items));
          toast(`Added ${items.length} item${items.length === 1 ? "" : "s"} to your library`);
        }).catch(() => toast("That file isn't a valid Excalidraw library.", "error"));
      } else {
        toast("Open a board, then drop images onto its canvas.");
      }
    }
  });
}

function applyGlobalCaptureShortcut(enabled: boolean) {
  ipc.setGlobalCaptureShortcut(enabled).catch(() => {
    if (enabled) toast("⌘⇧2 is already used by another app, so the screenshot shortcut only works inside Whiteboard.");
  });
}

function installListeners() {
  listen("quit-requested", () => void requestQuit());
  listen<string[]>("open-files", async (e) => {
    for (const p of e.payload) await openBoard(p);
  });

  installDropHandling();
  installRefInteractions();
  installSendToActionMenu();
  applyGlobalCaptureShortcut(getApp().prefs.globalCaptureShortcut);
  useApp.subscribe((s, prev) => {
    if (s.prefs.globalCaptureShortcut !== prev.prefs.globalCaptureShortcut) applyGlobalCaptureShortcut(s.prefs.globalCaptureShortcut);
  });

  // External change detection: on focus, and periodically for open boards.
  getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (!focused) return;
    for (const s of sessions.values()) void s.checkExternal();
    void refreshTree();
  });
  window.setInterval(() => {
    if (document.hidden) return;
    void activeSession()?.checkExternal();
  }, 3000);

  // Theme follows the OS when set to "system".
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (ev) => setApp({ systemDark: ev.matches }));

  // Persist session-ish state on any relevant change.
  useApp.subscribe((s, prev) => {
    if (
      s.tabs !== prev.tabs ||
      s.activeTabId !== prev.activeTabId ||
      s.expanded !== prev.expanded ||
      s.sidebarWidth !== prev.sidebarWidth ||
      s.sidebarCollapsed !== prev.sidebarCollapsed ||
      s.mode !== prev.mode ||
      s.designBoards !== prev.designBoards ||
      s.prefs !== prev.prefs
    ) {
      schedulePersist();
    }
  });

  // Keep the native menu (Open Recent, theme checkmarks) in sync.
  let menuTimer: number | undefined;
  let lastMenu = "";
  const syncMenu = () => {
    window.clearTimeout(menuTimer);
    menuTimer = window.setTimeout(() => {
      const s = getApp();
      const state = {
        recents: s.recents.slice(0, 12).map((r) => ({ path: r.path, name: boardName(r.path) })),
        theme: s.prefs.theme,
        hasBoard: !!s.activeTabId,
      };
      const key = JSON.stringify(state);
      if (key === lastMenu) return;
      lastMenu = key;
      ipc.updateMenu(state).catch((e) => console.warn("menu update failed", e));
    }, 250);
  };
  useApp.subscribe((s, prev) => {
    if (s.recents !== prev.recents || s.prefs.theme !== prev.prefs.theme || s.activeTabId !== prev.activeTabId) syncMenu();
  });
  syncMenu();

  // Window title mirrors the active board (shown in Mission Control / Window menu).
  useApp.subscribe((s, prev) => {
    if (s.activeTabId === prev.activeTabId && s.tabs === prev.tabs) return;
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    void getCurrentWindow().setTitle(tab ? `${boardName(tab.path)} — Whiteboard` : "Whiteboard");
  });

  document.documentElement.dataset.theme = effectiveTheme(getApp());
  useApp.subscribe((s) => {
    document.documentElement.dataset.theme = effectiveTheme(s);
  });
}
