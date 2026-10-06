/**
 * Board and folder operations. Every operation that moves a file also rebases
 * the metadata that refers to it (tabs, favorites, archive, recents, expanded
 * folders, viewports, history, thumbnails) so nothing is orphaned.
 */
import { ask, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ipc, errorCode, friendlyError } from "../platform/ipc";
import {
  allBoards,
  findNode,
  getApp,
  newTabId,
  setApp,
  type Tab,
} from "../state/store";
import { schedulePersist, viewports } from "../state/persist";
import { sessions, sessionForPath, activeSession, focusEditor } from "../editor/registry";
import { emptySceneJSON, serializeScene } from "../editor/scene";
import { basename, boardName, dirname, isInside, join, rebase, sanitizeName } from "./paths";
import { touchRecent, forgetRecent } from "./recents";
import { forgetThumb } from "./thumbnails";
import { importLibraryFile } from "./library";
import { toast } from "./toast";
import { rebaseActionPaths } from "../action/store";

export const DEFAULT_BOARD_NAME = "Untitled Whiteboard";
const EXT = "excalidraw";

function root() {
  return getApp().prefs.libraryRoot;
}

export async function refreshTree() {
  try {
    const r = root();
    const tree = await ipc.scanTree(r);
    // Drop favorite/archive flags for library boards that no longer exist
    // (e.g. renamed or deleted in Finder). Boards outside the library are kept.
    const present = new Set(allBoards(tree).map((b) => b.path));
    const keep = (p: string) => !isInside(p, r) || present.has(p);
    setApp((s) => ({
      tree,
      favorites: s.favorites.every(keep) ? s.favorites : s.favorites.filter(keep),
      archived: s.archived.every(keep) ? s.archived : s.archived.filter(keep),
    }));
    schedulePersist();
  } catch (e) {
    toast(friendlyError(e, "read your boards folder"), "error");
  }
}

/** Creates the default workspaces on first launch. */
export async function seedLibrary() {
  const r = root();
  const layout: Record<string, string[]> = {
    Startup: ["Product", "Marketing", "Research", "Random Ideas"],
    School: ["Science", "English"],
    Personal: ["Ideas", "Planning"],
  };
  for (const [top, subs] of Object.entries(layout)) {
    for (const sub of subs) await ipc.createFolder(join(r, top, sub)).catch(() => {});
  }
}

// ------------------------------------------------------------------ tabs

export function activateTab(id: string) {
  const tab = getApp().tabs.find((t) => t.id === id);
  if (!tab) return;
  setApp((s) => ({ activeTabId: id, mounted: { ...s.mounted, [id]: true }, page: null, quickLook: null }));
  window.setTimeout(() => focusEditor(id), 0);
  touchRecent(tab.path, { quiet: true });
  schedulePersist();
}

/** Opens a board in a tab (or focuses its existing tab). */
export async function openBoard(path: string, opts: { background?: boolean } = {}) {
  if (!opts.background && getApp().mode !== "brainstorm") setApp({ mode: "brainstorm" });
  if (/\.excalidrawlib$/i.test(path)) return importLibraryFile(path);
  const existing = getApp().tabs.find((t) => t.path === path);
  if (existing) {
    if (!opts.background) activateTab(existing.id);
    return;
  }
  const st = await ipc.stat(path);
  if (!st.exists || st.is_dir) {
    toast(`“${boardName(path)}” can't be found. It may have been moved or deleted.`, "error");
    forgetRecent(path);
    return;
  }
  const tab: Tab = { id: newTabId(), path };
  setApp((s) => {
    // Insert after the active tab, like a browser.
    const i = s.tabs.findIndex((t) => t.id === s.activeTabId);
    const tabs = [...s.tabs];
    tabs.splice(i < 0 ? tabs.length : i + 1, 0, tab);
    return {
      tabs,
      closedStack: s.closedStack.filter((p) => p !== path),
      ...(opts.background ? {} : { activeTabId: tab.id, mounted: { ...s.mounted, [tab.id]: true }, page: null }),
    };
  });
  touchRecent(path);
  schedulePersist();
}

export async function closeTab(id: string) {
  const s = getApp();
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab) return;
  const session = sessions.get(id);
  if (session) {
    const ok = await session.flush();
    if (!ok && session.isDirty) {
      const discard = await ask(
        `“${boardName(tab.path)}” has changes that couldn't be saved. Close it anyway and lose those changes?`,
        { title: "Unsaved changes", kind: "warning", okLabel: "Close Anyway", cancelLabel: "Keep Open" },
      );
      if (!discard) return;
    }
  }
  setApp((st) => {
    const idx = st.tabs.findIndex((t) => t.id === id);
    const tabs = st.tabs.filter((t) => t.id !== id);
    let activeTabId = st.activeTabId;
    if (activeTabId === id) activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
    const mounted = { ...st.mounted };
    delete mounted[id];
    if (activeTabId) mounted[activeTabId] = true;
    const tabStatus = { ...st.tabStatus };
    delete tabStatus[id];
    return {
      tabs,
      activeTabId,
      mounted,
      tabStatus,
      historyOpen: activeTabId ? st.historyOpen : false,
      closedStack: [...st.closedStack.filter((p) => p !== tab.path), tab.path].slice(-20),
    };
  });
  schedulePersist();
}

export async function reopenClosed() {
  const stack = [...getApp().closedStack];
  while (stack.length) {
    const path = stack.pop()!;
    setApp({ closedStack: stack });
    if ((await ipc.stat(path)).exists) return openBoard(path);
  }
}

export function moveTab(id: string, toIndex: number) {
  setApp((s) => {
    const tabs = [...s.tabs];
    const from = tabs.findIndex((t) => t.id === id);
    if (from < 0) return {};
    const [t] = tabs.splice(from, 1);
    tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, t);
    return { tabs };
  });
  schedulePersist();
}

export function cycleTab(delta: number) {
  const s = getApp();
  if (!s.tabs.length) return;
  const i = s.tabs.findIndex((t) => t.id === s.activeTabId);
  activateTab(s.tabs[(i + delta + s.tabs.length) % s.tabs.length].id);
}

// ---------------------------------------------------------------- create

/** Folder a new board should go into, based on sidebar selection/prefs. */
export function targetFolder(): string {
  const s = getApp();
  const sel = s.selected ? findNode(s.tree, s.selected) : null;
  if (sel?.kind === "folder") return sel.path;
  if (sel?.kind === "board") return dirname(sel.path);
  return s.prefs.newBoardFolder && isInside(s.prefs.newBoardFolder, root()) ? s.prefs.newBoardFolder : root();
}

export async function newBoard(opts: { folder?: string; content?: string; name?: string } = {}) {
  if (getApp().mode !== "brainstorm") setApp({ mode: "brainstorm" });
  const folder = opts.folder ?? targetFolder();
  try {
    const path = await ipc.uniquePath(folder, sanitizeName(opts.name || DEFAULT_BOARD_NAME), EXT);
    await ipc.createBoard(path, opts.content ?? emptySceneJSON());
    if (isInside(folder, root()) && folder !== root()) setApp((s) => ({ expanded: { ...s.expanded, [folder]: true } }));
    await refreshTree();
    await openBoard(path);
    setApp({ selected: path });
    return path;
  } catch (e) {
    toast(friendlyError(e, "create a new board"), "error");
    return null;
  }
}

export async function newFolder(parent?: string) {
  const dir = parent ?? (() => {
    const s = getApp();
    const sel = s.selected ? findNode(s.tree, s.selected) : null;
    return sel?.kind === "folder" ? sel.path : root();
  })();
  try {
    const path = await ipc.uniquePath(dir, "New Folder", null);
    await ipc.createFolder(path);
    setApp((s) => ({ expanded: { ...s.expanded, [dir]: true, [path]: true }, selected: path, renaming: path, sidebarCollapsed: false, focusMode: false }));
    await refreshTree();
  } catch (e) {
    toast(friendlyError(e, "create the folder"), "error");
  }
}

// ------------------------------------------------------- move & rename

/** Rebases all metadata after `from` moved to `to` (file or folder). */
async function applyPathChange(from: string, to: string, boardPairs: [string, string][]) {
  const rb = (p: string) => rebase(p, from, to);
  for (const session of sessions.values()) {
    const next = rb(session.path);
    if (next !== session.path) {
      const st = await ipc.stat(next);
      session.setPath(next, st.mtime);
    }
  }
  for (const [a, b] of boardPairs) {
    if (viewports[a]) {
      viewports[b] = viewports[a];
      delete viewports[a];
    }
    forgetThumb(a);
    forgetThumb(b);
  }
  setApp((s) => ({
    tabs: s.tabs.map((t) => ({ ...t, path: rb(t.path) })),
    favorites: s.favorites.map(rb),
    archived: s.archived.map(rb),
    recents: s.recents.map((r) => ({ ...r, path: rb(r.path) })),
    closedStack: s.closedStack.map(rb),
    expanded: Object.fromEntries(Object.entries(s.expanded).map(([k, v]) => [rb(k), v])),
    selected: s.selected ? rb(s.selected) : null,
    quickLook: s.quickLook ? rb(s.quickLook) : null,
  }));
  rebaseActionPaths(from, to);
  await ipc.rekeyPaths(boardPairs).catch(() => {});
  schedulePersist();
}

function boardsUnder(path: string): string[] {
  const node = findNode(getApp().tree, path);
  if (!node) return [path];
  return node.kind === "board" ? [path] : allBoards(node.children ?? []).map((b) => b.path);
}

async function flushUnder(path: string) {
  for (const s of sessions.values()) if (isInside(s.path, path)) await s.flush();
}

async function relocate(from: string, to: string, action: string): Promise<boolean> {
  if (from === to) return true;
  await flushUnder(from);
  const pairs = boardsUnder(from).map((p) => [p, rebase(p, from, to)] as [string, string]);
  try {
    await ipc.movePath(from, to);
  } catch (e) {
    toast(friendlyError(e, action), "error");
    return false;
  }
  await applyPathChange(from, to, pairs);
  await refreshTree();
  return true;
}

export async function renamePath(path: string, newName: string) {
  const clean = sanitizeName(newName);
  const node = findNode(getApp().tree, path);
  const isBoard = node ? node.kind === "board" : path.endsWith(`.${EXT}`);
  if (!clean || clean === (isBoard ? boardName(path) : basename(path))) return;
  const to = join(dirname(path), isBoard ? `${clean}.${EXT}` : clean);
  if ((await ipc.stat(to)).exists && to.toLowerCase() !== path.toLowerCase()) {
    toast(`There's already something called “${clean}” in this folder.`, "error");
    return;
  }
  await relocate(path, to, "rename it");
}

export async function moveInto(path: string, folder: string) {
  if (dirname(path) === folder || isInside(folder, path)) return;
  const to = await ipc.uniquePath(folder, path.endsWith(`.${EXT}`) ? boardName(path) : basename(path), path.endsWith(`.${EXT}`) ? EXT : null);
  if (await relocate(path, to, "move it")) {
    setApp((s) => ({ expanded: { ...s.expanded, [folder]: true } }));
  }
}

export async function duplicateBoard(path: string) {
  const session = sessionForPath(path);
  if (session) await session.flush();
  try {
    const to = await ipc.uniquePath(dirname(path), `${boardName(path)} copy`, EXT);
    await ipc.copyFile(path, to);
    await refreshTree();
    setApp({ selected: to });
    return to;
  } catch (e) {
    toast(friendlyError(e, "duplicate the board"), "error");
    return null;
  }
}

// ---------------------------------------------------- archive & trash

export function toggleFavorite(path: string) {
  setApp((s) => ({
    favorites: s.favorites.includes(path) ? s.favorites.filter((p) => p !== path) : [...s.favorites, path],
  }));
  schedulePersist();
}

export function setArchived(path: string, archived: boolean) {
  setApp((s) => ({
    archived: archived ? [...new Set([...s.archived, path])] : s.archived.filter((p) => p !== path),
  }));
  if (archived) {
    const tab = getApp().tabs.find((t) => t.path === path);
    if (tab) void closeTab(tab.id);
    toast(`Archived “${boardName(path)}”`, "info", { label: "Undo", run: () => setArchived(path, false) });
  }
  schedulePersist();
}

/** Moves a board/folder into Whiteboard's Trash (recoverable). */
export async function trashPath(path: string) {
  const tabs = getApp().tabs.filter((t) => isInside(t.path, path));
  for (const t of tabs) await closeTab(t.id);
  if (getApp().tabs.some((t) => isInside(t.path, path))) return; // user kept a tab open
  try {
    const entry = await ipc.trashItem(path);
    setApp((s) => ({
      favorites: s.favorites.filter((p) => !isInside(p, path)),
      archived: s.archived.filter((p) => !isInside(p, path)),
      recents: s.recents.filter((r) => !isInside(r.path, path)),
      closedStack: s.closedStack.filter((p) => !isInside(p, path)),
      selected: s.selected && isInside(s.selected, path) ? null : s.selected,
    }));
    schedulePersist();
    await refreshTree();
    toast(`Moved “${entry.name}” to Trash`, "info", {
      label: "Undo",
      run: async () => {
        await ipc.trashRestore(entry.id).catch((e) => toast(friendlyError(e, "restore it"), "error"));
        await refreshTree();
      },
    });
  } catch (e) {
    toast(friendlyError(e, "move it to Trash"), "error");
  }
}

// ----------------------------------------------------- native file ops

export async function openWithDialog() {
  const picked = await openDialog({
    multiple: true,
    filters: [
      { name: "Excalidraw", extensions: ["excalidraw", "excalidrawlib", "json"] },
    ],
  });
  if (!picked) return;
  for (const p of Array.isArray(picked) ? picked : [picked]) await openBoard(p);
}

export async function saveActive() {
  const s = activeSession();
  if (!s) return;
  const ok = await s.save({ manual: true });
  if (ok) toast("Saved");
}

/** Save As: writes a copy and continues editing the new file. */
export async function saveAs() {
  const session = activeSession();
  if (!session) return;
  const target = await saveDialog({
    defaultPath: join(dirname(session.path), `${boardName(session.path)} copy.${EXT}`),
    filters: [{ name: "Excalidraw", extensions: [EXT] }],
  });
  if (!target) return;
  const path = target.endsWith(`.${EXT}`) ? target : `${target}.${EXT}`;
  const content = session.serialize();
  if (!content) return;
  try {
    const mtime = await ipc.writeBoard(path, content, null);
    const old = session.path;
    session.setPath(path, mtime);
    session.markSaved(mtime);
    setApp((s) => ({ tabs: s.tabs.map((t) => (t.id === session.tabId ? { ...t, path } : t)) }));
    if (viewports[old]) viewports[path] = viewports[old];
    touchRecent(path);
    await refreshTree();
  } catch (e) {
    toast(friendlyError(e, "save the board there"), "error");
  }
}

export async function saveAsTemplate() {
  const session = activeSession();
  const dir = getApp().paths?.templatesDir;
  if (!session?.api || !dir) return;
  const content = serializeScene(session.api.getSceneElements(), session.api.getAppState(), session.api.getFiles());
  const path = await ipc.uniquePath(dir, boardName(session.path), EXT);
  await ipc.createBoard(path, content).then(
    () => toast(`Saved “${boardName(path)}” as a template`),
    (e) => toast(friendlyError(e, "save the template"), "error"),
  );
}

export async function reveal(path: string) {
  await revealItemInDir(path).catch((e) => toast(friendlyError(e, "show it in Finder"), "error"));
}

/** Duplicates arbitrary scene content into a new board next to `nearPath`. */
export async function createBoardFromContent(nearPath: string, name: string, content: string) {
  const folder = isInside(nearPath, root()) ? dirname(nearPath) : root();
  return newBoard({ folder, content, name });
}

export function isNotFound(e: unknown) {
  return errorCode(e) === "NOT_FOUND";
}
