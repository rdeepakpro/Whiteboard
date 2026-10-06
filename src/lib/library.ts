/**
 * The personal Excalidraw library, shared by every open board and stored in
 * the standard `.excalidrawlib` format at <appData>/library.excalidrawlib.
 */
import {
  getLibraryItemsHash,
  loadLibraryFromBlob,
  mergeLibraryItems,
  restoreLibraryItems,
  serializeLibraryAsJSON,
} from "@excalidraw/excalidraw";
import type { LibraryItems } from "@excalidraw/excalidraw/types";
import { ipc } from "../platform/ipc";
import { readFileAsFile } from "../platform/nativeFilePickers";
import { getApp } from "../state/store";
import { sessions, activeSession } from "../editor/registry";
import { toast } from "./toast";

let items: LibraryItems = [];
let hash = 0;
let saveTimer: number | undefined;

export function libraryItems(): LibraryItems {
  return items;
}

export async function loadLibrary(): Promise<LibraryItems> {
  const file = getApp().paths?.libraryFile;
  if (!file) return [];
  try {
    const { content } = await ipc.readText(file);
    const data = JSON.parse(content);
    items = restoreLibraryItems(data.libraryItems ?? data.library ?? [], "unpublished") as LibraryItems;
  } catch {
    items = [];
  }
  hash = getLibraryItemsHash(items);
  return items;
}

/** Excalidraw's onLibraryChange: persist and propagate to the other tabs. */
export function onLibraryChange(next: LibraryItems, fromTabId?: string) {
  const nextHash = getLibraryItemsHash(next);
  if (nextHash === hash) return;
  items = next;
  hash = nextHash;
  for (const [tabId, s] of sessions) {
    if (tabId !== fromTabId && s.api) s.api.updateLibrary({ libraryItems: next, merge: false });
  }
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const file = getApp().paths?.libraryFile;
    if (file)
      ipc
        .writeText(file, serializeLibraryAsJSON(items))
        .catch((e) => toast(`Couldn't save the library: ${e}`, "error"));
  }, 400);
}

/** Imports a `.excalidrawlib` file by path (File menu, Finder, drag-drop). */
export async function importLibraryFile(path: string) {
  try {
    const file = await readFileAsFile(path);
    const imported = await loadLibraryFromBlob(file, "unpublished");
    const session = activeSession();
    if (session?.api) {
      await session.api.updateLibrary({ libraryItems: imported, merge: true, openLibraryMenu: true });
    } else {
      onLibraryChange(mergeLibraryItems(items, imported));
    }
    toast(`Added ${imported.length} item${imported.length === 1 ? "" : "s"} to your library`);
  } catch {
    toast("That file isn't a valid Excalidraw library.", "error");
  }
}
