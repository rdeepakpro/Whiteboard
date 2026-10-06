// Small popover to link an Action item to a Brainstorm board.
import { useEffect, useMemo, useRef, useState } from "react";
import { allBoards, useApp } from "../state/store";
import { boardName, prettyLocation } from "../lib/paths";
import { Icon } from "../shell/icons";
import { relatedBoards } from "./suggest";

export function BoardPicker({
  seedText,
  current,
  onPick,
  onClose,
}: {
  seedText: string;
  current: string | null;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const tree = useApp((s) => s.tree);
  const recents = useApp((s) => s.recents);
  const root = useApp((s) => s.prefs.libraryRoot);
  const [q, setQ] = useState("");
  const [related, setRelated] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    relatedBoards({ text: seedText }).then(setRelated, () => {});
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [seedText, onClose]);

  const results = useMemo(() => {
    const all = [...new Set([...recents.map((r) => r.path), ...allBoards(tree).map((b) => b.path)])];
    const query = q.trim().toLowerCase();
    if (!query) return [...new Set([...related, ...all])].slice(0, 8);
    return all.filter((p) => `${boardName(p)} ${prettyLocation(p, root)}`.toLowerCase().includes(query)).slice(0, 8);
  }, [q, tree, recents, related, root]);

  return (
    <div className="picker" ref={ref}>
      <input
        autoFocus
        placeholder="Link a board…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && results[0] && onPick(results[0])}
      />
      <div className="picker__list">
        {results.map((p) => (
          <button key={p} className={`picker__item${p === current ? " current" : ""}`} onClick={() => onPick(p)}>
            {Icon.board}
            <span className="picker__name">{boardName(p)}</span>
            <span className="picker__sub">{!q && related.includes(p) ? "Related" : prettyLocation(p, root)}</span>
          </button>
        ))}
        {!results.length && <div className="picker__empty">No boards match</div>}
      </div>
    </div>
  );
}
