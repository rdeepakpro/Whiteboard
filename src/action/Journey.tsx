/**
 * Startup Journey: a chronological record built from daily check-ins and
 * finished items, grouped by week with a one-line summary (rule-based, or
 * from the optional local model).
 */
import { useMemo, useState } from "react";
import { useApp } from "../state/store";
import { Icon } from "../shell/icons";
import { openLinkedBoard } from "./bridge";
import { aiSummary, summarize } from "./suggest";
import { dayKey, parseDay, useAction, weekKey, type ActionItem, type CheckIn } from "./store";

const KIND_LABEL: Record<ActionItem["kind"], string> = {
  priority: "Priority",
  week: "Weekly outcome",
  move: "Next move",
  milestone: "Milestone reached",
  blocker: "Blocker resolved",
};

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const weekFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

interface Day {
  key: string;
  checkIn: CheckIn | null;
  done: ActionItem[];
}

export function Journey() {
  const items = useAction((s) => s.items);
  const checkIns = useAction((s) => s.checkIns);

  const weeks = useMemo(() => {
    const days = new Map<string, Day>();
    const day = (key: string) => {
      if (!days.has(key)) days.set(key, { key, checkIn: null, done: [] });
      return days.get(key)!;
    };
    for (const c of checkIns) day(c.date).checkIn = c;
    for (const i of items) if (i.doneAt) day(dayKey(new Date(i.doneAt))).done.push(i);
    const byWeek = new Map<string, Day[]>();
    for (const d of [...days.values()].sort((a, b) => b.key.localeCompare(a.key))) {
      const wk = weekKey(parseDay(d.key));
      if (!byWeek.has(wk)) byWeek.set(wk, []);
      byWeek.get(wk)!.push(d);
    }
    return [...byWeek.entries()];
  }, [items, checkIns]);

  if (!weeks.length) {
    return (
      <div className="journey empty">
        <h1>Startup Journey</h1>
        <p>Your daily check-ins and everything you finish will collect here, in order — a quiet record of how the company got built.</p>
      </div>
    );
  }

  return (
    <div className="journey">
      <h1>Startup Journey</h1>
      {weeks.map(([wk, days]) => (
        <Week key={wk} weekStart={wk} days={days} />
      ))}
    </div>
  );
}

function Week({ weekStart, days }: { weekStart: string; days: Day[] }) {
  const ai = useApp((s) => s.prefs.localAiEnabled && !!s.prefs.localAiModel);
  const [aiText, setAiText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checkIns = days.flatMap((d) => (d.checkIn ? [d.checkIn] : []));
  const done = days.flatMap((d) => d.done);
  const isThisWeek = weekStart === weekKey();
  return (
    <section className="jweek">
      <div className="jweek__head">
        <h2>{isThisWeek ? "This week" : `Week of ${weekFmt.format(parseDay(weekStart))}`}</h2>
        <span className="jweek__summary">{aiText ?? summarize(checkIns, done)}</span>
        {ai && !aiText && (
          <button
            className="linkish small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setAiText((await aiSummary(checkIns, done)) ?? null);
              setBusy(false);
            }}
          >
            {busy ? "Summarizing…" : "Summarize"}
          </button>
        )}
      </div>
      {days.map((d) => (
        <div key={d.key} className="jday">
          <div className="jday__date">{dayFmt.format(parseDay(d.key))}</div>
          <div className="jday__body">
            {d.checkIn && (
              <div className="jcheckin">
                {d.checkIn.moved && <p><span>Moved forward</span>{d.checkIn.moved}</p>}
                {d.checkIn.tomorrow && <p><span>Most important next</span>{d.checkIn.tomorrow}</p>}
                {d.checkIn.blocking && <p className="blocked"><span>Blocked by</span>{d.checkIn.blocking}</p>}
              </div>
            )}
            {d.done.map((i) => (
              <div key={i.id} className="jdone">
                <span className="jdone__check">{Icon.check}</span>
                <span className="jdone__kind">{KIND_LABEL[i.kind]}</span>
                <span>{i.goal && i.kind === "move" ? `${i.goal}: ` : ""}{i.title}</span>
                {i.boardPath && (
                  <button className="board-chip" onClick={() => openLinkedBoard(i)}>
                    {Icon.board}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
