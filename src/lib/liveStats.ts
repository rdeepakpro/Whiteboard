// Element count / zoom of the active board for the status bar. Kept in its
// own tiny store so updates only re-render the status bar.
import { create } from "zustand";

export const useLiveStats = create<{ elements: number; zoom: number }>(() => ({ elements: 0, zoom: 1 }));

export function setLiveStats(s: { elements: number; zoom: number }) {
  const cur = useLiveStats.getState();
  if (cur.elements !== s.elements || cur.zoom !== s.zoom) useLiveStats.setState(s);
}
