import { useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { allBoards, setApp, useApp } from "../state/store";
import { ipc, friendlyError, type TrashEntry } from "../platform/ipc";
import { moveInto, newBoard, openBoard, openWithDialog, refreshTree, renamePath, setArchived, trashPath } from "../lib/boards";
import { computeSuggestions, type Suggestion } from "../action/suggest";
import { dismissSuggestion, useAction } from "../action/store";
import { ensureThumbnails } from "../lib/thumbnails";
import { boardName, prettyLocation } from "../lib/paths";
import { relativeTime } from "../lib/time";
import { toast } from "../lib/toast";
import { runCommand } from "../lib/commands";
import { openContextMenu } from "./ContextMenu";
import { boardMenu } from "./menus";
import { Thumb } from "./Preview";
import { Icon } from "./icons";

export function Pages() {
  const page = useApp((s) => s.page);
  return (
    <div className="page" data-tauri-drag-region>
      {page === "recents" ? (
        <RecentsPage />
      ) : page === "favorites" ? (
        <FavoritesPage />
      ) : page === "archive" ? (
        <ArchivePage />
      ) : page === "trash" ? (
        <TrashPage />
      ) : (
        <HomePage />
      )}
    </div>
  );
}

/** Board mtimes from the tree (boards inside the library root). */
function useMtimes() {
  const tree = useApp((s) => s.tree);
  return useMemo(() => new Map(allBoards(tree).map((b) => [b.path, b.mtime])), [tree]);
}

function BoardCard({ path, time, actions }: { path: string; time?: number; actions?: React.ReactNode }) {
  const root = useApp((s) => s.prefs.libraryRoot);
  return (
    <div
      className="card"
      tabIndex={0}
      onClick={() => openBoard(path)}
      onKeyDown={(e) => {
        if (e.key === "Enter") void openBoard(path);
        if (e.key === " ") {
          e.preventDefault();
          setApp({ quickLook: path });
        }
      }}
      onContextMenu={(e) => openContextMenu(e, boardMenu(path))}
    >
      <Thumb path={path} />
      <div className="card__meta">
        <div className="card__name">{boardName(path)}</div>
        <div className="card__sub">
          {prettyLocation(path, root)}
          {time ? ` · ${relativeTime(time)}` : ""}
        </div>
      </div>
      {actions && (
        <div className="card__actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

function BoardGrid({ items, empty }: { items: { path: string; time?: number; actions?: React.ReactNode }[]; empty: string }) {
  const key = items.map((i) => i.path).join("|");
  useEffect(() => {
    void ensureThumbnails(items.map((i) => i.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!items.length) return <div className="page__empty">{empty}</div>;
  return (
    <div className="grid">
      {items.map((i) => (
        <BoardCard key={i.path} {...i} />
      ))}
    </div>
  );
}

function useRecentItems(limit?: number) {
  const recents = useApp((s) => s.recents);
  const archived = useApp((s) => s.archived);
  const mtimes = useMtimes();
  return recents
    .filter((r) => !archived.includes(r.path))
    .slice(0, limit)
    .map((r) => ({ path: r.path, time: Math.max(r.at, mtimes.get(r.path) ?? 0) }));
}

function HomePage() {
  const items = useRecentItems(8);
  return (
    <div className="page__inner home">
      <div className="home__hero">
        <h1>Whiteboard</h1>
        <div className="home__actions">
          <button className="btn primary large" onClick={() => newBoard()}>
            {Icon.plus} New Board
          </button>
          <button className="btn large" onClick={() => openWithDialog()}>
            {Icon.folderOpen} Open…
          </button>
          <button className="btn large" onClick={() => runCommand("new-from-template")}>
            {Icon.template} From Template
          </button>
        </div>
      </div>
      {items.length > 0 && (
        <>
          <div className="page__section-title">
            Recent
            <button className="linkish" onClick={() => setApp({ page: "recents" })}>Show all</button>
          </div>
          <BoardGrid items={items} empty="" />
        </>
      )}
      <TidyUp />
      <div className="home__hint">
        <kbd>⌘N</kbd> new board <span className="sep">·</span> <kbd>⌘K</kbd> search <span className="sep">·</span> <kbd>⇧⌘F</kbd> focus mode
      </div>
    </div>
  );
}

/** Rename / folder suggestions for messy boards. Nothing happens without a click. */
function TidyUp() {
  const [list, setList] = useState<Suggestion[]>([]);
  const dismissed = useAction((s) => s.dismissed);
  const tree = useApp((s) => s.tree);
  const root = useApp((s) => s.prefs.libraryRoot);
  useEffect(() => {
    let cancelled = false;
    computeSuggestions().then((s) => !cancelled && setList(s.filter((x) => x.type !== "todo").slice(0, 5)));
    return () => {
      cancelled = true;
    };
  }, [dismissed, tree]);
  if (!list.length) return null;
  return (
    <div className="tidy">
      <div className="page__section-title">Tidy up</div>
      {list.map((s) => (
        <div key={s.id} className="suggestion">
          <div className="suggestion__main">
            {s.type === "rename" ? (
              <span>
                Rename <strong>{boardName(s.path)}</strong> to <strong>{s.to}</strong>
              </span>
            ) : s.type === "move" ? (
              <span>
                Move <strong>{boardName(s.path)}</strong> to <strong>{prettyLocation(`${s.folder}/x`, root)}</strong>
              </span>
            ) : null}
          </div>
          <div className="suggestion__actions">
            <button className="btn small" onClick={() => openBoard(s.path)}>Look</button>
            <button
              className="btn small primary"
              onClick={async () => {
                dismissSuggestion(s.id);
                if (s.type === "rename") await renamePath(s.path, s.to);
                if (s.type === "move") await moveInto(s.path, s.folder);
              }}
            >
              {s.type === "rename" ? "Rename" : "Move"}
            </button>
            <button className="icon-btn small" title="Dismiss" onClick={() => dismissSuggestion(s.id)}>
              {Icon.close}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentsPage() {
  const items = useRecentItems();
  return (
    <div className="page__inner">
      <h2 className="page__title">Recents</h2>
      <BoardGrid items={items} empty="Boards you open will appear here." />
    </div>
  );
}

function FavoritesPage() {
  const favorites = useApp((s) => s.favorites);
  const mtimes = useMtimes();
  return (
    <div className="page__inner">
      <h2 className="page__title">Favorites</h2>
      <BoardGrid
        items={favorites.map((p) => ({ path: p, time: mtimes.get(p) }))}
        empty="Right-click any board and choose “Add to Favorites”."
      />
    </div>
  );
}

function ArchivePage() {
  const archived = useApp((s) => s.archived);
  const mtimes = useMtimes();
  return (
    <div className="page__inner">
      <h2 className="page__title">Archive</h2>
      <p className="page__lead">Archived boards are hidden from your workspaces but kept exactly where they are.</p>
      <BoardGrid
        items={archived.map((p) => ({
          path: p,
          time: mtimes.get(p),
          actions: (
            <>
              <button className="btn small" onClick={() => setArchived(p, false)}>Unarchive</button>
              <button className="btn small" onClick={() => trashPath(p)}>Move to Trash</button>
            </>
          ),
        }))}
        empty="Nothing archived."
      />
    </div>
  );
}

function TrashPage() {
  const root = useApp((s) => s.prefs.libraryRoot);
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const reload = () => ipc.trashList().then(setEntries, () => setEntries([]));
  useEffect(() => {
    void reload();
  }, []);

  const restore = async (e: TrashEntry) => {
    try {
      const to = await ipc.trashRestore(e.id);
      await refreshTree();
      toast(`Restored “${e.name}”`, "info", e.kind === "board" ? { label: "Open", run: () => openBoard(to) } : undefined);
    } catch (err) {
      toast(friendlyError(err, "restore it"), "error");
    }
    void reload();
  };

  const remove = async (e: TrashEntry) => {
    const ok = await ask(`Permanently delete “${e.name}”? This can't be undone.`, {
      title: "Delete Permanently",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    await ipc.trashDelete(e.id).catch((err) => toast(friendlyError(err, "delete it"), "error"));
    void reload();
  };

  const empty = async () => {
    const ok = await ask(`Permanently delete all ${entries?.length} item(s) in the Trash? This can't be undone.`, {
      title: "Empty Trash",
      kind: "warning",
      okLabel: "Empty Trash",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    await ipc.trashEmpty().catch((err) => toast(friendlyError(err, "empty the Trash"), "error"));
    void reload();
  };

  return (
    <div className="page__inner">
      <div className="page__title-row">
        <h2 className="page__title">Trash</h2>
        {!!entries?.length && <button className="btn" onClick={empty}>Empty Trash…</button>}
      </div>
      <p className="page__lead">Deleted boards and folders stay here until you delete them permanently.</p>
      {entries?.length === 0 && <div className="page__empty">Trash is empty.</div>}
      <div className="list">
        {entries?.map((e) => (
          <div key={e.id} className="list__row">
            <span className="row__icon">{e.kind === "folder" ? Icon.folder : Icon.board}</span>
            <div className="list__main">
              <div>{e.name}</div>
              <div className="muted small">
                From {prettyLocation(e.originalPath, root)} · deleted {relativeTime(e.deletedAt)}
              </div>
            </div>
            <button className="btn small" onClick={() => restore(e)}>Restore</button>
            <button className="btn small danger" onClick={() => remove(e)}>Delete Permanently…</button>
          </div>
        ))}
      </div>
    </div>
  );
}
