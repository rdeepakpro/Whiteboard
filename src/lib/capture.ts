/**
 * Screenshot → board. Uses macOS's own screenshot selection UI (via the Rust
 * `capture_screen` command), then inserts the image into the active board as
 * a normal Excalidraw image. Temp files are deleted immediately; the image
 * lives inside the .excalidraw file like any pasted image.
 */
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { ipc } from "../platform/ipc";
import { readFileAsFile } from "../platform/nativeFilePickers";
import { activeSession } from "../editor/registry";
import type { BoardSession } from "../editor/BoardSession";
import { getApp, setApp } from "../state/store";
import { newBoard } from "./boards";
import { base64ToBlob, fileData, insertImage, insertionPoint, prepareImage, type ScenePoint } from "./canvasInsert";
import { toast } from "./toast";

const ASKED_KEY = "whiteboard.screenPermissionAsked";

/** The active board's session, creating a new board if none is open. */
export async function ensureBoard(): Promise<BoardSession | null> {
  if (getApp().mode !== "brainstorm") setApp({ mode: "brainstorm" });
  let s = activeSession();
  if (s?.api) return s;
  if (!s) await newBoard();
  // Wait for the new editor to mount.
  for (let i = 0; i < 40; i++) {
    s = activeSession();
    if (s?.api) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function hasScreenPermission(): Promise<boolean> {
  if (await ipc.screenCaptureAccess(false)) return true;
  let asked = false;
  try {
    asked = localStorage.getItem(ASKED_KEY) === "1";
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* ignore */
  }
  if (!asked) {
    // First time: let macOS show its own prompt (it adds Whiteboard to the list).
    if (await ipc.screenCaptureAccess(true)) return true;
  }
  const open = await ask(
    "To capture other apps' windows, macOS needs you to allow Whiteboard under System Settings → Privacy & Security → Screen Recording. After turning it on, quit and reopen Whiteboard.",
    { title: "Allow Screen Recording", kind: "info", okLabel: "Open System Settings", cancelLabel: "Not Now" },
  );
  if (open) await ipc.openScreenRecordingSettings();
  return false;
}

let busy = false;

export async function captureScreenshot(mode: "region" | "window" | "screen" = "region") {
  if (busy) return;
  busy = true;
  try {
    if (!(await hasScreenPermission())) return;
    // Remember where to put it before the window hides.
    const before = activeSession();
    const point = before?.api ? insertionPoint(before) : null;
    let b64: string | null;
    try {
      b64 = await ipc.captureScreen(mode, getApp().prefs.hideWhileCapturing);
    } catch {
      toast("Couldn't take the screenshot.", "error");
      return;
    }
    if (!b64) return; // cancelled with Esc
    const session = await ensureBoard();
    if (!session?.api) return;
    await insertBlob(session, base64ToBlob(b64, "image/png"), {
      at: session === before && point ? point : undefined,
      pixelRatio: window.devicePixelRatio || 2,
    });
  } finally {
    busy = false;
  }
}

async function insertBlob(session: BoardSession, blob: Blob, opts: { at?: ScenePoint; pixelRatio?: number } = {}) {
  try {
    const img = await prepareImage(blob);
    insertImage(session.api!, img, opts.at ?? insertionPoint(session), { pixelRatio: opts.pixelRatio });
  } catch {
    toast("That image couldn't be read.", "error");
  }
}

/** Inserts whatever image is on the system clipboard. */
export async function insertClipboardImage(opts: { at?: ScenePoint; quiet?: boolean } = {}): Promise<boolean> {
  let b64: string | null = null;
  try {
    b64 = await ipc.clipboardImagePng();
  } catch {
    b64 = null;
  }
  if (!b64) {
    if (!opts.quiet) toast("There's no image on the clipboard.");
    return false;
  }
  const session = await ensureBoard();
  if (!session?.api) return false;
  await insertBlob(session, base64ToBlob(b64, "image/png"), { at: opts.at });
  return true;
}

export async function insertImageBlob(session: BoardSession, blob: Blob, at?: ScenePoint) {
  await insertBlob(session, blob, { at });
}

/** Swaps the image in the selected image element, keeping its width. */
export async function replaceSelectedImage() {
  const session = activeSession();
  const api = session?.api;
  if (!api) return;
  const ids = api.getAppState().selectedElementIds;
  const target = api.getSceneElements().find((e) => ids[e.id] && e.type === "image");
  if (!target) {
    toast("Select an image first.");
    return;
  }
  const picked = await openDialog({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }] });
  if (typeof picked !== "string") return;
  try {
    const img = await prepareImage(await readFileAsFile(picked));
    api.addFiles([fileData(img)]);
    const height = (target.width * img.height) / img.width;
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((e) =>
        e.id === target.id ? ({ ...e, fileId: img.fileId, height, status: "pending", crop: null, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } as any) : e,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  } catch {
    toast("That image couldn't be read.", "error");
  }
}
