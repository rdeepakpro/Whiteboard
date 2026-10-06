/**
 * One BoardSession per open tab. It owns everything about keeping a board's
 * file in sync with its Excalidraw instance:
 *
 *  - debounced autosave (with a max-wait so long drawing sessions still save)
 *  - conflict detection via the file's mtime (never overwrites external edits)
 *  - detection of external changes / deletion while the board is open
 *  - version-history snapshots and thumbnail regeneration after saves
 *
 * The session deliberately keeps hot-path state in plain fields instead of
 * React state so Excalidraw's frequent onChange calls never re-render the shell.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { ipc, errorCode, friendlyError } from "../platform/ipc";
import { getApp, setTabStatus } from "../state/store";
import { parseScene, sceneSignature, serializeScene, type Elements } from "./scene";
import { scheduleThumbnail } from "../lib/thumbnails";
import { touchRecent } from "../lib/recents";
import { toast } from "../lib/toast";

const MAX_WAIT_MS = 8000;
const RETRY_MS = 5000;

export class BoardSession {
  api: ExcalidrawImperativeAPI | null = null;
  /** Last pointer position over this canvas, in scene coordinates. */
  lastPointer: { x: number; y: number; at: number } | null = null;
  /** mtime of the file as of our last read/write; null for never-saved. */
  knownMtime: number | null = null;
  /** Content as loaded from disk (snapshotted before the first save). */
  private originalContent: string | null = null;
  private savedSig: string | null = null;
  private latestSig: string | null = null;
  private debounceTimer: number | undefined;
  private maxWaitTimer: number | undefined;
  private retryTimer: number | undefined;
  private saving: Promise<boolean> | null = null;
  private pendingAfterSave = false;
  /** Autosave is paused while a conflict/missing-file prompt is unresolved. */
  private suspended = false;
  private checking = false;
  private disposed = false;

  constructor(
    readonly tabId: string,
    public path: string,
  ) {}

  get isDirty() {
    return this.latestSig !== null && this.latestSig !== this.savedSig;
  }

  /** Reads and parses the board file. Throws a user-presentable error. */
  async load() {
    const { content, mtime } = await ipc.readText(this.path);
    const scene = parseScene(content);
    this.knownMtime = mtime;
    this.originalContent = content;
    return scene;
  }

  attach(api: ExcalidrawImperativeAPI) {
    this.api = api;
  }

  /** Called from Excalidraw's onChange. Must stay cheap. */
  onChange(elements: Elements, appState: AppState, files: BinaryFiles) {
    if (this.disposed) return;
    const sig = sceneSignature(elements, appState, files);
    if (this.savedSig === null) {
      // First onChange after mount reflects the loaded file: baseline only.
      this.savedSig = sig;
      this.latestSig = sig;
      return;
    }
    if (sig === this.latestSig) return;
    this.latestSig = sig;
    if (sig === this.savedSig) {
      setTabStatus(this.tabId, { dirty: false });
      return;
    }
    setTabStatus(this.tabId, { dirty: true });
    this.scheduleSave();
  }

  private scheduleSave() {
    const prefs = getApp().prefs;
    if (!prefs.autosave || this.suspended) return;
    window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => void this.save(), prefs.autosaveDelayMs);
    if (this.maxWaitTimer === undefined) {
      this.maxWaitTimer = window.setTimeout(() => {
        this.maxWaitTimer = undefined;
        void this.save();
      }, MAX_WAIT_MS);
    }
  }

  private clearTimers() {
    window.clearTimeout(this.debounceTimer);
    window.clearTimeout(this.maxWaitTimer);
    window.clearTimeout(this.retryTimer);
    this.debounceTimer = this.maxWaitTimer = this.retryTimer = undefined;
  }

  /** Current scene as `.excalidraw` JSON. */
  serialize(): string | null {
    if (!this.api) return null;
    return serializeScene(this.api.getSceneElementsIncludingDeleted(), this.api.getAppState(), this.api.getFiles());
  }

  /**
   * Saves if there are unsaved changes. Returns true when the file on disk
   * now matches the editor. `force` skips the external-change check (used for
   * "Keep Whiteboard version").
   */
  async save(opts: { force?: boolean; manual?: boolean } = {}): Promise<boolean> {
    if (this.saving) {
      this.pendingAfterSave = true;
      return this.saving;
    }
    if (this.suspended && !opts.force) return false;
    if (!this.isDirty && !opts.force && !opts.manual) return true;
    this.clearTimers();
    this.saving = this.doSave(opts).finally(() => {
      this.saving = null;
      if (this.pendingAfterSave) {
        this.pendingAfterSave = false;
        if (this.isDirty) this.scheduleSave();
      }
    });
    return this.saving;
  }

  private async doSave(opts: { force?: boolean; manual?: boolean }): Promise<boolean> {
    if (!this.api) return false;
    const sig = this.latestSig;
    const content = this.serialize();
    if (!content) return false;
    const { historyIntervalMin, historyMax } = getApp().prefs;
    setTabStatus(this.tabId, { saving: true });

    // Before the first write of this session, keep the pre-edit version.
    if (this.originalContent) {
      const original = this.originalContent;
      this.originalContent = null;
      await ipc.historySnapshot(this.path, original, 0, historyMax).catch(() => {});
    }

    try {
      const mtime = await ipc.writeBoard(this.path, content, opts.force ? null : this.knownMtime);
      this.knownMtime = mtime;
      this.savedSig = sig;
      this.suspended = false;
      setTabStatus(this.tabId, {
        saving: false,
        dirty: this.isDirty,
        error: null,
        conflict: false,
        missing: false,
      });
      const interval = opts.manual ? 0 : historyIntervalMin * 60_000;
      ipc.historySnapshot(this.path, content, interval, historyMax).catch(() => {});
      scheduleThumbnail(this.path, content);
      touchRecent(this.path, { quiet: true });
      return true;
    } catch (e) {
      const code = errorCode(e);
      if (code === "CONFLICT") {
        this.suspended = true;
        setTabStatus(this.tabId, { saving: false, conflict: true });
      } else if (code === "NOT_FOUND") {
        this.suspended = true;
        setTabStatus(this.tabId, { saving: false, missing: true });
      } else {
        const msg = friendlyError(e, "save this board");
        setTabStatus(this.tabId, { saving: false, error: msg });
        if (opts.manual) toast(msg, "error");
        // Keep the unsaved changes in memory and try again shortly.
        this.retryTimer = window.setTimeout(() => void this.save(), RETRY_MS);
      }
      return false;
    }
  }

  /** Saves immediately and waits for it — used on close/quit/rename. */
  async flush(): Promise<boolean> {
    if (this.saving) await this.saving;
    if (!this.isDirty) return true;
    if (this.suspended) return false;
    return this.save();
  }

  /**
   * Checks whether the file changed on disk behind our back. Clean boards are
   * reloaded silently; boards with unsaved edits get a conflict prompt.
   */
  async checkExternal() {
    if (this.checking || this.saving || this.disposed || this.knownMtime === null || !this.api) return;
    this.checking = true;
    try {
      const st = await ipc.stat(this.path);
      if (!st.exists) {
        if (!getApp().tabStatus[this.tabId]?.missing) {
          this.suspended = true;
          setTabStatus(this.tabId, { missing: true });
        }
        return;
      }
      if (getApp().tabStatus[this.tabId]?.missing) {
        // File came back (e.g. iCloud finished downloading).
        this.suspended = false;
        setTabStatus(this.tabId, { missing: false });
      }
      if (st.mtime === this.knownMtime) return;
      if (this.isDirty) {
        this.suspended = true;
        setTabStatus(this.tabId, { conflict: true });
      } else {
        await this.reloadFromDisk({ quiet: true });
      }
    } catch {
      /* transient — try next time */
    } finally {
      this.checking = false;
    }
  }

  /** Replaces the canvas with the file on disk (undoable). */
  async reloadFromDisk(opts: { quiet?: boolean } = {}) {
    if (!this.api) return;
    // Preserve what's on screen first, so nothing is ever lost.
    const current = this.serialize();
    if (current && this.isDirty) {
      await ipc.historySnapshot(this.path, current, 0, getApp().prefs.historyMax).catch(() => {});
    }
    try {
      const { content, mtime } = await ipc.readText(this.path);
      const scene = parseScene(content);
      this.applyScene(scene.elements, scene.appState, scene.files);
      this.knownMtime = mtime;
      this.suspended = false;
      this.savedSig = null; // re-baseline on the next onChange
      setTabStatus(this.tabId, { dirty: false, conflict: false, missing: false, error: null });
      if (opts.quiet) toast("Updated with changes made outside Whiteboard");
    } catch (e) {
      toast(e instanceof Error ? e.message : friendlyError(e, "reload this board"), "error");
    }
  }

  /** Loads another scene (snapshot, reload) into this editor as one undo step. */
  applyScene(elements: Elements, appState: Partial<AppState>, files: BinaryFiles) {
    if (!this.api) return;
    const fileList = Object.values(files ?? {});
    if (fileList.length) this.api.addFiles(fileList);
    this.api.updateScene({
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
        gridSize: appState.gridSize,
        gridModeEnabled: appState.gridModeEnabled,
      } as AppState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }

  /** Resolves a conflict by writing the editor's version over the disk. */
  async keepMine() {
    // Back up the external version before overwriting it.
    try {
      const { content } = await ipc.readText(this.path);
      await ipc.historySnapshot(this.path, content, 0, getApp().prefs.historyMax);
    } catch {
      /* file may be gone */
    }
    this.suspended = false;
    return this.save({ force: true });
  }

  /** Points this session at a new path (after rename/move/Save As). */
  setPath(path: string, mtime?: number) {
    this.path = path;
    if (mtime !== undefined) this.knownMtime = mtime;
  }

  /** Marks the file as freshly written elsewhere (e.g. Save As). */
  markSaved(mtime: number) {
    this.knownMtime = mtime;
    this.savedSig = this.latestSig;
    this.suspended = false;
    setTabStatus(this.tabId, { dirty: false, conflict: false, missing: false, error: null });
  }

  /** Called when the editor unmounts. Reversible (React may remount). */
  dispose() {
    this.disposed = true;
    this.clearTimers();
  }

  revive() {
    this.disposed = false;
  }
}
