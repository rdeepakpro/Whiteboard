import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Icon } from "./icons";

export type MenuItem =
  | "separator"
  | {
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect?: () => void;
      submenu?: MenuItem[];
    };

const useMenu = create<{ x: number; y: number; items: MenuItem[] } | null>(() => null);

export function openContextMenu(
  e: { clientX: number; clientY: number; preventDefault?: () => void },
  items: MenuItem[],
) {
  e.preventDefault?.();
  useMenu.setState({ x: e.clientX, y: e.clientY, items }, true);
}

export function closeContextMenu() {
  useMenu.setState(null, true);
}

function MenuList({ items, x, y }: { items: MenuItem[]; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(6, Math.min(x, window.innerWidth - r.width - 6)),
      y: Math.max(6, Math.min(y, window.innerHeight - r.height - 6)),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="menu__sep" />
        ) : (
          <button
            key={i}
            className={`menu__item${item.danger ? " danger" : ""}${sub?.index === i ? " open" : ""}`}
            disabled={item.disabled}
            role="menuitem"
            onMouseEnter={(e) => {
              if (item.submenu) {
                const r = e.currentTarget.getBoundingClientRect();
                setSub({ index: i, x: r.right - 4, y: r.top - 5 });
              } else setSub(null);
            }}
            onClick={() => {
              if (item.submenu) return;
              closeContextMenu();
              item.onSelect?.();
            }}
          >
            <span className="menu__icon">{item.icon}</span>
            <span className="menu__label">{item.label}</span>
            {item.shortcut && <span className="menu__shortcut">{item.shortcut}</span>}
            {item.submenu && <span className="menu__chev">{Icon.chevron}</span>}
          </button>
        ),
      )}
      {sub && typeof items[sub.index] === "object" && (
        <MenuList items={(items[sub.index] as any).submenu} x={sub.x} y={sub.y} />
      )}
    </div>
  );
}

export function ContextMenuHost() {
  const menu = useMenu();
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && (e.target as Element).closest?.(".menu")) return;
      closeContextMenu();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);
  if (!menu) return null;
  return <MenuList items={menu.items} x={menu.x} y={menu.y} />;
}
