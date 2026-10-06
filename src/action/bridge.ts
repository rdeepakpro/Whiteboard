/**
 * Brainstorm ⇄ Action.
 *
 *  - selectionForAction(): text of the selected shapes/groups on the canvas
 *  - "Send to Action…" added to Excalidraw's own right-click menu when
 *    something is selected (Excalidraw's menu has no extension API, so one
 *    item is appended to its rendered list using its own markup; if that
 *    markup ever changes the item simply doesn't appear — ⌥⌘A and ⌘K still work)
 *  - openLinkedBoard(): from an Action item back to its board and shapes
 */
import { getApp, setApp } from "../state/store";
import { activeSession, sessionForPath } from "../editor/registry";
import { openBoard } from "../lib/boards";
import { boardName } from "../lib/paths";
import { refOf } from "../lib/webref";
import { toast } from "../lib/toast";
import { ipc } from "../platform/ipc";
import type { ActionItem, ItemKind } from "./store";

export function selectionForAction(): { title: string; elementIds: string[]; boardPath: string } | null {
  const session = activeSession();
  const api = session?.api;
  if (!api || getApp().mode !== "brainstorm") return null;
  const ids = api.getAppState().selectedElementIds;
  const all = api.getSceneElements();
  const selected = all.filter((e) => ids[e.id]);
  if (!selected.length) return null;
  const texts: string[] = [];
  const push = (t: string | undefined | null) => {
    const clean = (t ?? "").replace(/\s+/g, " ").trim();
    if (clean && !texts.includes(clean)) texts.push(clean);
  };
  for (const el of selected) {
    const ref = refOf(el);
    if (ref) {
      if (ref.role === "title") push((el as any).text);
      continue;
    }
    if (el.type === "text") push((el as any).text);
    if (el.type === "frame" || el.type === "magicframe") push((el as any).name);
    for (const b of el.boundElements ?? []) {
      if (b.type === "text" && !ids[b.id]) push((all.find((x) => x.id === b.id) as any)?.text);
    }
  }
  // A selected link card contributes its title; fall back to its URL.
  if (!texts.length) {
    const card = selected.map(refOf).find(Boolean);
    if (card) push(card.url);
  }
  const title = texts.join(" — ").slice(0, 140);
  return { title, elementIds: selected.map((e) => e.id), boardPath: session!.path };
}

export function openSendToAction(itemKind?: Exclude<ItemKind, "week">) {
  const sel = selectionForAction();
  const session = activeSession();
  if (!sel && !session) {
    toast("Open a board and select something to send to Action.");
    return;
  }
  setApp({
    dialog: {
      kind: "send-to-action",
      title: sel?.title ?? "",
      boardPath: sel?.boardPath ?? session?.path ?? null,
      elementIds: sel?.elementIds ?? null,
      itemKind,
    },
  });
}

// ------------------------------------------------- Excalidraw context menu

function injectMenuItem(menu: HTMLUListElement) {
  if (menu.dataset.wbAction || getApp().mode !== "brainstorm") return;
  const api = activeSession()?.api;
  if (!api || !menu.closest(".editor-slot.visible")) return;
  if (!Object.keys(api.getAppState().selectedElementIds).length) return;
  menu.dataset.wbAction = "1";
  const li = document.createElement("li");
  li.dataset.testid = "wbSendToAction";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "context-menu-item";
  const label = document.createElement("div");
  label.className = "context-menu-item__label";
  label.textContent = "Send to Action…";
  const kbd = document.createElement("kbd");
  kbd.className = "context-menu-item__shortcut";
  kbd.textContent = "⌥⌘A";
  button.append(label, kbd);
  li.append(button);
  const hr = document.createElement("hr");
  hr.className = "context-menu-item-separator";
  li.addEventListener("click", (e) => {
    e.stopPropagation();
    // Read the selection before Excalidraw's menu closes.
    openSendToAction();
    api.updateScene({ appState: { contextMenu: null } as any });
  });
  menu.prepend(li, hr);
}

export function installSendToActionMenu() {
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const menu = node.matches("ul.context-menu") ? node : node.querySelector("ul.context-menu");
        if (menu) injectMenuItem(menu as HTMLUListElement);
      }
    }
  });
  const attach = () => {
    const root = document.querySelector(".editors");
    if (root) observer.observe(root, { childList: true, subtree: true });
    else window.setTimeout(attach, 500);
  };
  attach();
}

// ------------------------------------------------- Action → Brainstorm

/** Opens an item's linked board and, if known, selects the original shapes. */
export async function openLinkedBoard(item: Pick<ActionItem, "boardPath" | "elementIds">) {
  const path = item.boardPath;
  if (!path) return;
  const st = await ipc.stat(path).catch(() => null);
  if (!st?.exists) {
    toast(`“${boardName(path)}” can't be found — it may have been moved or deleted outside Whiteboard.`, "error");
    return;
  }
  setApp({ mode: "brainstorm" });
  await openBoard(path);
  if (!item.elementIds?.length) return;
  // Wait for the editor to mount, then reveal the shapes.
  for (let i = 0; i < 60; i++) {
    const api = sessionForPath(path)?.api;
    if (api) {
      const els = api.getSceneElements().filter((e) => item.elementIds!.includes(e.id));
      if (els.length) {
        api.updateScene({ appState: { selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true])) } as any });
        api.scrollToContent(els, { animate: true, duration: 300 });
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
