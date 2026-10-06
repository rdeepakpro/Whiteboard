/**
 * Loads and saves Whiteboard's metadata/session file (`state.json`).
 * Writes are debounced and atomic (Rust write_text). A backup copy
 * (`state.json.bak`) is refreshed once per launch from the last good file.
 */
import { ipc } from "../platform/ipc";
import {
  DEFAULT_PREFS,
  DEFAULT_SIDEBAR_WIDTH,
  getApp,
  type PersistedState,
  type Viewport,
} from "./store";

/** Viewports change constantly while panning, so they live outside zustand. */
export const viewports: Record<string, Viewport> = {};

export async function loadPersisted(stateFile: string): Promise<Partial<PersistedState> | null> {
  for (const file of [stateFile, stateFile + ".bak"]) {
    try {
      const { content } = await ipc.readText(file);
      const parsed = JSON.parse(content) as Partial<PersistedState>;
      if (parsed && typeof parsed === "object") {
        if (file === stateFile) ipc.writeText(stateFile + ".bak", content).catch(() => {});
        return parsed;
      }
    } catch {
      // missing or corrupt — try the backup
    }
  }
  return null;
}

export function snapshotState(): PersistedState {
  const s = getApp();
  const active = s.tabs.find((t) => t.id === s.activeTabId);
  return {
    version: 1,
    prefs: s.prefs,
    favorites: s.favorites,
    archived: s.archived,
    recents: s.recents.slice(0, 40),
    viewports: pruneViewports(),
    expanded: s.expanded,
    tabs: s.tabs.map((t) => t.path),
    activePath: active?.path ?? null,
    closedStack: s.closedStack.slice(-20),
    sidebarWidth: s.sidebarWidth,
    sidebarCollapsed: s.sidebarCollapsed,
    mode: s.mode,
  };
}

function pruneViewports(): Record<string, Viewport> {
  // Keep viewports only for boards we still know about.
  const s = getApp();
  const keep = new Set([...s.tabs.map((t) => t.path), ...s.recents.map((r) => r.path), ...s.favorites]);
  const out: Record<string, Viewport> = {};
  for (const [k, v] of Object.entries(viewports)) if (keep.has(k)) out[k] = v;
  return out;
}

let timer: number | undefined;
let writing: Promise<unknown> = Promise.resolve();

export function schedulePersist(delay = 600) {
  if (!getApp().ready) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void persistNow(), delay);
}

export async function persistNow() {
  const paths = getApp().paths;
  if (!paths || !getApp().ready) return;
  window.clearTimeout(timer);
  const json = JSON.stringify(snapshotState(), null, 1);
  writing = writing.then(() => ipc.writeText(paths.stateFile, json)).catch((e) => {
    console.error("Failed to persist state", e);
  });
  await writing;
}

export function mergeDefaults(p: Partial<PersistedState> | null, defaultRoot: string) {
  return {
    prefs: { ...DEFAULT_PREFS, libraryRoot: defaultRoot, ...(p?.prefs ?? {}) },
    favorites: p?.favorites ?? [],
    archived: p?.archived ?? [],
    recents: p?.recents ?? [],
    expanded: p?.expanded ?? {},
    sidebarWidth: p?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
    sidebarCollapsed: p?.sidebarCollapsed ?? false,
    mode: p?.mode ?? ("brainstorm" as const),
    closedStack: p?.closedStack ?? [],
    tabs: p?.tabs ?? [],
    activePath: p?.activePath ?? null,
    viewports: p?.viewports ?? {},
  };
}
