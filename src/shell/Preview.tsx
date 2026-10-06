/**
 * Read-only renderings of boards: cached thumbnails (cards) and full vector
 * previews rendered with Excalidraw's exportToSvg (Quick Look, history).
 */
import { useEffect, useRef, useState } from "react";
import { exportToSvg, getNonDeletedElements } from "@excalidraw/excalidraw";
import { useApp } from "../state/store";
import { thumbUrl } from "../lib/thumbnails";
import { parseScene } from "../editor/scene";
import { Icon } from "./icons";

export function Thumb({ path }: { path: string }) {
  useApp((s) => s.thumbVersion[path]); // re-render when regenerated
  const url = thumbUrl(path);
  return (
    <div className="thumb">
      {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb__empty">{Icon.board}</span>}
    </div>
  );
}

export function ScenePreview({ content }: { content: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setEmpty(false);
    const el = ref.current;
    if (!el || content === null) return;
    el.replaceChildren();
    (async () => {
      try {
        const scene = parseScene(content);
        const elements = getNonDeletedElements(scene.elements);
        if (!elements.length) {
          if (!cancelled) setEmpty(true);
          return;
        }
        const svg = await exportToSvg({
          elements,
          appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false },
          files: scene.files,
          exportPadding: 24,
        });
        if (cancelled) return;
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        el.replaceChildren(svg);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [content]);

  return (
    <div className="scene-preview">
      <div ref={ref} className="scene-preview__svg" />
      {content === null && <div className="scene-preview__msg">Loading…</div>}
      {empty && <div className="scene-preview__msg">Empty board</div>}
      {error && <div className="scene-preview__msg">{error}</div>}
    </div>
  );
}
