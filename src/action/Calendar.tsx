/**
 * Calendar: a month view of everything in Action that has a date —
 * priorities planned for a day, milestones, scheduled next moves and
 * blockers, what got finished, and journal check-ins. Click a day to see it
 * in full and plan it (up to 3 priorities per day, like Today).
 */
import { useMemo, useState } from "react";
import { setApp } from "../state/store";
import { boardName } from "../lib/paths";
import { toast } from "../lib/toast";
import { Icon } from "../shell/icons";
import { openLinkedBoard } from "./bridge";
import {
  addDays,
  addItem,
  dayKey,
  limitReason,
  parseDay,
  toggleDone,
  useAction,
  weekKey,
  type ActionItem,
  type CheckIn,
} from "./store";

type DayEntry = { item: ActionItem; finished: boolean };

const KIND_LABEL: Record<ActionItem["kind"], string> = {
  priority: "Priority",
  week: "Weekly outcome",
  move: "Task",
  milestone: "Milestone",
  blocker: "Blocker",
};

const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthStart(key: string) {
  return `${key.slice(0, 7)}-01`;
}

function shiftMonth(first: string, n: number) {
  const d = parseDay(first);
  d.setMonth(d.getMonth() + n);
  return dayKey(d);
}

/** Everything that belongs on each day, keyed by YYYY-MM-DD. */
function useDays() {
  const items = useAction((s) => s.items);
  const checkIns = useAction((s) => s.checkIns);
  return useMemo(() => {
    const map = new Map<string, { entries: DayEntry[]; checkIn: CheckIn | null }>();
    const at = (k: string) => {
      if (!map.has(k)) map.set(k, { entries: [], checkIn: null });
      return map.get(k)!;
    };
    for (const i of items) {
      // Week outcomes live on the week, not a day; they're shown in the panel.
      if (i.kind === "week") {
        if (i.doneAt) at(dayKey(new Date(i.doneAt))).entries.push({ item: i, finished: true });
        continue;
      }
      if (i.date) at(i.date).entries.push({ item: i, finished: false });
      const doneDay = i.doneAt ? dayKey(new Date(i.doneAt)) : null;
      if (doneDay && doneDay !== i.date) at(doneDay).entries.push({ item: i, finished: true });
    }
    for (const c of checkIns) at(c.date).checkIn = c;
    // Milestones first, then priorities, tasks, blockers; finished last.
    const order = { milestone: 0, priority: 1, move: 2, blocker: 3, week: 4 };
    for (const d of map.values()) {
      d.entries.sort((a, b) => Number(a.finished) - Number(b.finished) || order[a.item.kind] - order[b.item.kind]);
    }
    return map;
  }, [items, checkIns]);
}

export function Calendar() {
  const today = dayKey();
  const [month, setMonth] = useState(() => monthStart(today));
  const [selected, setSelected] = useState(today);
  const days = useDays();

  const cells = useMemo(() => {
    const first = parseDay(month);
    const start = addDays(month, -((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);

  return (
    <div className="cal">
      <div className="cal__main">
        <div className="cal__head">
          <h1>{monthFmt.format(parseDay(month))}</h1>
          <div className="cal__nav">
            <button className="icon-btn" title="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              <span className="flip">{Icon.chevron}</span>
            </button>
            <button
              className="btn small"
              onClick={() => {
                setMonth(monthStart(today));
                setSelected(today);
              }}
            >
              Today
            </button>
            <button className="icon-btn" title="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
              {Icon.chevron}
            </button>
          </div>
        </div>
        <div className="cal__grid" role="grid">
          {WEEKDAYS.map((d) => (
            <div key={d} className="cal__wd">
              {d}
            </div>
          ))}
          {cells.map((k) => {
            const d = days.get(k);
            const entries = d?.entries ?? [];
            const shown = entries.slice(0, 3);
            const inMonth = k.slice(0, 7) === month.slice(0, 7);
            return (
              <button
                key={k}
                role="gridcell"
                className={`cal__day${inMonth ? "" : " out"}${k === today ? " today" : ""}${k === selected ? " selected" : ""}`}
                onClick={() => setSelected(k)}
              >
                <span className="cal__num">
                  {parseDay(k).getDate()}
                  {d?.checkIn && <span className="cal__journal" title="Journal entry" />}
                </span>
                {shown.map(({ item, finished }) => (
                  <span
                    key={`${item.id}${finished}`}
                    className={`cal__chip k-${item.kind}${finished || item.doneAt ? " done" : ""}`}
                  >
                    {item.title}
                  </span>
                ))}
                {entries.length > 3 && <span className="cal__more">+{entries.length - 3} more</span>}
              </button>
            );
          })}
        </div>
        <div className="cal__legend">
          <span className="k-milestone">Milestone</span>
          <span className="k-priority">Priority</span>
          <span className="k-move">Task</span>
          <span className="k-blocker">Blocker</span>
          <span className="cal__legend-journal">Journal entry</span>
        </div>
      </div>
      <DayPanel day={selected} data={days.get(selected) ?? { entries: [], checkIn: null }} />
    </div>
  );
}

function DayPanel({ day, data }: { day: string; data: { entries: DayEntry[]; checkIn: CheckIn | null } }) {
  const today = dayKey();
  const items = useAction((s) => s.items);
  const weekGoals = useMemo(
    () => items.filter((i) => i.kind === "week" && i.date === weekKey(parseDay(day))),
    [items, day],
  );
  const [kind, setKind] = useState<"priority" | "move" | "milestone">("priority");
  const [title, setTitle] = useState("");
  const past = day < today;
  const blocked = kind === "priority" ? limitReason("priority", day) : null;

  const add = () => {
    if (!title.trim()) return;
    if (blocked) {
      toast(blocked);
      return;
    }
    addItem({ kind, title, date: day });
    setTitle("");
  };

  const rel =
    day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : day === addDays(today, -1) ? "Yesterday" : null;

  return (
    <aside className="cal__panel">
      <div className="cal__panel-head">
        <h2>{dayFmt.format(parseDay(day))}</h2>
        {rel && <span className="muted small">{rel}</span>}
      </div>

      {data.entries.length === 0 && !data.checkIn && (
        <p className="cal__empty">{past ? "Nothing recorded on this day." : "Nothing planned yet."}</p>
      )}

      <div className="cal__list">
        {data.entries.map(({ item, finished }) => (
          <div key={`${item.id}${finished}`} className={`cal__row${item.doneAt ? " is-done" : ""}`}>
            <button
              className={`check${item.doneAt ? " done" : ""}`}
              title={item.doneAt ? "Mark not done" : "Mark done"}
              onClick={() => toggleDone(item.id)}
            >
              {item.doneAt ? Icon.check : null}
            </button>
            <div className="cal__row-main">
              <span className={`cal__kind k-${item.kind}`}>
                {finished ? `Finished · ${KIND_LABEL[item.kind]}` : KIND_LABEL[item.kind]}
              </span>
              <span className="cal__title">
                {item.goal ? <span className="muted">{item.goal}: </span> : null}
                {item.title}
              </span>
              {item.boardPath && (
                <button className="board-chip" onClick={() => openLinkedBoard(item)}>
                  {Icon.board}
                  <span>{boardName(item.boardPath)}</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {data.checkIn && (
        <div className="cal__journal-entry">
          <div className="cal__kind">Journal</div>
          {data.checkIn.moved && <p>{data.checkIn.moved}</p>}
          {data.checkIn.tomorrow && (
            <p>
              <span className="muted">Next: </span>
              {data.checkIn.tomorrow}
            </p>
          )}
          {data.checkIn.blocking && (
            <p className="blocked">
              <span className="muted">Blocked by: </span>
              {data.checkIn.blocking}
            </p>
          )}
        </div>
      )}
      {!data.checkIn && day === today && (
        <button className="linkish small cal__checkin" onClick={() => setApp({ actionTab: "plan" })}>
          Write today's check-in →
        </button>
      )}

      {weekGoals.length > 0 && (
        <div className="cal__week">
          <div className="cal__kind">This week's outcomes</div>
          {weekGoals.map((g) => (
            <div key={g.id} className={`cal__week-goal${g.doneAt ? " done" : ""}`}>
              {g.doneAt ? "✓ " : "• "}
              {g.title}
            </div>
          ))}
        </div>
      )}

      {!past && (
        <div className="cal__add">
          <div className="seg">
            {(["priority", "move", "milestone"] as const).map((k) => (
              <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
                {k === "move" ? "Task" : KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="cal__add-row">
            <input
              value={title}
              placeholder={
                kind === "priority"
                  ? `A priority for ${rel?.toLowerCase() ?? "this day"}`
                  : kind === "move"
                    ? "Something to do by this day"
                    : "Milestone (e.g. First draft done)"
              }
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <button className="btn small primary" disabled={!title.trim()} onClick={add}>
              Add
            </button>
          </div>
          {blocked && <div className="cal__note">{blocked}</div>}
        </div>
      )}
    </aside>
  );
}
