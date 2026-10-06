/**
 * Lightweight, local organization suggestions. Simple rules over each board's
 * text (from the Rust digest index); an optional local model (Ollama on this
 * Mac) can refine names and summaries when enabled in Settings.
 *
 * Nothing here changes anything by itself — every suggestion needs a click.
 */
import { ipc, type BoardDigest } from "../platform/ipc";
import { allFolders, getApp } from "../state/store";
import { boardName, dirname } from "../lib/paths";
import { useAction, type ActionItem, type CheckIn } from "./store";

// --------------------------------------------------------------- words

const STOP = new Set(
  `the and for with that this from your you are was were will have has had not but can our out all any its into than then them they what when where which who why how about also just like more most some such very each other over only own same too use used using new one two get got make made into onto per via etc yes no ok okay maybe need needs want wants should could would idea ideas thing things stuff page board note notes todo next step steps action untitled whiteboard copy http https www com`.split(
    /\s+/,
  ),
);

export function keywords(text: string, limit = 15): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? []) {
    const w = raw.replace(/'s$/, "").replace(/[-']+$/, "");
    if (w.length < 3 || STOP.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function isMessyName(name: string) {
  return /^(untitled( whiteboard)?|new board|board|drawing|excalidraw)( \d+)?( copy)?( \d+)?$/i.test(name.trim());
}

// ----------------------------------------------------------- suggestions

export type Suggestion =
  | { id: string; type: "rename"; path: string; to: string }
  | { id: string; type: "move"; path: string; folder: string }
  | { id: string; type: "todo"; path: string; text: string };

/** A cleaner name from a board's most prominent text, or its main topic. */
export function suggestName(d: BoardDigest): string | null {
  if (d.elements < 2 || !d.text.trim()) return null;
  const heading = d.headings.find((h) => h.length >= 3 && h.length <= 40 && /[a-z]/i.test(h) && !isMessyName(h));
  if (heading) return heading === heading.toLowerCase() ? titleCase(heading) : heading;
  const words = keywords(d.text, 3);
  if (!words.length) return null;
  const main = titleCase(words[0]);
  if (d.arrows >= 2) return `${main} Flow`;
  return words[1] ? `${main} & ${titleCase(words[1])}` : `${main} Notes`;
}

/** Best existing folder for a top-level board, if the match is clear. */
function suggestFolder(d: BoardDigest, digests: BoardDigest[], root: string): string | null {
  const mine = new Set(keywords(`${boardName(d.path)} ${d.text}`, 12));
  if (mine.size < 2) return null;
  let best: { folder: string; score: number } | null = null;
  for (const f of allFolders(getApp().tree)) {
    const members = digests.filter((x) => dirname(x.path) === f.path);
    const folderWords = new Set([
      ...keywords(f.name, 5).map((w) => w),
      ...members.flatMap((m) => keywords(`${boardName(m.path)} ${m.text}`, 10)),
    ]);
    let score = 0;
    for (const w of mine) if (folderWords.has(w)) score += keywords(f.name, 5).includes(w) ? 3 : 1;
    if (score >= 3 && (!best || score > best.score)) best = { folder: f.path, score };
  }
  return best && best.folder !== root ? best.folder : null;
}

export async function computeSuggestions(): Promise<Suggestion[]> {
  const root = getApp().prefs.libraryRoot;
  const archived = new Set(getApp().archived);
  const { dismissed, items } = useAction.getState();
  const skip = new Set(dismissed);
  const existing = new Set(items.map((i) => i.title.toLowerCase()));
  let digests: BoardDigest[] = [];
  try {
    digests = (await ipc.boardDigests(root)).filter((d) => !archived.has(d.path));
  } catch {
    return [];
  }
  const out: Suggestion[] = [];
  for (const d of digests) {
    const name = boardName(d.path);
    if (isMessyName(name)) {
      const to = (await aiName(d)) ?? suggestName(d);
      const id = `rename:${d.path}:${to}`;
      if (to && to !== name && !skip.has(id)) out.push({ id, type: "rename", path: d.path, to });
    }
    if (dirname(d.path) === root) {
      const folder = suggestFolder(d, digests, root);
      const id = `move:${d.path}:${folder}`;
      if (folder && !skip.has(id)) out.push({ id, type: "move", path: d.path, folder });
    }
    for (const text of d.todos) {
      const id = `todo:${d.path}:${text}`;
      const clean = text.charAt(0).toUpperCase() + text.slice(1);
      if (!skip.has(id) && !existing.has(text.toLowerCase())) out.push({ id, type: "todo", path: d.path, text: clean });
    }
  }
  return out.slice(0, 12);
}

// -------------------------------------------------------- related boards

let digestCache: { at: number; list: BoardDigest[] } | null = null;
async function digestsCached() {
  if (!digestCache || Date.now() - digestCache.at > 30_000) {
    digestCache = { at: Date.now(), list: await ipc.boardDigests(getApp().prefs.libraryRoot).catch(() => []) };
  }
  return digestCache.list;
}

/** Boards whose content overlaps most with `text` (or with a board). */
export async function relatedBoards(seed: { text?: string; path?: string }, limit = 3): Promise<string[]> {
  const list = await digestsCached();
  const base = seed.path ? list.find((d) => d.path === seed.path) : null;
  const words = new Set(keywords(`${seed.text ?? ""} ${base ? `${boardName(base.path)} ${base.text}` : ""}`, 15));
  if (!words.size) return [];
  return list
    .filter((d) => d.path !== seed.path)
    .map((d) => {
      const other = new Set(keywords(`${boardName(d.path)} ${d.text}`, 15));
      const inter = [...words].filter((w) => other.has(w)).length;
      return { path: d.path, score: inter / (words.size + other.size - inter || 1) };
    })
    .filter((r) => r.score >= 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.path);
}

// -------------------------------------------------------------- summary

/** One-line, rule-based summary of a stretch of the journey. */
export function summarize(checkIns: CheckIn[], done: ActionItem[]): string {
  const parts: string[] = [];
  if (checkIns.length) parts.push(`${checkIns.length} check-in${checkIns.length === 1 ? "" : "s"}`);
  if (done.length) parts.push(`${done.length} thing${done.length === 1 ? "" : "s"} done`);
  const milestones = done.filter((d) => d.kind === "milestone");
  if (milestones.length) parts.push(`reached ${milestones.map((m) => m.title).join(", ")}`);
  const themes = keywords(
    [...checkIns.flatMap((c) => [c.moved, c.tomorrow]), ...done.map((d) => d.title)].join(" "),
    3,
  );
  if (themes.length) parts.push(`themes: ${themes.join(", ")}`);
  const blocked = checkIns.filter((c) => c.blocking.trim()).length;
  if (blocked) parts.push(`blocked on ${blocked} day${blocked === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

// ------------------------------------------------------ optional local AI

const aiNames = new Map<string, string | null>();

async function aiName(d: BoardDigest): Promise<string | null> {
  const { localAiEnabled, localAiModel } = getApp().prefs;
  if (!localAiEnabled || !localAiModel) return null;
  const key = `${d.path}@${d.mtime}`;
  if (aiNames.has(key)) return aiNames.get(key)!;
  const prompt = `Suggest a short, specific title (2-4 words, Title Case) for a brainstorming whiteboard with this content. Reply with the title only.\n\nHeadings: ${d.headings.join(" | ")}\nText: ${d.text.slice(0, 1500)}`;
  const raw = await ipc.localAi(localAiModel, prompt).catch(() => null);
  const name =
    raw
      ?.split("\n")[0]
      .replace(/^["'*\s]+|["'*.\s]+$/g, "")
      .slice(0, 50) || null;
  aiNames.set(key, name);
  return name;
}

/** AI summary of check-ins when local AI is on; null otherwise. */
export async function aiSummary(checkIns: CheckIn[], done: ActionItem[]): Promise<string | null> {
  const { localAiEnabled, localAiModel } = getApp().prefs;
  if (!localAiEnabled || !localAiModel || (!checkIns.length && !done.length)) return null;
  const lines = [
    ...checkIns.map((c) => `${c.date}: moved: ${c.moved} | next: ${c.tomorrow} | blocked: ${c.blocking || "-"}`),
    ...done.map((d) => `done: ${d.title}`),
  ];
  const prompt = `Summarize this founder's week in 2 plain sentences: what moved forward and what's blocking. No praise, no advice.\n\n${lines.join("\n")}`;
  return ipc.localAi(localAiModel, prompt).catch(() => null);
}
