// Finder-style Quick Look: Space on a selected board shows a large read-only
// preview; Space/Escape closes, Enter opens.
import { useEffect, useState } from "react";
import { ipc } from "../platform/ipc";
import { setApp, useApp } from "../state/store";
import { openBoard } from "../lib/boards";
import { boardName, prettyLocation } from "../lib/paths";
import { ScenePreview } from "./Preview";

export function QuickLook() {
  const path = useApp((s) => s.quickLook);
  const root = useApp((s) => s.prefs.libraryRoot);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    setContent(null);
    setError(null);
    ipc.readText(path).then(
      (r) => setContent(r.content),
      () => setError("This board couldn't be read."),
    );
  }, [path]);

  useEffect(() => {
    if (!path) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setApp({ quickLook: null });
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        setApp({ quickLook: null });
        void openBoard(path);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [path]);

  if (!path) return null;
  return (
    <div className="overlay quicklook-overlay" onMouseDown={() => setApp({ quickLook: null })}>
      <div className="quicklook" onMouseDown={(e) => e.stopPropagation()}>
        <div className="quicklook__bar">
          <div>
            <strong>{boardName(path)}</strong>
            <span className="muted"> — {prettyLocation(path, root)}</span>
          </div>
          <button
            className="btn primary small"
            onClick={() => {
              setApp({ quickLook: null });
              void openBoard(path);
            }}
          >
            Open
          </button>
        </div>
        {error ? <div className="scene-preview__msg">{error}</div> : <ScenePreview content={content} />}
      </div>
    </div>
  );
}
