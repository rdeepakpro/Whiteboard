import { getApp, setApp } from "../state/store";
import { schedulePersist } from "../state/persist";

const MAX_RECENTS = 40;

/**
 * Moves `path` to the top of Recents. `quiet` avoids churn when the board is
 * already the most recent entry and was touched less than a minute ago.
 */
export function touchRecent(path: string, opts: { quiet?: boolean } = {}) {
  const { recents } = getApp();
  const now = Date.now();
  if (opts.quiet && recents[0]?.path === path && now - recents[0].at < 60_000) return;
  setApp({ recents: [{ path, at: now }, ...recents.filter((r) => r.path !== path)].slice(0, MAX_RECENTS) });
  schedulePersist();
}

export function forgetRecent(path: string) {
  setApp((s) => ({ recents: s.recents.filter((r) => r.path !== path) }));
  schedulePersist();
}
