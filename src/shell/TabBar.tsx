import { memo, useRef, useState } from "react";
import { EMPTY_STATUS, getApp, useApp, type Tab } from "../state/store";
import { activateTab, closeTab, moveTab, newBoard } from "../lib/boards";
import { boardName } from "../lib/paths";
import { runCommand } from "../lib/commands";
import { openContextMenu } from "./ContextMenu";
import { boardMenu } from "./menus";
import { RenameInput } from "./Sidebar";
import { Icon } from "./icons";
import { swallowNextClick } from "./dnd";
import { ModeSwitch } from "./ModeSwitch";

export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const collapsed = useApp((s) => s.sidebarCollapsed);
  const stripRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  /** Pointer-based reordering: tabs swap as the pointer crosses their middle. */
  const startDrag = (e: React.PointerEvent, tab: Tab) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientX - startX) < 6) return;
      if (!started) {
        started = true;
        setDragId(tab.id);
      }
      const els = Array.from(stripRef.current?.querySelectorAll<HTMLElement>("[data-tab]") ?? []);
      let target = els.length - 1;
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) {
          target = i;
          break;
        }
      }
      const from = getApp().tabs.findIndex((t) => t.id === tab.id);
      if (target !== from) moveTab(tab.id, target);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragId(null);
      if (started) swallowNextClick();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className={`tabbar${collapsed ? " sidebar-hidden" : ""}`} data-tauri-drag-region>
      {collapsed && (
        <div className="tabbar__lead">
          <ModeSwitch />
          <button className="icon-btn" title="Show Sidebar (⌘\)" onClick={() => runCommand("toggle-sidebar")}>
            {Icon.sidebar}
          </button>
          <button className="icon-btn" title="Search (⌘K)" onClick={() => runCommand("palette")}>
            {Icon.search}
          </button>
        </div>
      )}
      <div className="tabbar__strip" ref={stripRef} data-tauri-drag-region>
        {tabs.map((t, i) => (
          <TabButton key={t.id} tab={t} index={i} dragging={dragId === t.id} onPointerDown={(e) => startDrag(e, t)} />
        ))}
        <button className="icon-btn tabbar__new" title="New Board (⌘T)" onClick={() => newBoard()}>
          {Icon.plus}
        </button>
      </div>
    </div>
  );
}

const TabButton = memo(function TabButton({
  tab,
  index,
  dragging,
  onPointerDown,
}: {
  tab: Tab;
  index: number;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const active = useApp((s) => s.activeTabId === tab.id && !s.page);
  const status = useApp((s) => s.tabStatus[tab.id] ?? EMPTY_STATUS);
  const [renaming, setRenaming] = useState(false);
  const name = boardName(tab.path);
  const problem = status.conflict || status.missing || !!status.error || !!status.loadError;

  return (
    <div
      data-tab={tab.id}
      className={`tab${active ? " active" : ""}${dragging ? " dragging" : ""}`}
      title={`${tab.path}${index < 9 ? `  (⌘${index + 1})` : ""}`}
      onPointerDown={(e) => !renaming && onPointerDown(e)}
      onClick={() => activateTab(tab.id)}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          void closeTab(tab.id);
        }
      }}
      onDoubleClick={() => setRenaming(true)}
      onContextMenu={(e) =>
        openContextMenu(e, [
          { label: "Close", shortcut: "⌘W", onSelect: () => closeTab(tab.id) },
          {
            label: "Close Other Tabs",
            onSelect: async () => {
              for (const t of getApp().tabs) if (t.id !== tab.id) await closeTab(t.id);
            },
          },
          "separator",
          ...boardMenu(tab.path),
        ])
      }
    >
      {renaming ? (
        <RenameInput path={tab.path} initial={name} onDone={() => setRenaming(false)} />
      ) : (
        <span className="tab__name">{name}</span>
      )}
      <span className="tab__end">
        {problem ? (
          <span className="tab__warn" title="Needs attention">
            !
          </span>
        ) : status.dirty ? (
          <span className="tab__dot" />
        ) : null}
        <button
          className="tab__close"
          tabIndex={-1}
          title="Close (⌘W)"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void closeTab(tab.id);
          }}
        >
          {Icon.close}
        </button>
      </span>
    </div>
  );
});
