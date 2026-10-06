/**
 * Helpers for putting things onto the active Excalidraw canvas: where to
 * place them, preparing image data, and inserting image elements. Images are
 * stored the normal Excalidraw way (as `files` inside the .excalidraw file),
 * so they survive saving, quitting and reopening with no external references.
 */
import { CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { BoardSession } from "../editor/BoardSession";

export interface ScenePoint {
  x: number;
  y: number;
}

/** Last pointer position over the canvas (scene coords), or the viewport center. */
export function insertionPoint(session: BoardSession, maxAgeMs = 15_000): ScenePoint {
  const api = session.api!;
  const p = session.lastPointer;
  if (p && Date.now() - p.at < maxAgeMs && isInViewport(api, p)) return { x: p.x, y: p.y };
  return viewportCenter(api);
}

export function viewportCenter(api: ExcalidrawImperativeAPI): ScenePoint {
  const s = api.getAppState();
  return { x: -s.scrollX + s.width / 2 / s.zoom.value, y: -s.scrollY + s.height / 2 / s.zoom.value };
}

function isInViewport(api: ExcalidrawImperativeAPI, p: ScenePoint) {
  const s = api.getAppState();
  const left = -s.scrollX;
  const top = -s.scrollY;
  return p.x >= left && p.y >= top && p.x <= left + s.width / s.zoom.value && p.y <= top + s.height / s.zoom.value;
}

/** Client (window) coordinates → scene coordinates. */
export function clientToScene(api: ExcalidrawImperativeAPI, clientX: number, clientY: number): ScenePoint {
  const s = api.getAppState();
  return {
    x: (clientX - s.offsetLeft) / s.zoom.value - s.scrollX,
    y: (clientY - s.offsetTop) / s.zoom.value - s.scrollY,
  };
}

// ----------------------------------------------------------- image data

export interface PreparedImage {
  fileId: FileId;
  dataURL: DataURL;
  mimeType: string;
  width: number; // pixels
  height: number;
}

async function hashId(dataURL: string): Promise<FileId> {
  try {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(dataURL));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("") as FileId;
  } catch {
    let h = 0x811c9dc5;
    for (let i = 0; i < dataURL.length; i++) h = Math.imul(h ^ dataURL.charCodeAt(i), 0x01000193);
    return `wb${(h >>> 0).toString(16)}${dataURL.length.toString(16)}` as FileId;
  }
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable image"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), type, quality),
  );
}

/**
 * Decodes an image, downsizes it if larger than `maxSide`, and re-encodes
 * oversized results as JPEG so boards stay light.
 */
export async function prepareImage(
  blob: Blob,
  opts: { maxSide?: number; preferJpeg?: boolean; maxBytes?: number } = {},
): Promise<PreparedImage> {
  const { maxSide = 2560, preferJpeg = false, maxBytes = 3_500_000 } = opts;
  const img = await loadImage(blob);
  let { naturalWidth: w, naturalHeight: h } = img;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  let out: Blob = blob;
  const passthrough =
    scale === 1 && !preferJpeg && blob.size <= maxBytes && /^image\/(png|jpeg|gif|webp)$/.test(blob.type);
  if (!passthrough) {
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    out = preferJpeg ? await canvasToBlob(canvas, "image/jpeg", 0.85) : await canvasToBlob(canvas, "image/png");
    if (out.size > maxBytes) out = await canvasToBlob(canvas, "image/jpeg", 0.88);
  }
  const dataURL = (await blobToDataURL(out)) as DataURL;
  return { fileId: await hashId(dataURL), dataURL, mimeType: out.type || "image/png", width: w, height: h };
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function fileData(img: PreparedImage): BinaryFileData {
  return {
    id: img.fileId,
    dataURL: img.dataURL,
    mimeType: img.mimeType as BinaryFileData["mimeType"],
    created: Date.now(),
    lastRetrieved: Date.now(),
  };
}

/**
 * Inserts an image as a normal Excalidraw image element, centered on `at`.
 * `pixelRatio` > 1 shows Retina screenshots at their on-screen size.
 */
export function insertImage(
  api: ExcalidrawImperativeAPI,
  img: PreparedImage,
  at: ScenePoint,
  opts: { pixelRatio?: number } = {},
) {
  const s = api.getAppState();
  const ratio = opts.pixelRatio ?? 1;
  let w = img.width / ratio;
  let h = img.height / ratio;
  // Never cover more than ~70% of the visible canvas.
  const maxW = (s.width / s.zoom.value) * 0.7;
  const maxH = (s.height / s.zoom.value) * 0.7;
  const fit = Math.min(1, maxW / w, maxH / h);
  w *= fit;
  h *= fit;
  api.addFiles([fileData(img)]);
  const [el] = convertToExcalidrawElements(
    [{ type: "image", fileId: img.fileId, x: at.x - w / 2, y: at.y - h / 2, width: w, height: h } as any],
    { regenerateIds: true },
  );
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), el],
    appState: { selectedElementIds: { [el.id]: true }, selectedGroupIds: {} } as any,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return el;
}
