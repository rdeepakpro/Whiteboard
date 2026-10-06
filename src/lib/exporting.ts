/**
 * Quick exports of the whole active board. Excalidraw's own image export
 * dialog (with selection-only, scale, background and dark-mode options) stays
 * available via the main menu / "Export Image Options…".
 */
import { exportToBlob, exportToClipboard, exportToSvg, getNonDeletedElements } from "@excalidraw/excalidraw";
import { save } from "@tauri-apps/plugin-dialog";
import { activeSession } from "../editor/registry";
import { ipc, friendlyError } from "../platform/ipc";
import { blobToBase64 } from "../platform/nativeFilePickers";
import { boardName, dirname, join } from "./paths";
import { toast } from "./toast";
import type { AppState } from "@excalidraw/excalidraw/types";

function sceneForExport() {
  const s = activeSession();
  if (!s?.api) return null;
  const elements = getNonDeletedElements(s.api.getSceneElements());
  if (!elements.length) {
    toast("This board is empty — nothing to export.");
    return null;
  }
  const appState = s.api.getAppState();
  return {
    path: s.path,
    elements,
    files: s.api.getFiles(),
    appState: {
      ...appState,
      exportBackground: appState.exportBackground ?? true,
      exportWithDarkMode: appState.exportWithDarkMode ?? false,
    } as AppState,
  };
}

async function pickTarget(path: string, ext: string, label: string) {
  const target = await save({
    defaultPath: join(dirname(path), `${boardName(path)}.${ext}`),
    filters: [{ name: label, extensions: [ext] }],
  });
  if (!target) return null;
  return target.toLowerCase().endsWith(`.${ext}`) ? target : `${target}.${ext}`;
}

export async function exportPNG() {
  const scene = sceneForExport();
  if (!scene) return;
  const target = await pickTarget(scene.path, "png", "PNG Image");
  if (!target) return;
  try {
    const blob = await exportToBlob({
      ...scene,
      mimeType: "image/png",
      exportPadding: 16,
      getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }),
    });
    await ipc.writeBase64(target, await blobToBase64(blob));
    toast("Exported PNG");
  } catch (e) {
    toast(friendlyError(e, "export the PNG"), "error");
  }
}

export async function exportSVG() {
  const scene = sceneForExport();
  if (!scene) return;
  const target = await pickTarget(scene.path, "svg", "SVG Image");
  if (!target) return;
  try {
    const svg = await exportToSvg({ ...scene, exportPadding: 16 });
    await ipc.writeText(target, svg.outerHTML);
    toast("Exported SVG");
  } catch (e) {
    toast(friendlyError(e, "export the SVG"), "error");
  }
}

export async function copyPNG() {
  const scene = sceneForExport();
  if (!scene) return;
  try {
    await exportToClipboard({ ...scene, type: "png" });
    toast("Copied image to clipboard");
  } catch (e) {
    toast(`Couldn't copy the image: ${e}`, "error");
  }
}
