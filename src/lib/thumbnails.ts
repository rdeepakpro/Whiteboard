/**
 * Board thumbnails: small PNGs cached in <appData>/thumbs, regenerated a few
 * seconds after a save (never while actively drawing) and lazily for boards
 * that have no up-to-date thumbnail when they become visible.
 */
import { exportToBlob, getNonDeletedElements } from "@excalidraw/excalidraw";
import type { BinaryFiles, AppState } from "@excalidraw/excalidraw/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ipc, type ThumbInfo } from "../platform/ipc";
import { blobToBase64 } from "../platform/nativeFilePickers";
import { setApp, getApp } from "../state/store";
import { parseScene, type Elements } from "../editor/scene";

const THUMB_SIZE = 480;
const AFTER_SAVE_DELAY = 2500;

const info = new Map<string, ThumbInfo>();
const timers = new Map<string, number>();

async function render(elements: Elements, appState: Partial<AppState>, files: BinaryFiles): Promise<Blob | null> {
  const visible = getNonDeletedElements(elements);
  if (!visible.length) return null;
  return exportToBlob({
    elements: visible,
    appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
    files,
    maxWidthOrHeight: THUMB_SIZE,
    exportPadding: 24,
    mimeType: "image/png",
  });
}

async function store(path: string, blob: Blob | null) {
  if (!blob) {
    info.set(path, { path, thumb: null, thumbMtime: Date.now(), boardMtime: 0, exists: true });
  } else {
    const thumb = await ipc.thumbWrite(path, await blobToBase64(blob));
    info.set(path, { path, thumb, thumbMtime: Date.now(), boardMtime: Date.now(), exists: true });
  }
  setApp((s) => ({ thumbVersion: { ...s.thumbVersion, [path]: (s.thumbVersion[path] ?? 0) + 1 } }));
}

/**
 * Regenerates a thumbnail shortly after a save, from exactly the content that
 * was written (so the preview always matches the file on disk).
 */
export function scheduleThumbnail(path: string, content: string) {
  window.clearTimeout(timers.get(path));
  timers.set(
    path,
    window.setTimeout(async () => {
      timers.delete(path);
      try {
        const scene = parseScene(content);
        await store(path, await render(scene.elements, scene.appState, scene.files));
      } catch (e) {
        console.warn("thumbnail failed", e);
      }
    }, AFTER_SAVE_DELAY),
  );
}

// Lazy generation queue for boards that aren't open (one at a time).
const queue: string[] = [];
const queued = new Set<string>();
let running = false;

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const path = queue.shift()!;
    queued.delete(path);
    try {
      const { content, mtime } = await ipc.readText(path);
      const scene = parseScene(content);
      const blob = await render(scene.elements, scene.appState, scene.files);
      // The board may have been saved while we rendered; a live save will
      // schedule its own thumbnail, so drop this one.
      if ((await ipc.stat(path)).mtime !== mtime || timers.has(path)) continue;
      await store(path, blob);
    } catch {
      info.set(path, { path, thumb: null, thumbMtime: 0, boardMtime: 0, exists: false });
    }
    await new Promise((r) => setTimeout(r, 30)); // keep the UI responsive
  }
  running = false;
}

/** Ensures thumbnails exist and are fresh for the given boards. */
export async function ensureThumbnails(paths: string[]) {
  const unknown = paths.filter((p) => !info.has(p));
  if (unknown.length) {
    const infos = await ipc.thumbInfo(unknown);
    for (const i of infos) info.set(i.path, i);
    setApp((s) => {
      const tv = { ...s.thumbVersion };
      for (const i of infos) tv[i.path] = tv[i.path] ?? 0;
      return { thumbVersion: tv };
    });
  }
  for (const p of paths) {
    const i = info.get(p);
    if (!i || !i.exists) continue;
    const stale = i.thumbMtime < i.boardMtime;
    if (stale && !queued.has(p) && !timers.has(p)) {
      queued.add(p);
      queue.push(p);
    }
  }
  void pump();
}

export function thumbUrl(path: string): string | null {
  const i = info.get(path);
  if (!i?.thumb) return null;
  const v = getApp().thumbVersion[path] ?? 0;
  const src = convertFileSrc(i.thumb);
  return src.startsWith("blob:") ? src : `${src}?v=${v}-${i.thumbMtime}`;
}

/** Called after rename/move so cached info follows the board. */
export function forgetThumb(path: string) {
  info.delete(path);
}
