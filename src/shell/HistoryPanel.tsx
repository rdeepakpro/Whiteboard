/**
 * Version history for the active board: lists local snapshots grouped by day,
 * previews any of them read-only, restores one (as an undoable step, after
 * snapshotting the current state) or copies it into a new board.
 */
import { useEffect, useMemo, useState } from "react";
import { ipc, type Snapshot } from "../platform/ipc";
import { activeTab, getApp, setApp, useApp } from "../state/store";
import { sessions } from "../editor/registry";
import { parseScene } from "../editor/scene";
import { createBoardFromContent } from "../lib/boards";
import { boardName } from "../lib/paths";
import { dayLabel, formatTime } from "../lib/time";
import { toast } from "../lib/toast";
import { ScenePreview } from "./Preview";
import { Icon } from "./icons";

export function HistoryPanel() {
  const tab = useApp((s) => activeTab(s));
  const path = tab?.path ?? "";
  const status = useApp((s) => (tab ? s.tabStatus[tab.id] : undefined));
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [preview, setPreview] = useState<{ id: number; content: string | null } | null>(null);

  const reload = () => {
    if (!path) return;
    ipc.historyList(path).then(setSnaps, () => setSnaps([]));
  };

  useEffect(() => {
    setPreview(null);
    setSnaps(null);
    // Make sure the latest state is on disk (and snapshotted) first.
    const session = tab ? sessions.get(tab.id) : null;
    void (session?.flush() ?? Promise.resolve()).finally(reload);
  }, [path]);

  // Refresh after saves while the panel is open.
  useEffect(() => {
    if (status && !status.saving) reload();
  }, [status?.saving]);

  const groups = useMemo(() => {
    const out: { label: string; items: Snapshot[] }[] = [];
    for (const s of snaps ?? []) {
      const label = dayLabel(s.id);
      if (out[out.length - 1]?.label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push(s);
    }
    return out;
  }, [snaps]);

  const select = (id: number) => {
    setPreview({ id, content: null });
    ipc.historyRead(path, id).then(
      (content) => setPreview((p) => (p?.id === id ? { id, content } : p)),
      () => toast("That version couldn't be read.", "error"),
    );
  };

  const restore = async () => {
    if (!preview?.content || !tab) return;
    const session = sessions.get(tab.id);
    if (!session) return;
    try {
      const scene = parseScene(preview.content);
      const current = session.serialize();
      if (current) await ipc.historySnapshot(path, current, 0, getApp().prefs.historyMax);
      session.applyScene(scene.elements, scene.appState, scene.files);
      await session.save({ manual: true });
      setPreview(null);
      reload();
      toast(`Restored the version from ${formatTime(preview.id)} — ⌘Z to undo`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't restore that version.", "error");
    }
  };

  const duplicate = async () => {
    if (!preview?.content) return;
    const stamp = `${dayLabel(preview.id)} ${formatTime(preview.id)}`.replace(/[/:]/g, ".");
    await createBoardFromContent(path, `${boardName(path)} (${stamp})`, preview.content);
  };

  return (
    <>
      {preview && (
        <div className="history-preview">
          <div className="history-preview__bar">
            <span>
              Previewing{" "}
              <strong>
                {dayLabel(preview.id)}, {formatTime(preview.id)}
              </strong>{" "}
              — read only
            </span>
            <div className="row gap">
              <button className="btn" onClick={() => setPreview(null)}>
                Close Preview
              </button>
              <button className="btn" onClick={duplicate} disabled={!preview.content}>
                Open as New Board
              </button>
              <button className="btn primary" onClick={restore} disabled={!preview.content}>
                Restore This Version
              </button>
            </div>
          </div>
          <ScenePreview content={preview.content} />
        </div>
      )}
      <aside className="history">
        <div className="history__head">
          <span>Version History</span>
          <button className="icon-btn small" title="Close (⌘Y)" onClick={() => setApp({ historyOpen: false })}>
            {Icon.close}
          </button>
        </div>
        <div className="history__list">
          <button className={`history__item${preview ? "" : " active"}`} onClick={() => setPreview(null)}>
            <span>Current</span>
            <span className="muted">Now</span>
          </button>
          {snaps === null && <div className="history__empty">Loading…</div>}
          {snaps?.length === 0 && (
            <div className="history__empty">
              No earlier versions yet. Whiteboard keeps a snapshot every {getApp().prefs.historyIntervalMin} minutes
              while you work, and whenever you press ⌘S.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="history__day">{g.label}</div>
              {g.items.map((s) => (
                <button
                  key={s.id}
                  className={`history__item${preview?.id === s.id ? " active" : ""}`}
                  onClick={() => select(s.id)}
                >
                  <span>{formatTime(s.id)}</span>
                  <span className="muted">{formatSize(s.size)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
