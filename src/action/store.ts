/**
 * Action: the execution side of Whiteboard. Deliberately tiny data model —
 * a title, an optional date/goal, done-or-not, and an optional link back to a
 * Brainstorm board (and the shapes it came from). Stored in
 * <appData>/action.json, separate from boards and from session state.
 */
import { create } from "zustand";
import { ipc } from "../platform/ipc";
import { getApp } from "../state/store";
import { rebase } from "../lib/paths";

export type ItemKind = "priority" | "week" | "move" | "milestone" | "blocker";

export interface ActionItem {
  id: string;
  kind: ItemKind;
  title: string;
  createdAt: number;
  doneAt: number | null;
  /** priority: the day (YYYY-MM-DD); week: the week's Monday; milestone: due date. */
  date: string | null;
  /** Next moves: the goal this move serves. */
  goal: string | null;
  /** Optional link back to a Brainstorm board and the shapes it came from. */
  boardPath: string | null;
  elementIds: string[] | null;
  /** Next moves: the whole goal was finished (no follow-up move needed). */
  goalDone?: boolean;
}

export interface CheckIn {
  id: string;
  date: string; // YYYY-MM-DD
  at: number;
  moved: string;
  tomorrow: string;
  blocking: string;
}

interface ActionData {
  version: 1;
  items: ActionItem[];
  checkIns: CheckIn[];
  /** Suggestion ids the user dismissed. */
  dismissed: string[];
}

export const useAction = create<ActionData & { loaded: boolean }>(() => ({
  version: 1,
  items: [],
  checkIns: [],
  dismissed: [],
  loaded: false,
}));

export const LIMITS = { priority: 3, week: 3 } as const;

// ------------------------------------------------------------- dates

export function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function weekKey(d = new Date()): string {
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(monday);
}

/** Whole days from today until `key` (negative = past). */
export function daysUntil(key: string): number {
  const today = parseDay(dayKey());
  return Math.round((parseDay(key).getTime() - today.getTime()) / 86_400_000);
}

export function addDays(key: string, n: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

// ------------------------------------------------------- persistence

function file() {
  const dir = getApp().paths?.dataDir;
  return dir ? `${dir}/action.json` : null;
}

export async function loadAction() {
  const f = file();
  if (!f) return;
  for (const path of [f, `${f}.bak`]) {
    try {
      const { content } = await ipc.readText(path);
      const data = JSON.parse(content) as Partial<ActionData>;
      useAction.setState({
        items: data.items ?? [],
        checkIns: data.checkIns ?? [],
        dismissed: data.dismissed ?? [],
        loaded: true,
      });
      if (path === f) ipc.writeText(`${f}.bak`, content).catch(() => {});
      return;
    } catch {
      /* missing or corrupt — try the backup */
    }
  }
  useAction.setState({ loaded: true });
}

let timer: number | undefined;
let chain: Promise<unknown> = Promise.resolve();
function persist() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const f = file();
    if (!f || !useAction.getState().loaded) return;
    const { items, checkIns, dismissed } = useAction.getState();
    const json = JSON.stringify({ version: 1, items, checkIns, dismissed } satisfies ActionData, null, 1);
    chain = chain.then(() => ipc.writeText(f, json)).catch((e) => console.error("action save failed", e));
  }, 300);
}

export async function flushAction() {
  window.clearTimeout(timer);
  const f = file();
  if (!f || !useAction.getState().loaded) return;
  const { items, checkIns, dismissed } = useAction.getState();
  await chain;
  await ipc.writeText(f, JSON.stringify({ version: 1, items, checkIns, dismissed }, null, 1)).catch(() => {});
}

function set(fn: (s: ActionData) => Partial<ActionData>) {
  useAction.setState((s) => fn(s));
  persist();
}

// ----------------------------------------------------------- items

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function openItems(kind: ItemKind, s = useAction.getState()) {
  return s.items.filter((i) => i.kind === kind && !i.doneAt);
}

export function todaysPriorities(s = useAction.getState()) {
  const today = dayKey();
  return s.items.filter((i) => i.kind === "priority" && i.date === today);
}

export function weekOutcomes(s = useAction.getState()) {
  const wk = weekKey();
  return s.items.filter((i) => i.kind === "week" && i.date === wk);
}

/** Why an item can't be added right now (the 3-item limits), or null. */
export function limitReason(kind: ItemKind): string | null {
  // Finished items don't count: the limit is about open commitments.
  if (kind === "priority" && todaysPriorities().filter((i) => !i.doneAt).length >= LIMITS.priority)
    return "Today already has 3 priorities.";
  if (kind === "week" && weekOutcomes().filter((i) => !i.doneAt).length >= LIMITS.week)
    return "This week already has 3 outcomes.";
  return null;
}

export function addItem(input: Partial<ActionItem> & { kind: ItemKind; title: string }): ActionItem | null {
  if (limitReason(input.kind)) return null;
  const item: ActionItem = {
    id: uid(),
    createdAt: Date.now(),
    doneAt: null,
    date: input.kind === "priority" ? dayKey() : input.kind === "week" ? weekKey() : null,
    goal: null,
    boardPath: null,
    elementIds: null,
    ...input,
    title: input.title.trim(),
  };
  set((s) => ({ items: [...s.items, item] }));
  return item;
}

export function updateItem(id: string, patch: Partial<ActionItem>) {
  set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
}

export function toggleDone(id: string) {
  set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, doneAt: i.doneAt ? null : Date.now() } : i)) }));
}

export function removeItem(id: string) {
  set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
}

/** Carries an unfinished priority from an earlier day to today. */
export function moveToToday(id: string): boolean {
  if (limitReason("priority")) return false;
  updateItem(id, { date: dayKey() });
  return true;
}

export function saveCheckIn(entry: Omit<CheckIn, "id" | "at" | "date">) {
  const date = dayKey();
  set((s) => ({
    checkIns: [...s.checkIns.filter((c) => c.date !== date), { ...entry, id: uid(), at: Date.now(), date }],
  }));
}

export function dismissSuggestion(id: string) {
  set((s) => ({ dismissed: [...new Set([...s.dismissed, id])].slice(-500) }));
}

/** Keeps board links valid after a board/folder is renamed or moved in-app. */
export function rebaseActionPaths(from: string, to: string) {
  const { items } = useAction.getState();
  if (!items.some((i) => i.boardPath && rebase(i.boardPath, from, to) !== i.boardPath)) return;
  set((s) => ({ items: s.items.map((i) => (i.boardPath ? { ...i, boardPath: rebase(i.boardPath, from, to) } : i)) }));
}
