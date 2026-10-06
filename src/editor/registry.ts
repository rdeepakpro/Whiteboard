// Maps tab ids to their live BoardSession (and Excalidraw API).
import type { BoardSession } from "./BoardSession";
import { activeTab } from "../state/store";

export const sessions = new Map<string, BoardSession>();

export function activeSession(): BoardSession | null {
  const tab = activeTab();
  return tab ? (sessions.get(tab.id) ?? null) : null;
}

export function sessionForPath(path: string): BoardSession | null {
  for (const s of sessions.values()) if (s.path === path) return s;
  return null;
}

/** The DOM element Excalidraw listens to for keyboard shortcuts. */
export function editorContainer(tabId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-editor-tab="${tabId}"] .excalidraw`);
}

/** Focus is "parked" on shell chrome (not a text field), so the canvas may take it. */
function focusIsParked(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return true;
  if (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable) return false;
  return !!a.closest(".sidebar, .tabbar, .page, .editor-slot");
}

/** Gives keyboard focus to a board's canvas (retrying while it mounts). */
export function focusEditor(tabId: string) {
  const attempt = () => {
    const el = editorContainer(tabId);
    if (el && !el.contains(document.activeElement) && focusIsParked()) el.focus({ preventScroll: true });
  };
  attempt();
  // The editor may still be loading/mounting; retry while focus is parked.
  for (const delay of [100, 300, 700]) window.setTimeout(attempt, delay);
}
