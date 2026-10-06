/**
 * Makes links in your own text clickable: any text element (or shape label)
 * containing a URL gets Excalidraw's standard `link`, so it shows the link
 * icon, works in exports and in plain Excalidraw, and opens with ⌘-click.
 * Runs shortly after you finish typing, never while a text box is open.
 */
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]]/i;

export function firstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  if (!m) return null;
  return m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
}

const timers = new WeakMap<ExcalidrawImperativeAPI, number>();

export function scheduleAutoLink(api: ExcalidrawImperativeAPI) {
  window.clearTimeout(timers.get(api));
  timers.set(
    api,
    window.setTimeout(() => autoLink(api), 500),
  );
}

function autoLink(api: ExcalidrawImperativeAPI) {
  const st = api.getAppState() as any;
  if (st.editingTextElement || st.newElement) return scheduleAutoLink(api);
  const all = api.getSceneElementsIncludingDeleted();
  const byId = new Map(all.map((e) => [e.id, e]));
  const updates = new Map<string, string>();
  for (const el of all) {
    if (el.isDeleted || el.type !== "text" || (el.customData as any)?.wbRef) continue;
    const url = firstUrl((el as any).originalText ?? (el as any).text ?? "");
    if (!url) continue;
    // A label links its shape; free text links itself.
    const container = (el as any).containerId ? byId.get((el as any).containerId) : null;
    const target = container ?? el;
    if (!target.link) updates.set(target.id, url);
  }
  if (!updates.size) return;
  api.updateScene({
    elements: all.map((e) => (updates.has(e.id) ? newElementWith(e as any, { link: updates.get(e.id)! }) : e)),
    // Part of the edit that added the URL, not a separate undo step.
    captureUpdate: CaptureUpdateAction.EVENTUALLY,
  });
}
