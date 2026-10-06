// Typed wrappers around the Rust commands in src-tauri/src.
import { invoke } from "@tauri-apps/api/core";

export interface TreeNode {
  name: string;
  path: string;
  kind: "folder" | "board";
  mtime: number;
  children?: TreeNode[];
}

export interface AppPaths {
  dataDir: string;
  defaultRoot: string;
  templatesDir: string;
  libraryFile: string;
  stateFile: string;
}

export interface ThumbInfo {
  path: string;
  thumb: string | null;
  thumbMtime: number;
  boardMtime: number;
  exists: boolean;
}

export interface Snapshot {
  id: number; // epoch ms
  size: number;
}

export interface TrashEntry {
  id: string;
  name: string;
  originalPath: string;
  kind: "board" | "folder";
  deletedAt: number;
  trashedPath: string;
}

export interface LinkPreview {
  url: string;
  kind: "youtube" | "instagram" | "web";
  title: string | null;
  author: string | null;
  description: string | null;
  siteName: string | null;
  image: { data: string; mime: string } | null;
  favicon: { data: string; mime: string } | null;
  status: "ok" | "partial" | "unavailable" | "offline";
  fetchedAt: number;
}

export interface BoardDigest {
  path: string;
  mtime: number;
  text: string;
  headings: string[];
  todos: string[];
  arrows: number;
  elements: number;
}

export interface Stat {
  exists: boolean;
  mtime: number;
  size: number;
  is_dir: boolean;
}

export const ipc = {
  appPaths: () => invoke<AppPaths>("app_paths"),
  takePendingOpens: () => invoke<string[]>("take_pending_opens"),
  quitApp: () => invoke<void>("quit_app"),

  readText: (path: string) => invoke<{ content: string; mtime: number }>("read_text", { path }),
  writeBoard: (path: string, content: string, expectedMtime: number | null) =>
    invoke<number>("write_board", { path, content, expectedMtime }),
  writeText: (path: string, content: string) => invoke<number>("write_text", { path, content }),
  writeBase64: (path: string, data: string) => invoke<void>("write_base64", { path, data }),
  readBase64: (path: string) => invoke<string>("read_base64", { path }),
  stat: (path: string) => invoke<Stat>("stat_path", { path }),
  scanTree: (root: string) => invoke<TreeNode[]>("scan_tree", { root }),
  createFolder: (path: string) => invoke<void>("create_folder", { path }),
  createBoard: (path: string, content: string) => invoke<number>("create_board", { path, content }),
  movePath: (from: string, to: string) => invoke<void>("move_path", { from, to }),
  copyFile: (from: string, to: string) => invoke<void>("copy_file", { from, to }),
  uniquePath: (dir: string, base: string, ext: string | null) => invoke<string>("unique_path", { dir, base, ext }),

  locateFile: (name: string, size: number, mtime: number, hints: string[]) =>
    invoke<string | null>("locate_file", { name, size, mtime, hints }),

  thumbInfo: (paths: string[]) => invoke<ThumbInfo[]>("thumb_info", { paths }),
  thumbWrite: (path: string, data: string) => invoke<string>("thumb_write", { path, data }),

  historySnapshot: (path: string, content: string, minIntervalMs: number, maxTotal?: number) =>
    invoke<boolean>("history_snapshot", { path, content, minIntervalMs, maxTotal }),
  historyList: (path: string) => invoke<Snapshot[]>("history_list", { path }),
  historyRead: (path: string, id: number) => invoke<string>("history_read", { path, id }),
  rekeyPaths: (pairs: [string, string][]) => invoke<void>("rekey_paths", { pairs }),

  trashItem: (path: string) => invoke<TrashEntry>("trash_item", { path }),
  trashList: () => invoke<TrashEntry[]>("trash_list"),
  trashRestore: (id: string) => invoke<string>("trash_restore", { id }),
  trashDelete: (id: string) => invoke<void>("trash_delete", { id }),
  trashEmpty: () => invoke<void>("trash_empty"),

  searchText: (root: string, extra: string[], query: string) =>
    invoke<{ path: string; snippet: string }[]>("search_text", { root, extra, query, limit: 30 }),

  linkPreview: (url: string, refresh: boolean) => invoke<LinkPreview>("link_preview", { url, refresh }),
  screenCaptureAccess: (request: boolean) => invoke<boolean>("screen_capture_access", { request }),
  openScreenRecordingSettings: () => invoke<void>("open_screen_recording_settings"),
  captureScreen: (mode: "region" | "window" | "screen", hideApp: boolean) =>
    invoke<string | null>("capture_screen", { mode, hideApp }),
  setGlobalCaptureShortcut: (enabled: boolean) => invoke<void>("set_global_capture_shortcut", { enabled }),
  clipboardImagePng: () => invoke<string | null>("clipboard_image_png"),

  boardDigests: (root: string) => invoke<BoardDigest[]>("board_digests", { root }),
  localAi: (model: string, prompt: string) => invoke<string | null>("local_ai", { model, prompt }),
  localAiModels: () => invoke<string[] | null>("local_ai_models"),

  updateMenu: (state: { recents: { path: string; name: string }[]; theme: string; hasBoard: boolean }) =>
    invoke<void>("update_menu", { state }),
};

/** Error codes produced by the Rust side (see files.rs). */
export type ErrorCode = "CONFLICT" | "NOT_FOUND" | "PERMISSION" | "NO_SPACE" | "EXISTS" | "INVALID" | "IO";

export function errorCode(e: unknown): ErrorCode | null {
  const m = String(e).match(/^(CONFLICT|NOT_FOUND|PERMISSION|NO_SPACE|EXISTS|INVALID|IO):/);
  return (m?.[1] as ErrorCode) ?? null;
}

/** Calm, human messages for filesystem errors. */
export function friendlyError(e: unknown, action = "complete that"): string {
  switch (errorCode(e)) {
    case "NOT_FOUND":
      return `Couldn't ${action} — the file or folder no longer exists.`;
    case "PERMISSION":
      return `Couldn't ${action} — macOS denied permission to this location.`;
    case "NO_SPACE":
      return `Couldn't ${action} — the disk is full. Free up some space and try again.`;
    case "EXISTS":
      return `Couldn't ${action} — something with that name already exists.`;
    case "INVALID":
      return `Couldn't ${action} — the data isn't a valid Excalidraw file.`;
    case "CONFLICT":
      return `The file changed on disk since it was opened.`;
    default:
      return `Couldn't ${action}. ${String(e).replace(/^\w+: /, "")}`;
  }
}
