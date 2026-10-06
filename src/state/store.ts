/**
 * App-level state for the Whiteboard shell (never the canvas itself — each
 * Excalidraw instance owns its own scene state).
 *
 * Persisted fields are written to `<appData>/state.json` by persist.ts.
 * Board identity is the board's absolute file path.
 */
import { create } from "zustand";
import type { AppPaths, TreeNode } from "../platform/ipc";
export type { TreeNode };

export type ThemePref = "light" | "dark" | "system";

export interface Prefs {
  theme: ThemePref;
  reopenSession: boolean;
  /** Folder that holds all boards and workspaces (a normal Finder folder). */
  libraryRoot: string;
  /** Where Cmd+N puts new boards when no folder is selected ("" = root). */
  newBoardFolder: string;
  autosave: boolean;
  autosaveDelayMs: number;
  historyIntervalMin: number;
  historyMax: number;
  showRecentsInSidebar: boolean;
  showFavoritesInSidebar: boolean;
  langCode: string;
  /** System-wide ⌘⇧2 screenshot shortcut. */
  globalCaptureShortcut: boolean;
  /** Hide Whiteboard while selecting a screenshot region. */
  hideWhileCapturing: boolean;
  /** Gently offer the daily check-in after `checkInHour`. */
  checkInReminder: boolean;
  checkInHour: number;
  /** Optional local model (Ollama on this Mac) for names and summaries. */
  localAiEnabled: boolean;
  localAiModel: string;
}

export const DEFAULT_PREFS: Omit<Prefs, "libraryRoot"> = {
  theme: "system",
  reopenSession: true,
  newBoardFolder: "",
  autosave: true,
  autosaveDelayMs: 800,
  historyIntervalMin: 10,
  historyMax: 80,
  showRecentsInSidebar: true,
  showFavoritesInSidebar: true,
  langCode: "en",
  globalCaptureShortcut: true,
  hideWhileCapturing: true,
  checkInReminder: true,
  checkInHour: 18,
  localAiEnabled: false,
  localAiModel: "",
};

export type Mode = "brainstorm" | "action";

export interface Recent {
  path: string;
  at: number; // last opened or edited, epoch ms
}

export interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface Tab {
  id: string;
  path: string;
}

export interface TabStatus {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  conflict: boolean;
  missing: boolean;
  loadError: string | null;
}

export type Page = null | "home" | "recents" | "archive" | "trash" | "favorites";

export type Dialog =
  | null
  | { kind: "palette"; query?: string }
  | { kind: "insert-link"; variant?: "web" | "youtube" | "instagram" }
  | {
      kind: "send-to-action";
      title: string;
      boardPath: string | null;
      elementIds: string[] | null;
      itemKind?: "priority" | "move" | "milestone" | "blocker";
    }
  | { kind: "settings"; section?: string }
  | { kind: "templates"; folder?: string }
  | { kind: "shortcuts" }
  | { kind: "licenses" };

export interface PersistedState {
  version: 1;
  prefs: Prefs;
  favorites: string[];
  archived: string[];
  recents: Recent[];
  viewports: Record<string, Viewport>;
  expanded: Record<string, boolean>;
  tabs: string[];
  activePath: string | null;
  closedStack: string[];
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  mode: Mode;
  actionTab: "plan" | "calendar" | "journal";
}

export interface AppState {
  ready: boolean;
  /** Brainstorm (boards/canvas) or Action (execution view). */
  mode: Mode;
  /** Action view tab. */
  actionTab: "plan" | "calendar" | "journal";
  paths: AppPaths | null;
  prefs: Prefs;
  systemDark: boolean;

  tree: TreeNode[];
  favorites: string[];
  archived: string[];
  recents: Recent[];
  expanded: Record<string, boolean>;

  tabs: Tab[];
  activeTabId: string | null;
  /** Tabs whose editor has been mounted (lazy mounting of restored tabs). */
  mounted: Record<string, true>;
  closedStack: string[];
  tabStatus: Record<string, TabStatus>;

  sidebarWidth: number;
  sidebarCollapsed: boolean;
  focusMode: boolean;
  page: Page;
  dialog: Dialog;
  historyOpen: boolean;
  quickLook: string | null;
  /** Selected sidebar row (board or folder path). */
  selected: string | null;
  renaming: string | null;
  /** Bumped when a thumbnail is regenerated so <img> URLs refresh. */
  thumbVersion: Record<string, number>;
}

export const DEFAULT_SIDEBAR_WIDTH = 248;

export const useApp = create<AppState>(() => ({
  ready: false,
  mode: "brainstorm",
  actionTab: "plan",
  paths: null,
  prefs: { ...DEFAULT_PREFS, libraryRoot: "" },
  systemDark: window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  tree: [],
  favorites: [],
  archived: [],
  recents: [],
  expanded: {},
  tabs: [],
  activeTabId: null,
  mounted: {},
  closedStack: [],
  tabStatus: {},
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarCollapsed: false,
  focusMode: false,
  page: null,
  dialog: null,
  historyOpen: false,
  quickLook: null,
  selected: null,
  renaming: null,
  thumbVersion: {},
}));

export const getApp = useApp.getState;
export const setApp = useApp.setState;

export function effectiveTheme(s: Pick<AppState, "prefs" | "systemDark">): "light" | "dark" {
  return s.prefs.theme === "system" ? (s.systemDark ? "dark" : "light") : s.prefs.theme;
}

export function activeTab(s: AppState = getApp()): Tab | null {
  return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
}

export const EMPTY_STATUS: TabStatus = {
  dirty: false,
  saving: false,
  error: null,
  conflict: false,
  missing: false,
  loadError: null,
};

export function setTabStatus(tabId: string, patch: Partial<TabStatus>) {
  const cur = getApp().tabStatus[tabId] ?? EMPTY_STATUS;
  const changed = (Object.keys(patch) as (keyof TabStatus)[]).some((k) => cur[k] !== patch[k]);
  if (!changed) return;
  setApp((s) => ({ tabStatus: { ...s.tabStatus, [tabId]: { ...cur, ...patch } } }));
}

let tabCounter = 0;
export function newTabId(): string {
  tabCounter += 1;
  return `t${Date.now().toString(36)}${tabCounter}`;
}

/** Depth-first list of all boards in the tree. */
export function allBoards(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    if (n.kind === "board") out.push(n);
    else if (n.children) allBoards(n.children, out);
  }
  return out;
}

export function allFolders(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    if (n.kind === "folder") {
      out.push(n);
      if (n.children) allFolders(n.children, out);
    }
  }
  return out;
}

export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const f = findNode(n.children, path);
      if (f) return f;
    }
  }
  return null;
}
