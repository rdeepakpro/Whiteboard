/**
 * Action: Today (3), This Week (3), Next Moves, Milestones, Blockers, a daily
 * check-in, and the Startup Journey. Deliberately plain — no statuses,
 * scores or widgets beyond what the brainstorm → do → document loop needs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { setApp, useApp } from "../state/store";
import { boardName } from "../lib/paths";
import { toast } from "../lib/toast";
import { Icon } from "../shell/icons";
import { openContextMenu, type MenuItem } from "../shell/ContextMenu";
import { ModeSwitch } from "../shell/ModeSwitch";
import { BoardPicker } from "./BoardPicker";
import { openLinkedBoard } from "./bridge";
import { Journey } from "./Journey";
import { computeSuggestions, type Suggestion } from "./suggest";
import {
  addDays,
  addItem,
  dayKey,
  daysUntil,
  dismissSuggestion,
  limitReason,
  moveToToday,
  parseDay,
  removeItem,
  saveCheckIn,
  toggleDone,
  updateItem,
  useAction,
  weekKey,
  type ActionItem,
  type ItemKind,
} from "./store";

export function useCheckInDue() {
  const { checkInReminder, checkInHour } = useApp((s) => s.prefs);
  const checkedIn = useAction((s) => s.checkIns.some((c) => c.date === dayKey()));
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = window.setInterval(() => setHour(new Date().getHours()), 5 * 60_000);
    return () => window.clearInterval(id);
  }, []);
  return checkInReminder && !checkedIn && hour >= checkInHour;
}

export function ActionView() {
  const tab = useApp((s) => s.actionTab);
  return (
    <div className="action">
      <header className="action__bar" data-tauri-drag-region>
        <ModeSwitch />
        <nav className="action__tabs">
          <button className={tab === "plan" ? "active" : ""} onClick={() => setApp({ actionTab: "plan" })}>
            Plan
          </button>
          <button className={tab === "journey" ? "active" : ""} onClick={() => setApp({ actionTab: "journey" })}>
            Journey
          </button>
        </nav>
      </header>
      <div className="action__scroll">{tab === "plan" ? <Plan /> : <Journey />}</div>
    </div>
  );
}

const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

function Plan() {
  const items = useAction((s) => s.items);
  const loaded = useAction((s) => s.loaded);
  const [checkingIn, setCheckingIn] = useState(false);
  const due = useCheckInDue();
  const checkedIn = useAction((s) => s.checkIns.find((c) => c.date === dayKey()));
  const today = dayKey();
  const wk = weekKey();

  const priorities = items.filter((i) => i.kind === "priority" && i.date === today);
  const carried = items.filter((i) => i.kind === "priority" && !i.doneAt && i.date && i.date < today);
  const week = items.filter((i) => i.kind === "week" && i.date === wk);
  const moves = items.filter((i) => i.kind === "move" && (!i.doneAt || Date.now() - i.doneAt < 12 * 3600_000));
  const milestones = items
    .filter((i) => i.kind === "milestone" && (!i.doneAt || Date.now() - i.doneAt < 3 * 86_400_000))
    .sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
  const blockers = items.filter((i) => i.kind === "blocker" && (!i.doneAt || Date.now() - i.doneAt < 12 * 3600_000));

  if (!loaded) return null;
  return (
    <div className="plan">
      <div className="plan__head">
        <h1>{dateLabel.format(new Date())}</h1>
        {checkedIn ? (
          <button className="linkish small" onClick={() => setCheckingIn(true)}>
            {Icon.check} Checked in · edit
          </button>
        ) : (
          <button className={`btn small${due ? " primary" : ""}`} onClick={() => setCheckingIn(true)}>
            Daily check-in
          </button>
        )}
      </div>
      {due && !checkingIn && (
        <div className="checkin-nudge">
          Wrapping up? A 30-second check-in keeps your journey honest.
          <button className="linkish" onClick={() => setCheckingIn(true)}>
            Check in
          </button>
        </div>
      )}
      {checkingIn && <CheckInForm onDone={() => setCheckingIn(false)} />}

      <div className="plan__grid">
        <div className="plan__col">
          <Section
            title="Today"
            count={`${priorities.filter((p) => !p.doneAt).length}/3`}
            hint="Up to three priorities."
          >
            {priorities.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
            <AddRow kind="priority" placeholder="Add a priority for today" />
            {carried.length > 0 && (
              <div className="carried">
                <div className="carried__label">Unfinished from earlier</div>
                {carried.map((i) => (
                  <ItemRow
                    key={i.id}
                    item={i}
                    extra={
                      <button
                        className="btn small"
                        onClick={() => !moveToToday(i.id) && toast("Today already has 3 priorities.")}
                      >
                        Today
                      </button>
                    }
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="This Week" count={`${week.filter((p) => !p.doneAt).length}/3`} hint="Up to three outcomes.">
            {week.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
            <AddRow kind="week" placeholder="Add an outcome for this week" />
          </Section>

          <Section title="Next Moves" hint="One clear next action per goal.">
            {moves.map((i) => (
              <MoveRow key={i.id} item={i} />
            ))}
            <AddMove />
          </Section>
        </div>

        <div className="plan__col">
          <Section title="Milestones">
            {milestones.map((i) => (
              <ItemRow key={i.id} item={i} extra={<Countdown item={i} />} />
            ))}
            <AddMilestone />
          </Section>

          <Section title="Blockers">
            {blockers.map((i) => (
              <ItemRow key={i.id} item={i} doneLabel="Resolved" />
            ))}
            <AddRow kind="blocker" placeholder="What's in the way?" />
          </Section>

          <FromBoards />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="asec">
      <div className="asec__head">
        <h2>{title}</h2>
        {count && <span className="asec__count">{count}</span>}
        {hint && <span className="asec__hint">{hint}</span>}
      </div>
      <div className="asec__body">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------- rows

function Check({ item, label }: { item: ActionItem; label?: string }) {
  return (
    <button
      className={`check${item.doneAt ? " done" : ""}`}
      title={item.doneAt ? "Mark not done" : (label ?? "Mark done")}
      aria-pressed={!!item.doneAt}
      onClick={() => toggleDone(item.id)}
    >
      {item.doneAt ? Icon.check : null}
    </button>
  );
}

function EditableTitle({ item, field = "title" }: { item: ActionItem; field?: "title" | "goal" }) {
  const [editing, setEditing] = useState(false);
  const value = (item[field] ?? "") as string;
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <span
        className={`arow__title${field === "goal" ? " goal" : ""}`}
        onDoubleClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title="Double-click to edit"
      >
        {value}
      </span>
    );
  }
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) updateItem(item.id, { [field]: v });
  };
  return (
    <input
      className="arow__input"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

function BoardChip({ item }: { item: ActionItem }) {
  if (!item.boardPath) return null;
  return (
    <button className="board-chip" title={`Open “${boardName(item.boardPath)}”`} onClick={() => openLinkedBoard(item)}>
      {Icon.board}
      <span>{boardName(item.boardPath)}</span>
    </button>
  );
}

function rowMenu(item: ActionItem, linkBoard: () => void): MenuItem[] {
  return [
    { label: item.boardPath ? "Change Linked Board…" : "Link to Board…", icon: Icon.board, onSelect: linkBoard },
    ...(item.boardPath
      ? [
          {
            label: "Unlink Board",
            onSelect: () => updateItem(item.id, { boardPath: null, elementIds: null }),
          } as MenuItem,
        ]
      : []),
    ...(item.kind === "priority" && item.date !== dayKey()
      ? [
          {
            label: "Move to Today",
            onSelect: () => !moveToToday(item.id) && toast("Today already has 3 priorities."),
          } as MenuItem,
        ]
      : []),
    "separator",
    { label: "Delete", icon: Icon.trash, danger: true, onSelect: () => removeItem(item.id) },
  ];
}

function ItemRow({ item, extra, doneLabel }: { item: ActionItem; extra?: React.ReactNode; doneLabel?: string }) {
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <div className={`arow${item.doneAt ? " is-done" : ""}`} ref={anchor}>
      <Check item={item} label={doneLabel} />
      <div className="arow__main">
        <EditableTitle item={item} />
        <BoardChip item={item} />
      </div>
      {extra}
      <button
        className="icon-btn small arow__more"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openContextMenu(
            { clientX: r.left, clientY: r.bottom + 2 },
            rowMenu(item, () => setPicking(true)),
          );
        }}
      >
        {Icon.more}
      </button>
      {picking && (
        <BoardPicker
          seedText={`${item.goal ?? ""} ${item.title}`}
          current={item.boardPath}
          onPick={(path) => {
            updateItem(item.id, { boardPath: path, elementIds: null });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function MoveRow({ item }: { item: ActionItem }) {
  const [picking, setPicking] = useState(false);
  const [next, setNext] = useState("");
  const done = !!item.doneAt;
  const hasFollowUp = useAction((s) =>
    s.items.some((i) => i.kind === "move" && !i.doneAt && i.goal && i.goal === item.goal && i.id !== item.id),
  );
  return (
    <div className={`arow move${done ? " is-done" : ""}`}>
      <Check item={item} />
      <div className="arow__main column">
        {item.goal && (
          <span className="arow__goal">
            <EditableTitle item={item} field="goal" />
          </span>
        )}
        <EditableTitle item={item} />
        <BoardChip item={item} />
        {done && item.goal && !hasFollowUp && !item.goalDone && (
          <div className="followup">
            <input
              className="arow__input"
              placeholder={`Next move for “${item.goal}”…`}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && next.trim()) {
                  addItem({ kind: "move", title: next, goal: item.goal, boardPath: item.boardPath });
                  setNext("");
                }
              }}
            />
            <button className="linkish small" onClick={() => updateItem(item.id, { goalDone: true })}>
              Goal done
            </button>
          </div>
        )}
      </div>
      <button
        className="icon-btn small arow__more"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openContextMenu(
            { clientX: r.left, clientY: r.bottom + 2 },
            rowMenu(item, () => setPicking(true)),
          );
        }}
      >
        {Icon.more}
      </button>
      {picking && (
        <BoardPicker
          seedText={`${item.goal ?? ""} ${item.title}`}
          current={item.boardPath}
          onPick={(path) => {
            updateItem(item.id, { boardPath: path, elementIds: null });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function Countdown({ item }: { item: ActionItem }) {
  const [editing, setEditing] = useState(false);
  if (editing || !item.date) {
    return (
      <input
        type="date"
        className="date-input"
        autoFocus={editing}
        defaultValue={item.date ?? ""}
        onBlur={(e) => {
          if (e.target.value) updateItem(item.id, { date: e.target.value });
          setEditing(false);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    );
  }
  const n = daysUntil(item.date);
  const text = item.doneAt
    ? "reached"
    : n === 0
      ? "today"
      : n === 1
        ? "tomorrow"
        : n > 0
          ? `${n} days`
          : `${-n} days ago`;
  return (
    <button
      className={`countdown${n < 0 && !item.doneAt ? " late" : ""}${n >= 0 && n <= 7 && !item.doneAt ? " soon" : ""}`}
      title={parseDay(item.date).toDateString()}
      onClick={() => setEditing(true)}
    >
      {text}
    </button>
  );
}

// -------------------------------------------------------------- adding

function AddRow({ kind, placeholder }: { kind: ItemKind; placeholder: string }) {
  const [value, setValue] = useState("");
  useAction((s) => s.items); // re-evaluate limits on change
  const blocked = limitReason(kind);
  if (blocked) return <div className="add-row blocked">{blocked} Finish or remove one first.</div>;
  return (
    <div className="add-row">
      <span className="add-row__plus">{Icon.plus}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            addItem({ kind, title: value });
            setValue("");
          }
        }}
      />
    </div>
  );
}

function AddMove() {
  const [goal, setGoal] = useState("");
  const [move, setMove] = useState("");
  const moveRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    if (!move.trim()) return;
    addItem({ kind: "move", title: move, goal: goal.trim() || null });
    setGoal("");
    setMove("");
  };
  return (
    <div className="add-row two">
      <span className="add-row__plus">{Icon.plus}</span>
      <input
        className="goal"
        value={goal}
        placeholder="Goal (e.g. Launch beta)"
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && moveRef.current?.focus()}
      />
      <span className="add-row__arrow">→</span>
      <input
        ref={moveRef}
        value={move}
        placeholder="Next move"
        onChange={(e) => setMove(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
    </div>
  );
}

function AddMilestone() {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => addDays(dayKey(), 14));
  const submit = () => {
    if (!title.trim()) return;
    addItem({ kind: "milestone", title, date });
    setTitle("");
  };
  return (
    <div className="add-row two">
      <span className="add-row__plus">{Icon.plus}</span>
      <input
        value={title}
        placeholder="Milestone (e.g. 100 users)"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <input
        type="date"
        className="date-input"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
    </div>
  );
}

// ------------------------------------------------------------ check-in

function CheckInForm({ onDone }: { onDone: () => void }) {
  const existing = useAction((s) => s.checkIns.find((c) => c.date === dayKey()));
  const [moved, setMoved] = useState(existing?.moved ?? "");
  const [tomorrow, setTomorrow] = useState(existing?.tomorrow ?? "");
  const [blocking, setBlocking] = useState(existing?.blocking ?? "");
  const items = useAction((s) => s.items);
  const doneToday = useMemo(
    () => items.filter((i) => i.doneAt && dayKey(new Date(i.doneAt)) === dayKey()).map((i) => i.title),
    [items],
  );
  const save = () => {
    if (!moved.trim() && !tomorrow.trim() && !blocking.trim()) {
      onDone();
      return;
    }
    saveCheckIn({ moved: moved.trim(), tomorrow: tomorrow.trim(), blocking: blocking.trim() });
    toast("Saved to your Startup Journey");
    onDone();
  };
  return (
    <div className="checkin">
      <label>
        What moved forward today?
        <textarea
          autoFocus
          rows={2}
          value={moved}
          placeholder={doneToday.length ? `Done today: ${doneToday.join(", ")}` : ""}
          onChange={(e) => setMoved(e.target.value)}
        />
      </label>
      <label>
        What is the most important thing tomorrow?
        <textarea rows={1} value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} />
      </label>
      <label>
        Anything blocking you?
        <textarea rows={1} value={blocking} onChange={(e) => setBlocking(e.target.value)} />
      </label>
      <div className="checkin__actions">
        <button className="btn" onClick={onDone}>
          Not now
        </button>
        <button className="btn primary" onClick={save}>
          Save check-in
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------- suggestions from boards

function FromBoards() {
  const [list, setList] = useState<Suggestion[] | null>(null);
  const dismissed = useAction((s) => s.dismissed);
  const tree = useApp((s) => s.tree);
  useEffect(() => {
    let cancelled = false;
    computeSuggestions().then((s) => !cancelled && setList(s.filter((x) => x.type === "todo")));
    return () => {
      cancelled = true;
    };
  }, [dismissed, tree]);
  const todos = useMemo(() => (list ?? []).filter((s) => s.type === "todo").slice(0, 5), [list]);
  if (!todos.length) return null;
  return (
    <Section title="From your boards" hint="To-dos spotted in your brainstorms.">
      {todos.map((s) =>
        s.type === "todo" ? (
          <div key={s.id} className="suggestion">
            <div className="suggestion__main">
              <span>{s.text}</span>
              <button className="board-chip" onClick={() => openLinkedBoard({ boardPath: s.path, elementIds: null })}>
                {Icon.board}
                <span>{boardName(s.path)}</span>
              </button>
            </div>
            <div className="suggestion__actions">
              <button
                className="btn small"
                onClick={() => {
                  addItem({ kind: "move", title: s.text, goal: boardName(s.path), boardPath: s.path });
                  dismissSuggestion(s.id);
                }}
              >
                Next Move
              </button>
              <button className="icon-btn small" title="Dismiss" onClick={() => dismissSuggestion(s.id)}>
                {Icon.close}
              </button>
            </div>
          </div>
        ) : null,
      )}
    </Section>
  );
}
