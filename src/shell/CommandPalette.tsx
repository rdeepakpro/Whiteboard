/**
 * Cmd+K: search boards (name + folder instantly, text inside boards via the
 * Rust index) and run commands. Fully keyboard driven.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { activeTab, allBoards, getApp, setApp, useApp } from "../state/store";
import { ipc } from "../platform/ipc";
import { commands, runCommand } from "../lib/commands";
import { openBoard } from "../lib/boards";
import { boardName, prettyLocation } from "../lib/paths";
import { focusEditor } from "../editor/BoardEditor";
import { Icon } from "./icons";
import { insertWebReference, parseLink } from "../lib/webref";
import { ensureBoard } from "../lib/capture";

type Result =
  | { kind: "board"; path: string; sub: string; archived: boolean }
  | { kind: "text"; path: string; snippet: string }
  | { kind: "command"; id: string; title: string; shortcut?: string }
  | { kind: "insert-url"; url: string };

/**
 * Ranked matching: exact > prefix > word start > substring. Multi-word
 * queries match when every word is found.
 */
function score(hay: string, q: string): number {
  const h = hay.toLowerCase();
  if (!q) return 1;
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.every((w) => new RegExp(`(^|[\\s/·_-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(h))) return 60;
  if (h.includes(q)) return 40;
  if (words.length > 1 && words.every((w) => h.includes(w))) return 30;
  return 0;
}

export function CommandPalette({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState(0);
  const [textHits, setTextHits] = useState<{ path: string; snippet: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tree = useApp((s) => s.tree);
  const recents = useApp((s) => s.recents);
  const archived = useApp((s) => s.archived);
  const root = useApp((s) => s.prefs.libraryRoot);
  const hasBoard = useApp((s) => !!s.activeTabId);

  useEffect(() => inputRef.current?.focus(), []);

  // Full-text search inside boards (debounced, async).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setTextHits([]);
      return;
    }
    const id = window.setTimeout(() => {
      const extra = getApp()
        .recents.map((r) => r.path)
        .filter((p) => !p.startsWith(root));
      ipc.searchText(root, extra, q).then(setTextHits, () => setTextHits([]));
    }, 120);
    return () => window.clearTimeout(id);
  }, [query, root]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    // Slash commands: "/shot", "/embed <url>", or a bare pasted link.
    const raw = query.trim();
    const slashUrl = raw.match(/^\/(embed|url|youtube|instagram)\s+(\S+)$/i)?.[2];
    const directUrl = parseLink(slashUrl ?? (raw.startsWith("/") ? null : raw));
    if (q.startsWith("/")) {
      const word = q.split(/\s+/)[0];
      const slashCmds: Result[] = commands
        .filter((c) => c.slash?.some((s) => s.startsWith(word)))
        .map((c) => ({
          kind: "command",
          id: c.id,
          title: `${c.slash!.find((s) => s.startsWith(word))}  ·  ${c.title}`,
          shortcut: c.shortcut,
        }));
      return directUrl ? [{ kind: "insert-url", url: directUrl }, ...slashCmds] : slashCmds;
    }
    const archivedSet = new Set(archived);
    const boardPaths = new Map<string, number>();
    const recentRank = new Map(recents.map((r, i) => [r.path, i]));
    if (!q) {
      for (const r of recents.slice(0, 8)) boardPaths.set(r.path, 1);
    } else {
      const candidates = new Set([...allBoards(tree).map((b) => b.path), ...recents.map((r) => r.path)]);
      for (const p of candidates) {
        const s = Math.max(
          score(boardName(p), q),
          score(prettyLocation(p, root), q) * 0.6,
          score(`${prettyLocation(p, root)} ${boardName(p)}`, q) * 0.5,
        );
        if (s > 0) boardPaths.set(p, s - (archivedSet.has(p) ? 30 : 0) - (recentRank.get(p) ?? 40) * 0.05);
      }
    }
    const boards: Result[] = [...boardPaths.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path]) => ({ kind: "board", path, sub: prettyLocation(path, root), archived: archivedSet.has(path) }));
    const shown = new Set(boardPaths.keys());
    const text: Result[] = textHits
      .filter((h) => !shown.has(h.path))
      .slice(0, 6)
      .map((h) => ({ kind: "text", ...h }));
    const cmds: Result[] = commands
      .filter((c) => c.palette && (!c.needsBoard || hasBoard))
      .map((c) => ({ c, s: q ? Math.max(score(c.title, q), score(c.keywords ?? "", q) * 0.7) : 1 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, q ? 8 : 12)
      .map(({ c }) => ({ kind: "command", id: c.id, title: c.title, shortcut: c.shortcut }));
    const insert: Result[] = directUrl ? [{ kind: "insert-url", url: directUrl }] : [];
    return [...insert, ...boards, ...text, ...cmds];
  }, [query, tree, recents, archived, root, textHits, hasBoard]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".palette__item.active")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const close = (refocus = true) => {
    setApp({ dialog: null });
    const tab = activeTab();
    if (refocus && tab) window.setTimeout(() => focusEditor(tab.id), 0);
  };

  const run = (r: Result | undefined) => {
    if (!r) return;
    close(r.kind !== "command");
    if (r.kind === "insert-url") {
      void ensureBoard().then((s) => s && insertWebReference(s, r.url));
      return;
    }
    if (r.kind === "command") window.setTimeout(() => runCommand(r.id), 0);
    else void openBoard(r.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  let lastKind = "";
  const heading = (r: Result) => {
    const label =
      r.kind === "insert-url"
        ? "Insert"
        : r.kind === "board"
          ? query.trim()
            ? "Boards"
            : "Recent"
          : r.kind === "text"
            ? "Found in board text"
            : "Commands";
    if (label === lastKind) return null;
    lastKind = label;
    return <div className="palette__heading">{label}</div>;
  };

  return (
    <div className="overlay" onMouseDown={() => close()}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette__input">
          {Icon.search}
          <input
            ref={inputRef}
            value={query}
            placeholder="Search boards, run a command, or paste a link…"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="palette__list" ref={listRef}>
          {results.length === 0 && <div className="palette__empty">No matches</div>}
          {results.map((r, i) => (
            <div key={`${r.kind}:${"path" in r ? r.path : "url" in r ? r.url : r.id}`}>
              {heading(r)}
              <div
                className={`palette__item${i === index ? " active" : ""}`}
                onMouseMove={() => i !== index && setIndex(i)}
                onClick={() => run(r)}
              >
                <span className="palette__icon">
                  {r.kind === "command"
                    ? Icon.chevron
                    : r.kind === "text"
                      ? Icon.search
                      : r.kind === "insert-url"
                        ? Icon.link
                        : Icon.board}
                </span>
                {r.kind === "insert-url" && (
                  <>
                    <span className="palette__title">Insert Web Reference</span>
                    <span className="palette__sub">{r.url}</span>
                  </>
                )}
                {r.kind === "board" && (
                  <>
                    <span className="palette__title">{boardName(r.path)}</span>
                    <span className="palette__sub">
                      {r.archived ? "Archived · " : ""}
                      {r.sub}
                    </span>
                  </>
                )}
                {r.kind === "text" && (
                  <>
                    <span className="palette__title">{boardName(r.path)}</span>
                    <span className="palette__sub snippet">{r.snippet}</span>
                  </>
                )}
                {r.kind === "command" && (
                  <>
                    <span className="palette__title">{r.title}</span>
                    {r.shortcut && <kbd className="palette__kbd">{r.shortcut}</kbd>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
