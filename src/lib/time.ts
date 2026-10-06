const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dateYearFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatTime(t: number) {
  return timeFmt.format(t);
}

/** "Today", "Yesterday", "Mon, Sep 29"… used to group history entries. */
export function dayLabel(t: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(t);
  if (day === today) return "Today";
  if (day === today - 86_400_000) return "Yesterday";
  return new Date(t).getFullYear() === new Date().getFullYear() ? dateFmt.format(t) : dateYearFmt.format(t);
}

export function relativeTime(t: number): string {
  if (!t) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  const label = dayLabel(t);
  return label === "Today" ? `Today ${formatTime(t)}` : label === "Yesterday" ? `Yesterday ${formatTime(t)}` : label;
}
