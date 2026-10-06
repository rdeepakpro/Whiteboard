/**
 * Thin helpers over Excalidraw's own serialization (`serializeAsJSON`,
 * `restore`). Whiteboard never adds custom data to `.excalidraw` files.
 */
import { restore, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

export type Elements = readonly ExcalidrawElement[];

export interface ParsedScene {
  elements: Elements;
  appState: Partial<AppState>;
  files: BinaryFiles;
}

export class SceneParseError extends Error {}

/** Parses + restores `.excalidraw` JSON exactly like Excalidraw's loader does. */
export function parseScene(content: string): ParsedScene {
  let data: any;
  try {
    data = JSON.parse(content);
  } catch {
    throw new SceneParseError("This file isn't valid JSON, so it can't be opened as a board.");
  }
  const valid =
    data &&
    typeof data === "object" &&
    data.type === "excalidraw" &&
    (!data.elements || Array.isArray(data.elements)) &&
    (!data.appState || typeof data.appState === "object");
  if (!valid) {
    throw new SceneParseError("This file isn't an Excalidraw drawing.");
  }
  const restored = restore(data, null, null, { repairBindings: true });
  return {
    elements: restored.elements,
    appState: restored.appState,
    files: restored.files ?? {},
  };
}

export function serializeScene(elements: Elements, appState: Partial<AppState>, files: BinaryFiles): string {
  return serializeAsJSON(elements, appState as AppState, files, "local");
}

export function emptySceneJSON(): string {
  return serializeAsJSON([], { viewBackgroundColor: "#ffffff" } as AppState, {}, "local");
}

/** Plain text of a scene, used for cheap previews/titles. */
export function sceneSignature(elements: Elements, appState: AppState, files: BinaryFiles): string {
  let v = 0;
  for (const el of elements) v = (v * 31 + el.version + (el.isDeleted ? 7 : 0)) | 0;
  return `${elements.length}:${v}:${appState.viewBackgroundColor}:${appState.gridSize}:${appState.gridModeEnabled}:${Object.keys(files).length}`;
}
