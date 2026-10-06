/**
 * Pointer-based drag and drop for sidebar organization. (HTML5 drag and drop
 * is left entirely to Excalidraw so its library/canvas drags are unaffected.)
 *
 * Drop targets are any elements with `data-drop="<folder path>"`.
 */
import { create } from "zustand";

export interface DragItem {
  path: string;
  kind: "board" | "folder";
  label: string;
}

interface DndState {
  item: DragItem | null;
  x: number;
  y: number;
  over: string | null;
}

export const useDnd = create<DndState>(() => ({ item: null, x: 0, y: 0, over: null }));

const THRESHOLD = 5;

/**
 * Call from onPointerDown. Starts a drag after the pointer moves a few
 * pixels; a plain click is left alone. `onDrop` receives the target folder.
 */
export function beginPointerDrag(e: React.PointerEvent, item: DragItem, onDrop: (target: string) => void) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;

  const move = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      started = true;
      document.body.classList.add("is-dragging");
    }
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop]");
    useDnd.setState({ item, x: ev.clientX, y: ev.clientY, over: el?.dataset.drop ?? null });
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    document.body.classList.remove("is-dragging");
    const { over } = useDnd.getState();
    useDnd.setState({ item: null, over: null });
    if (started) {
      swallowNextClick();
      if (over) onDrop(over);
    }
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      useDnd.setState({ over: null });
      up();
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}

/** Swallows the click that may follow a drag (only if it fires right away). */
export function swallowNextClick() {
  const stop = (c: Event) => c.stopPropagation();
  window.addEventListener("click", stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
}
