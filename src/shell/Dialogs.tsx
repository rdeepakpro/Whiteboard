import { useEffect, useRef, useState, type ReactNode } from "react";
import { readText as readClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import { insertWebReference, parseLink } from "../lib/webref";
import { ensureBoard } from "../lib/capture";
import { boardName } from "../lib/paths";
import { addDays, addItem, dayKey, limitReason } from "../action/store";
import { isMessyName } from "../action/suggest";
import { exportToSvg, getNonDeletedElements } from "@excalidraw/excalidraw";
import { parseScene } from "../editor/scene";
import { DESIGN_TEMPLATES } from "../design/templates";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { languages } from "@excalidraw/excalidraw";
import { activeTab, allFolders, getApp, setApp, useApp, type Prefs } from "../state/store";
import { ipc } from "../platform/ipc";
import { schedulePersist } from "../state/persist";
import { newBoard, refreshTree, trashPath } from "../lib/boards";
import { builtinTemplates, userTemplates, type Template } from "../lib/templates";
import { focusEditor } from "../editor/BoardEditor";
import { toast } from "../lib/toast";
import { forwardKey } from "../lib/commands";
import { Icon } from "./icons";
import licensesReadme from "../../LICENSES/README.md?raw";
import excalidrawMit from "../../LICENSES/Excalidraw-MIT.txt?raw";
import ofl from "../../LICENSES/OFL-1.1.txt?raw";
import comicShannsMit from "../../LICENSES/ComicShanns-MIT.txt?raw";

const EXCALIDRAW_VERSION = "0.18.1";

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  if (!dialog || dialog.kind === "palette") return null;
  switch (dialog.kind) {
    case "settings":
      return <SettingsDialog section={dialog.section} />;
    case "templates":
      return <TemplatesDialog folder={dialog.folder} tab={dialog.tab} />;
    case "shortcuts":
      return <ShortcutsDialog />;
    case "licenses":
      return <LicensesDialog />;
    case "insert-link":
      return <InsertLinkDialog variant={dialog.variant ?? "web"} />;
    case "send-to-action":
      return <SendToActionDialog {...dialog} />;
  }
}

function close() {
  setApp({ dialog: null });
  const tab = activeTab();
  if (tab) window.setTimeout(() => focusEditor(tab.id), 0);
}

function Modal({ title, children, wide, onClose = close }: { title: string; children: ReactNode; wide?: boolean; onClose?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className={`modal${wide ? " wide" : ""}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal__head">
          <span>{title}</span>
          <button className="icon-btn small" onClick={onClose} title="Close">
            {Icon.close}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ settings

function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  setApp((s) => ({ prefs: { ...s.prefs, [key]: value } }));
  schedulePersist();
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field__label">
        {label}
        {hint && <div className="field__hint">{hint}</div>}
      </div>
      <div className="field__control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle${checked ? " on" : ""}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

const SECTIONS = ["General", "Editor", "Files", "Capture", "Action", "Appearance", "About"] as const;

function SettingsDialog({ section }: { section?: string }) {
  const [tab, setTab] = useState<string>(section ?? "General");
  const prefs = useApp((s) => s.prefs);
  const tree = useApp((s) => s.tree);
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);

  const chooseRoot = async () => {
    const dir = await openDialog({ directory: true, defaultPath: prefs.libraryRoot });
    if (typeof dir !== "string" || dir === prefs.libraryRoot) return;
    setPref("libraryRoot", dir);
    setPref("newBoardFolder", "");
    await refreshTree();
    toast("Boards folder changed");
  };

  return (
    <Modal title="Settings" wide>
      <div className="settings">
        <nav className="settings__nav">
          {SECTIONS.map((s) => (
            <button key={s} className={`nav-row${tab === s ? " active" : ""}`} onClick={() => setTab(s)}>
              {s}
            </button>
          ))}
        </nav>
        <div className="settings__body">
          {tab === "General" && (
            <>
              <Field label="Theme">
                <select value={prefs.theme} onChange={(e) => setPref("theme", e.target.value as Prefs["theme"])}>
                  <option value="system">Match System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </Field>
              <Field label="Reopen previous session" hint="Restore open tabs when Whiteboard starts.">
                <Toggle checked={prefs.reopenSession} onChange={(v) => setPref("reopenSession", v)} />
              </Field>
              <Field label="Boards folder" hint="A normal Finder folder. Each workspace is a subfolder; each board is a .excalidraw file.">
                <div className="path-pick">
                  <code title={prefs.libraryRoot}>{prefs.libraryRoot.replace(/^\/Users\/[^/]+/, "~")}</code>
                  <button className="btn small" onClick={chooseRoot}>Change…</button>
                </div>
              </Field>
              <Field label="New boards go to" hint="Used when no folder is selected in the sidebar.">
                <select value={prefs.newBoardFolder || ""} onChange={(e) => setPref("newBoardFolder", e.target.value)}>
                  <option value="">Top level</option>
                  {allFolders(tree).map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.path.slice(prefs.libraryRoot.length + 1).replace(/\//g, " / ")}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {tab === "Editor" && (
            <>
              <Field label="Editor language" hint="Excalidraw's interface language.">
                <select value={prefs.langCode} onChange={(e) => setPref("langCode", e.target.value)}>
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="settings__note">
                Grid, snapping, stroke and fill defaults, and other drawing preferences live in Excalidraw itself (main menu
                and the properties panel) and work exactly as in Excalidraw.
              </p>
            </>
          )}
          {tab === "Files" && (
            <>
              <Field label="Autosave" hint="Save quietly while you work. When off, use ⌘S.">
                <Toggle checked={prefs.autosave} onChange={(v) => setPref("autosave", v)} />
              </Field>
              <Field label="Save after a pause of">
                <select value={prefs.autosaveDelayMs} onChange={(e) => setPref("autosaveDelayMs", Number(e.target.value))}>
                  <option value={500}>0.5 seconds</option>
                  <option value={800}>0.8 seconds</option>
                  <option value={1500}>1.5 seconds</option>
                  <option value={3000}>3 seconds</option>
                </select>
              </Field>
              <Field label="History snapshot every" hint="Plus a snapshot whenever you press ⌘S.">
                <select value={prefs.historyIntervalMin} onChange={(e) => setPref("historyIntervalMin", Number(e.target.value))}>
                  <option value={5}>5 minutes</option>
                  <option value={10}>10 minutes</option>
                  <option value={20}>20 minutes</option>
                  <option value={30}>30 minutes</option>
                </select>
              </Field>
              <Field label="Keep at most" hint="Older snapshots are thinned out to one per hour, then one per day (60 days).">
                <select value={prefs.historyMax} onChange={(e) => setPref("historyMax", Number(e.target.value))}>
                  <option value={40}>40 versions per board</option>
                  <option value={80}>80 versions per board</option>
                  <option value={150}>150 versions per board</option>
                </select>
              </Field>
            </>
          )}
          {tab === "Capture" && (
            <>
              <Field label="⌘⇧2 works everywhere" hint="Capture a screenshot onto your board even while another app is in front.">
                <Toggle checked={prefs.globalCaptureShortcut} onChange={(v) => setPref("globalCaptureShortcut", v)} />
              </Field>
              <Field label="Hide Whiteboard while capturing" hint="So you can select whatever is behind it.">
                <Toggle checked={prefs.hideWhileCapturing} onChange={(v) => setPref("hideWhileCapturing", v)} />
              </Field>
              <p className="settings__note">
                Screenshots use macOS's own selection tool (press Space to switch to window mode, Esc to cancel). They're
                stored inside the board file, so nothing is saved to your Desktop. macOS asks for Screen Recording
                permission the first time.
              </p>
              <p className="settings__note">
                Link previews: when you insert a link, Whiteboard fetches that page (or YouTube's public oEmbed info)
                once to get its title and image, then caches it locally. Nothing else is ever sent anywhere.
              </p>
            </>
          )}
          {tab === "Action" && <ActionSettings />}
          {tab === "Appearance" && (
            <>
              <Field label="Show Favorites in sidebar">
                <Toggle checked={prefs.showFavoritesInSidebar} onChange={(v) => setPref("showFavoritesInSidebar", v)} />
              </Field>
              <Field label="Show Recents in sidebar">
                <Toggle checked={prefs.showRecentsInSidebar} onChange={(v) => setPref("showRecentsInSidebar", v)} />
              </Field>
              <Field label="Sidebar width">
                <button className="btn small" onClick={() => { setApp({ sidebarWidth: 248 }); schedulePersist(); }}>Reset</button>
              </Field>
            </>
          )}
          {tab === "About" && (
            <div className="about">
              <img src="/app-icon.svg" alt="" width={72} height={72} />
              <div className="about__name">Whiteboard</div>
              <div className="muted">Version {version}</div>
              <p>
                A personal desktop home for your boards. The drawing editor is{" "}
                <strong>Excalidraw</strong> {EXCALIDRAW_VERSION} (MIT License, © Excalidraw), used unmodified.
              </p>
              <p className="muted small">Data folder: {getApp().paths?.dataDir.replace(/^\/Users\/[^/]+/, "~")}</p>
              <button className="btn" onClick={() => setApp({ dialog: { kind: "licenses" } })}>Licenses & Acknowledgements</button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------- templates

const templatePreviews = new Map<string, Promise<SVGSVGElement | null>>();

/** Small vector preview of a template (rendered once, then cached). */
function TemplatePreview({ id, build }: { id: string; build: () => Promise<string> | string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    if (!templatePreviews.has(id)) {
      templatePreviews.set(
        id,
        Promise.resolve(build()).then(async (content) => {
          const scene = parseScene(content);
          const elements = getNonDeletedElements(scene.elements);
          if (!elements.length) return null;
          return exportToSvg({ elements, appState: { ...scene.appState, exportBackground: false }, files: scene.files, exportPadding: 8 });
        }),
      );
    }
    templatePreviews.get(id)!.then((svg) => {
      if (cancelled || !ref.current) return;
      if (!svg) return ref.current.replaceChildren();
      const copy = svg.cloneNode(true) as SVGSVGElement;
      copy.removeAttribute("width");
      copy.removeAttribute("height");
      ref.current.replaceChildren(copy);
    }, () => {});
    return () => {
      cancelled = true;
    };
  }, [id, build]);
  return <div className="template__preview" ref={ref} />;
}

function TemplatesDialog({ folder, tab: initialTab }: { folder?: string; tab?: "brainstorm" | "design" }) {
  const [tab, setTab] = useState(initialTab ?? "brainstorm");
  const [mine, setMine] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const style = useApp((s) => s.prefs.designStyle);
  const builtins = builtinTemplates();
  const reload = () => userTemplates().then(setMine, () => setMine([]));
  useEffect(() => {
    void reload();
  }, []);

  const create = async (name: string | undefined, build: () => Promise<string> | string, design = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const content = await build();
      setApp({ dialog: null });
      await newBoard({ folder, content, name, design });
    } catch (e) {
      toast(`Couldn't use that template: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New Board" wide>
      <div className="templates__tabs">
        <div className="seg">
          <button className={tab === "brainstorm" ? "active" : ""} onClick={() => setTab("brainstorm")}>Brainstorm</button>
          <button className={tab === "design" ? "active" : ""} onClick={() => setTab("design")}>Design</button>
        </div>
        {tab === "design" && (
          <div className="seg small">
            {(["clean", "sketchy"] as const).map((s) => (
              <button key={s} className={style === s ? "active" : ""} onClick={() => setPref("designStyle", s)}>
                {s === "clean" ? "Clean" : "Sketchy"}
              </button>
            ))}
          </div>
        )}
      </div>
      {tab === "brainstorm" ? (
        <>
          <div className="templates">
            {builtins.map((t) => (
              <button key={t.id} className="template" onClick={() => create(t.id === "blank" ? undefined : t.name, t.build)}>
                <TemplatePreview id={t.id} build={t.build} />
                <span className="template__name">{t.name}</span>
                <span className="template__desc">{t.description}</span>
              </button>
            ))}
          </div>
          <div className="templates__mine-title">
            Your templates
            <span className="muted small">Save any board with File → Save as Template</span>
          </div>
          {mine.length === 0 ? (
            <div className="muted small templates__none">None yet.</div>
          ) : (
            <div className="templates">
              {mine.map((t) => (
                <div key={t.id} className="template" role="button" tabIndex={0} onClick={() => create(t.name, t.build)} onKeyDown={(e) => e.key === "Enter" && create(t.name, t.build)}>
                  <TemplatePreview id={t.id} build={t.build} />
                  <span className="template__name">{t.name}</span>
                  <span className="template__desc">{t.description}</span>
                  <button
                    className="icon-btn small template__remove"
                    title="Remove template (moves it to Trash)"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (t.path) await trashPath(t.path);
                      void reload();
                    }}
                  >
                    {Icon.trash}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="templates">
            {DESIGN_TEMPLATES.map((t) => {
              const build = () => t.build(style);
              return (
                <button key={`${t.id}-${style}`} className="template" onClick={() => create(t.name, build, true)}>
                  <TemplatePreview id={`${t.id}-${style}`} build={build} />
                  <span className="template__name">{t.name}</span>
                  <span className="template__desc">{t.description}</span>
                </button>
              );
            })}
          </div>
          <p className="settings__note">
            Design boards add a <strong>Design</strong> panel (top right) with screens, buttons, inputs, cards and more —
            click a piece to add it, or drag it in. Everything stays normal Excalidraw shapes.
          </p>
        </>
      )}
    </Modal>
  );
}

// ----------------------------------------------------------- shortcuts

const SHORTCUTS: [string, [string, string][]][] = [
  [
    "Boards",
    [
      ["New board", "⌘N  or  ⌘T"],
      ["New board from template", "⌥⌘N"],
      ["New folder", "⇧⌘N"],
      ["Open file", "⌘O"],
      ["Save now (+ history snapshot)", "⌘S"],
      ["Save As", "⇧⌘S"],
      ["Close board", "⌘W"],
      ["Reopen closed board", "⇧⌘T"],
      ["Version history", "⌘Y"],
    ],
  ],
  [
    "Navigation",
    [
      ["Search boards & commands", "⌘K"],
      ["Switch to tab 1–9", "⌘1 … ⌘9"],
      ["Next / previous tab", "⌃⇥  /  ⌃⇧⇥"],
      ["Toggle sidebar", "⌘\\"],
      ["Focus mode", "⇧⌘F  (Esc exits)"],
      ["Quick Look selected board", "Space"],
      ["Settings", "⌘,"],
    ],
  ],
  [
    "Canvas (Excalidraw)",
    [
      ["Export image options", "⇧⌘E"],
      ["Copy as PNG", "⌥⇧C"],
      ["Find on canvas", "⌘F"],
      ["Capture screenshot onto board", "⇧⌘2"],
      ["Paste a link → reference card", "⌘V"],
      ["Slash commands (/shot, /embed …)", "/"],
      ["Open a link card", "Double-click"],
      ["Zoom in / out / 100%", "⌘+  ⌘−  ⌘0"],
      ["Zoom to fit", "⇧1"],
      ["Add link to selection", "via ⌘K → “Add Link”"],
      ["All Excalidraw shortcuts", "?"],
    ],
  ],
];

function ShortcutsDialog() {
  const openExcalidrawHelp = () => {
    setApp({ dialog: null });
    window.setTimeout(() => forwardKey({ key: "?", code: "Slash", shiftKey: true }), 50);
  };
  return (
    <Modal title="Keyboard Shortcuts" wide>
      <div className="shortcuts">
        {SHORTCUTS.map(([group, rows]) => (
          <div key={group} className="shortcuts__group">
            <div className="shortcuts__title">{group}</div>
            {rows.map(([label, keys]) => (
              <div key={label} className="shortcuts__row">
                <span>{label}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="settings__note">
        Every Excalidraw shortcut works as usual. ⌘K opens Whiteboard's search instead of Excalidraw's link editor.
        {activeTab() && (
          <>
            {" "}
            <button className="linkish" onClick={openExcalidrawHelp}>Show Excalidraw's shortcut list</button>
          </>
        )}
      </p>
    </Modal>
  );
}

function ActionSettings() {
  const prefs = useApp((s) => s.prefs);
  const [models, setModels] = useState<string[] | null | undefined>(undefined);
  useEffect(() => {
    ipc.localAiModels().then(setModels, () => setModels(null));
  }, []);
  return (
    <>
      <Field label="Evening check-in" hint="A quiet nudge in Action (never a popup) if you haven't checked in.">
        <Toggle checked={prefs.checkInReminder} onChange={(v) => setPref("checkInReminder", v)} />
      </Field>
      <Field label="Nudge after">
        <select value={prefs.checkInHour} onChange={(e) => setPref("checkInHour", Number(e.target.value))} disabled={!prefs.checkInReminder}>
          {[16, 17, 18, 19, 20, 21, 22].map((h) => (
            <option key={h} value={h}>{new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" })}</option>
          ))}
        </select>
      </Field>
      <Field
        label="Use local AI for suggestions"
        hint="Optional. Uses a model running on this Mac via Ollama for board names and weekly summaries. Nothing leaves your computer. Off = simple rules."
      >
        <Toggle checked={prefs.localAiEnabled} onChange={(v) => setPref("localAiEnabled", v)} />
      </Field>
      {prefs.localAiEnabled && (
        <Field label="Model">
          {models === undefined ? (
            <span className="muted small">Looking for Ollama…</span>
          ) : models && models.length ? (
            <select value={prefs.localAiModel} onChange={(e) => setPref("localAiModel", e.target.value)}>
              <option value="">Choose…</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <span className="muted small">Ollama isn't running on this Mac — rules will be used.</span>
          )}
        </Field>
      )}
      <p className="settings__note">
        Suggestions never rename, move or create anything on their own — each one waits for your click.
      </p>
    </>
  );
}

// ------------------------------------------------------------ insert link

const LINK_HINTS = {
  web: { title: "Insert Web Reference", placeholder: "Paste a link…" },
  youtube: { title: "Add YouTube Link", placeholder: "https://youtube.com/watch?v=…" },
  instagram: { title: "Add Instagram Link", placeholder: "https://instagram.com/p/…" },
};

function InsertLinkDialog({ variant }: { variant: keyof typeof LINK_HINTS }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    // Prefill from the clipboard when it holds a link.
    readClipboardText()
      .then((t) => {
        const url = parseLink(t);
        if (url) {
          setValue((v) => v || url);
          window.setTimeout(() => ref.current?.select(), 0);
        }
      })
      .catch(() => {});
  }, []);
  const submit = async () => {
    const url = parseLink(value);
    if (!url) {
      setError(true);
      return;
    }
    close();
    const session = await ensureBoard();
    if (session) void insertWebReference(session, url);
  };
  return (
    <Modal title={LINK_HINTS[variant].title}>
      <div className="link-input">
        <span className="link-input__icon">{Icon.link}</span>
        <input
          ref={ref}
          value={value}
          spellCheck={false}
          placeholder={LINK_HINTS[variant].placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="btn primary small" onClick={submit}>Insert</button>
      </div>
      <div className={`link-input__hint${error ? " error" : ""}`}>
        {error ? "That doesn't look like a link." : "Tip: you can also paste a link straight onto the canvas."}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------- send to action

const SEND_KINDS = [
  { kind: "priority", label: "Priority" },
  { kind: "move", label: "Next Move" },
  { kind: "milestone", label: "Milestone" },
  { kind: "blocker", label: "Blocker" },
] as const;

function SendToActionDialog(props: {
  title: string;
  boardPath: string | null;
  elementIds: string[] | null;
  itemKind?: "priority" | "move" | "milestone" | "blocker";
}) {
  const [kind, setKind] = useState<(typeof SEND_KINDS)[number]["kind"]>(props.itemKind ?? "move");
  const [title, setTitle] = useState(props.title);
  const [goal, setGoal] = useState(props.boardPath && !isMessyName(boardName(props.boardPath)) ? boardName(props.boardPath) : "");
  const [date, setDate] = useState(() => addDays(dayKey(), 14));
  const [linked, setLinked] = useState(props.boardPath);
  const blocked = limitReason(kind);
  const submit = () => {
    if (!title.trim() || blocked) return;
    const item = addItem({
      kind,
      title,
      goal: kind === "move" ? goal.trim() || null : null,
      date: kind === "milestone" ? date : undefined,
      boardPath: linked,
      elementIds: linked === props.boardPath ? props.elementIds : null,
    });
    close();
    if (item) {
      const where = { priority: "Today", move: "Next Moves", milestone: "Milestones", blocker: "Blockers" }[kind];
      toast(`Added to ${where}`, "info", { label: "Open Action", run: () => setApp({ mode: "action", actionTab: "plan" }) });
    }
  };
  return (
    <Modal title="Send to Action">
      <div className="send">
        <div className="seg">
          {SEND_KINDS.map((k) => (
            <button key={k.kind} className={kind === k.kind ? "active" : ""} onClick={() => setKind(k.kind)}>
              {k.label}
            </button>
          ))}
        </div>
        {kind === "move" && (
          <label className="send__field">
            Goal
            <input value={goal} placeholder="e.g. Launch beta" onChange={(e) => setGoal(e.target.value)} />
          </label>
        )}
        <label className="send__field">
          {kind === "move" ? "Next move" : kind === "milestone" ? "Milestone" : kind === "blocker" ? "Blocker" : "Priority"}
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </label>
        {kind === "milestone" && (
          <label className="send__field">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        <div className="send__link">
          {linked ? (
            <>
              Linked to <strong>{boardName(linked)}</strong>
              {props.elementIds?.length && linked === props.boardPath ? " (the selected shapes)" : ""}
              <button className="linkish small" onClick={() => setLinked(null)}>Remove link</button>
            </>
          ) : (
            <span className="muted">Not linked to a board</span>
          )}
        </div>
        {blocked && <div className="send__warn">{blocked} Pick another type, or finish one first.</div>}
        <div className="send__actions">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={!title.trim() || !!blocked} onClick={submit}>
            Send to Action
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ licenses

function LicensesDialog() {
  const docs: [string, string][] = [
    ["Overview", licensesReadme],
    ["Excalidraw (MIT)", excalidrawMit],
    ["SIL Open Font License 1.1", ofl],
    ["Comic Shanns (MIT)", comicShannsMit],
  ];
  const [i, setI] = useState(0);
  return (
    <Modal title="Licenses & Acknowledgements" wide>
      <div className="settings">
        <nav className="settings__nav">
          {docs.map(([t], j) => (
            <button key={t} className={`nav-row${i === j ? " active" : ""}`} onClick={() => setI(j)}>
              {t}
            </button>
          ))}
        </nav>
        <pre className="license-text">{docs[i][1]}</pre>
      </div>
    </Modal>
  );
}
