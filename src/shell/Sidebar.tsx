import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeTab, findNode, setApp, getApp, useApp, type TreeNode } from "../state/store";
import { schedulePersist } from "../state/persist";
import { moveInto, newBoard, openBoard, renamePath, trashPath } from "../lib/boards";
import { boardName, dirname, isInside } from "../lib/paths";
import { runCommand } from "../lib/commands";
import { openContextMenu } from "./ContextMenu";
import { boardMenu, folderMenu } from "./menus";
import { beginPointerDrag, useDnd } from "./dnd";
import { Icon } from "./icons";
import { ModeSwitch } from "./ModeSwitch";

const MIN_WIDTH = 200;
const MAX_WIDTH = 420;

export function Sidebar() {
  const width = useApp((s) => s.sidebarWidth);
  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar__top" data-tauri-drag-region>
        <ModeSwitch />
      </div>
      <div className="sidebar__new">
        <button className="new-board" onClick={() => newBoard()} title="New Board (⌘N)">
          <span className="new-board__icon">{Icon.plus}</span>
          New Board
        </button>
        <button className="icon-btn" title="New from Template (⌥⌘N)" onClick={() => runCommand("new-from-template")}>
          {Icon.template}
        </button>
        <button className="icon-btn" title="Search (⌘K)" onClick={() => runCommand("palette")}>
          {Icon.search}
        </button>
        <button className="icon-btn" title="Hide Sidebar (⌘\)" onClick={() => runCommand("toggle-sidebar")}>
          {Icon.sidebar}
        </button>
      </div>
      <div className="sidebar__scroll">
        <NavLinks />
        <FavoritesSection />
        <RecentsSection />
        <WorkspaceTree />
      </div>
      <div className="sidebar__bottom">
        <PageLink page="archive" icon={Icon.archive} label="Archive" />
        <PageLink page="trash" icon={Icon.trash} label="Trash" />
        <button className="icon-btn sidebar__gear" title="Settings (⌘,)" onClick={() => runCommand("settings")}>
          {Icon.gear}
        </button>
      </div>
      <ResizeHandle />
      <DragGhost />
    </aside>
  );
}

function PageLink({ page, icon, label }: { page: "archive" | "trash" | "home"; icon: React.ReactNode; label: string }) {
  const current = useApp((s) => s.page);
  return (
    <button className={`nav-row${current === page ? " active" : ""}`} onClick={() => setApp({ page })}>
      <span className="nav-row__icon">{icon}</span>
      {label}
    </button>
  );
}

function NavLinks() {
  const page = useApp((s) => s.page);
  const noTabs = useApp((s) => s.tabs.length === 0);
  return (
    <div className="nav">
      <button
        className={`nav-row${page === "home" || (noTabs && !page) ? " active" : ""}`}
        onClick={() => setApp({ page: "home" })}
      >
        <span className="nav-row__icon">{Icon.home}</span>
        Home
      </button>
    </div>
  );
}

function SectionHeader({ label, onClick, action }: { label: string; onClick?: () => void; action?: React.ReactNode }) {
  return (
    <div className="section-header">
      <button className="section-header__label" onClick={onClick} disabled={!onClick}>
        {label}
      </button>
      {action}
    </div>
  );
}

function FavoritesSection() {
  const show = useApp((s) => s.prefs.showFavoritesInSidebar);
  const favorites = useApp((s) => s.favorites);
  const archived = useApp((s) => s.archived);
  const list = favorites.filter((p) => !archived.includes(p));
  if (!show || !list.length) return null;
  return (
    <div className="section">
      <SectionHeader label="Favorites" onClick={() => setApp({ page: "favorites" })} />
      {list.map((p) => (
        <ShortcutRow key={p} path={p} icon={Icon.starFilled} iconClass="star" />
      ))}
    </div>
  );
}

function RecentsSection() {
  const show = useApp((s) => s.prefs.showRecentsInSidebar);
  const recents = useApp((s) => s.recents);
  const archived = useApp((s) => s.archived);
  const list = recents.filter((r) => !archived.includes(r.path)).slice(0, 5);
  if (!show || !list.length) return null;
  return (
    <div className="section">
      <SectionHeader label="Recents" onClick={() => setApp({ page: "recents" })} />
      {list.map((r) => (
        <ShortcutRow key={r.path} path={r.path} icon={Icon.clock} />
      ))}
    </div>
  );
}

/** A non-tree row pointing at a board (Favorites / Recents). */
function ShortcutRow({ path, icon, iconClass }: { path: string; icon: React.ReactNode; iconClass?: string }) {
  const isActive = useApp((s) => activeTab(s)?.path === path && !s.page);
  return (
    <button
      className={`row${isActive ? " active" : ""}`}
      style={{ paddingLeft: 10 }}
      onClick={() => openBoard(path)}
      onContextMenu={(e) => openContextMenu(e, boardMenu(path))}
      title={path}
    >
      <span className={`row__icon ${iconClass ?? ""}`}>{icon}</span>
      <span className="row__name">{boardName(path)}</span>
    </button>
  );
}

// ----------------------------------------------------------------- tree

function visibleRows(
  nodes: TreeNode[],
  expanded: Record<string, boolean>,
  archived: Set<string>,
  out: TreeNode[] = [],
) {
  for (const n of nodes) {
    if (n.kind === "board" && archived.has(n.path)) continue;
    out.push(n);
    if (n.kind === "folder" && expanded[n.path] && n.children) visibleRows(n.children, expanded, archived, out);
  }
  return out;
}

function WorkspaceTree() {
  const tree = useApp((s) => s.tree);
  const root = useApp((s) => s.prefs.libraryRoot);
  const over = useDnd((s) => s.over);
  const dragging = useDnd((s) => !!s.item);
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const s = getApp();
    const rows = visibleRows(s.tree, s.expanded, new Set(s.archived));
    const i = rows.findIndex((r) => r.path === s.selected);
    const cur = rows[i];
    const select = (n?: TreeNode) => {
      if (!n) return;
      setApp({ selected: n.path });
      ref.current
        ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(n.path)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    switch (e.key) {
      case "ArrowDown":
        select(rows[Math.min(rows.length - 1, i + 1)] ?? rows[0]);
        break;
      case "ArrowUp":
        select(rows[Math.max(0, i - 1)] ?? rows[0]);
        break;
      case "ArrowRight":
        if (cur?.kind === "folder") setExpanded(cur.path, true);
        break;
      case "ArrowLeft":
        if (cur?.kind === "folder" && s.expanded[cur.path]) setExpanded(cur.path, false);
        else if (cur && dirname(cur.path) !== s.prefs.libraryRoot)
          select(findNode(s.tree, dirname(cur.path)) ?? undefined);
        break;
      case "Enter":
        if (cur?.kind === "board") void openBoard(cur.path);
        else if (cur) setApp({ renaming: cur.path });
        break;
      case " ":
        if (cur?.kind === "board") setApp({ quickLook: s.quickLook ? null : cur.path });
        break;
      case "Backspace":
        if (cur && e.metaKey) void trashPath(cur.path);
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  }, []);

  return (
    <div className="section">
      <div className={`section-header${dragging && over === root ? " drop" : ""}`} data-drop={root}>
        <span className="section-header__label static">Workspaces</span>
        <button className="icon-btn small" title="New Folder (⇧⌘N)" onClick={() => runCommand("new-folder")}>
          {Icon.plus}
        </button>
      </div>
      <div className="tree" ref={ref} tabIndex={0} onKeyDown={onKeyDown} role="tree">
        {tree.length === 0 && <div className="tree__empty">No boards yet</div>}
        {tree.map((n) => (
          <TreeRow key={n.path} node={n} depth={0} />
        ))}
      </div>
    </div>
  );
}

function setExpanded(path: string, value: boolean) {
  setApp((s) => ({ expanded: { ...s.expanded, [path]: value } }));
  schedulePersist();
}

const TreeRow = memo(function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const isFolder = node.kind === "folder";
  const expanded = useApp((s) => !!s.expanded[node.path]);
  const selected = useApp((s) => s.selected === node.path);
  const isActive = useApp((s) => !isFolder && !s.page && activeTab(s)?.path === node.path);
  const renaming = useApp((s) => s.renaming === node.path);
  const archived = useApp((s) => !isFolder && s.archived.includes(node.path));
  const isFav = useApp((s) => !isFolder && s.favorites.includes(node.path));
  const dropOver = useDnd((s) => isFolder && !!s.item && s.over === node.path && !isInside(node.path, s.item.path));
  const visibleChildren = useMemo(() => node.children ?? [], [node.children]);

  if (archived) return null;

  const onClick = () => {
    setApp({ selected: node.path });
    if (isFolder) setExpanded(node.path, !expanded);
    else void openBoard(node.path);
  };

  return (
    <>
      <div
        className={`row tree-row${selected ? " selected" : ""}${isActive ? " active" : ""}${dropOver ? " drop" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        data-path={node.path}
        data-drop={isFolder ? node.path : undefined}
        role="treeitem"
        aria-expanded={isFolder ? expanded : undefined}
        onClick={onClick}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest(".row__name")) setApp({ renaming: node.path });
        }}
        onPointerDown={(e) =>
          !renaming &&
          beginPointerDrag(e, { path: node.path, kind: node.kind, label: node.name }, (target) => {
            if (target !== node.path) void moveInto(node.path, target);
          })
        }
        onContextMenu={(e) => {
          setApp({ selected: node.path });
          openContextMenu(e, isFolder ? folderMenu(node.path) : boardMenu(node.path, { inTree: true }));
        }}
      >
        <span className={`row__chev${isFolder ? "" : " hidden"}${expanded ? " open" : ""}`}>{Icon.chevron}</span>
        <span className="row__icon">{isFolder ? (expanded ? Icon.folderOpenAlt : Icon.folder) : Icon.board}</span>
        {renaming ? (
          <RenameInput path={node.path} initial={node.name} />
        ) : (
          <span className="row__name">{node.name}</span>
        )}
        {isFav && <span className="row__badge star">{Icon.starFilled}</span>}
        <button
          className="row__more icon-btn small"
          tabIndex={-1}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setApp({ selected: node.path });
            const r = e.currentTarget.getBoundingClientRect();
            openContextMenu(
              { clientX: r.left, clientY: r.bottom + 2 },
              isFolder ? folderMenu(node.path) : boardMenu(node.path, { inTree: true }),
            );
          }}
        >
          {Icon.more}
        </button>
      </div>
      {isFolder && expanded && (
        <>
          {visibleChildren.map((c) => (
            <TreeRow key={c.path} node={c} depth={depth + 1} />
          ))}
          {visibleChildren.length === 0 && (
            <div className="row tree-row empty" style={{ paddingLeft: 6 + (depth + 1) * 14 + 20 }}>
              Empty
            </div>
          )}
        </>
      )}
    </>
  );
});

export function RenameInput({ path, initial, onDone }: { path: string; initial: string; onDone?: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    setApp({ renaming: null });
    onDone?.();
    if (commit && value.trim() && value.trim() !== initial) void renamePath(path, value.trim());
  };
  return (
    <input
      ref={ref}
      className="rename-input"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

function ResizeHandle() {
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = getApp().sidebarWidth;
    document.body.classList.add("is-resizing");
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + ev.clientX - startX)));
      setApp({ sidebarWidth: w });
    };
    const up = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      schedulePersist();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      className="sidebar__resize"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setApp({ sidebarWidth: 248 })}
    />
  );
}

function DragGhost() {
  const { item, x, y } = useDnd();
  if (!item) return null;
  return (
    <div className="drag-ghost" style={{ left: x + 12, top: y + 8 }}>
      <span className="row__icon">{item.kind === "folder" ? Icon.folder : Icon.board}</span>
      {item.label}
    </div>
  );
}
