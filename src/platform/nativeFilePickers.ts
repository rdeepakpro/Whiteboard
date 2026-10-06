/**
 * Native file pickers for Excalidraw.
 *
 * Excalidraw does all of its file I/O (insert image, export PNG/SVG, open/save
 * libraries) through `browser-fs-access`, which uses the File System Access API
 * (`showOpenFilePicker` / `showSaveFilePicker`) when the browser has it and
 * falls back to `<input type=file>` / `<a download>` otherwise. WKWebView has
 * neither the API nor working downloads, so this module provides a minimal
 * implementation of the two pickers backed by native macOS dialogs and the
 * Rust file commands.
 *
 * browser-fs-access detects support at import time, so this file MUST be
 * imported before `@excalidraw/excalidraw` (see main.tsx).
 */
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ipc } from "./ipc";
import { basename, dirname } from "../lib/paths";

interface PickerType {
  description?: string;
  accept: Record<string, string[]>;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  jfif: "image/jpeg",
  excalidraw: "application/vnd.excalidraw+json",
  excalidrawlib: "application/vnd.excalidrawlib+json",
  json: "application/json",
};

export function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

const LAST_DIR_KEY = "whiteboard.lastPickerDir";
function lastDir(): string | undefined {
  try {
    return localStorage.getItem(LAST_DIR_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function rememberDir(path: string) {
  try {
    localStorage.setItem(LAST_DIR_KEY, dirname(path));
  } catch {
    /* ignore */
  }
}

function toFilters(types?: PickerType[]) {
  const filters = (types ?? [])
    .map((t) => ({
      name: t.description || "Files",
      extensions: Object.values(t.accept)
        .flat()
        .map((e) => e.replace(/^\./, ""))
        .filter(Boolean),
    }))
    .filter((f) => f.extensions.length > 0);
  return filters.length ? filters : undefined;
}

function abort(): never {
  throw new DOMException("The user aborted a request.", "AbortError");
}

export async function readFileAsFile(path: string): Promise<File> {
  const b64 = await ipc.readBase64(path);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], basename(path), { type: mimeForPath(path) });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** A tiny FileSystemFileHandle look-alike pointing at a real path. */
class NativeFileHandle {
  readonly kind = "file";
  readonly name: string;
  constructor(readonly path: string) {
    this.name = basename(path);
  }
  async getFile(): Promise<File> {
    return readFileAsFile(this.path);
  }
  async queryPermission() {
    return "granted";
  }
  async requestPermission() {
    return "granted";
  }
  async isSameEntry(other: unknown) {
    return other instanceof NativeFileHandle && other.path === this.path;
  }
  /**
   * browser-fs-access either pipes a Blob stream into this writable or calls
   * `write()`/`close()` directly (Excalidraw passes a Promise<Blob>), so it
   * supports both styles.
   */
  async createWritable(): Promise<WritableStream> {
    const chunks: BlobPart[] = [];
    const path = this.path;
    const push = (chunk: unknown) => {
      if (chunk && typeof chunk === "object" && "type" in chunk && (chunk as any).type === "write") {
        chunks.push((chunk as any).data);
      } else {
        chunks.push(chunk as BlobPart);
      }
    };
    const flush = async () => ipc.writeBase64(path, await blobToBase64(new Blob(chunks)));
    const stream = new WritableStream({ write: push, close: flush });
    return Object.assign(stream, {
      write: async (chunk: unknown) => push(await chunk),
      close: flush,
    });
  }
}

async function showOpenFilePicker(opts: { types?: PickerType[]; multiple?: boolean } = {}) {
  const result = await open({
    multiple: !!opts.multiple,
    directory: false,
    filters: toFilters(opts.types),
    defaultPath: lastDir(),
  });
  if (!result) abort();
  const paths = Array.isArray(result) ? result : [result];
  if (!paths.length) abort();
  rememberDir(paths[0]);
  return paths.map((p) => new NativeFileHandle(p));
}

async function showSaveFilePicker(opts: { suggestedName?: string; types?: PickerType[] } = {}) {
  const dir = lastDir();
  const name = opts.suggestedName || "Untitled";
  const path = await save({
    defaultPath: dir ? `${dir}/${name}` : name,
    filters: toFilters(opts.types),
  });
  if (!path) abort();
  rememberDir(path);
  return new NativeFileHandle(path);
}

export function installNativeFilePickers() {
  const w = window as any;
  // Serve Excalidraw's fonts from the app bundle (public/fonts) — fully offline.
  w.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/`;
  w.showOpenFilePicker = showOpenFilePicker;
  w.showSaveFilePicker = showSaveFilePicker;

  // Links on canvas elements open in the user's default browser.
  const nativeOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url ? String(url) : "";
    if (/^(https?:|mailto:)/i.test(href)) {
      openUrl(href).catch((e) => console.error("openUrl failed", e));
      return null;
    }
    return nativeOpen(url as any, target, features);
  }) as typeof window.open;
}

installNativeFilePickers();
