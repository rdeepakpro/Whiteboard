/**
 * Hosts one official <Excalidraw /> instance for one tab. The editor UI is
 * Excalidraw's own; the only customizations are:
 *  - file actions in the main menu point at Whiteboard's native Open/Save As
 *    (Excalidraw's browser-download versions are disabled via UIOptions)
 *  - the welcome screen shows Excalidraw's hints without the web-app branding
 *  - Design boards get a "Design" sidebar (Excalidraw's own Sidebar API)
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu, Sidebar, WelcomeScreen, getCommonBounds } from "@excalidraw/excalidraw";
import { DESIGN_SIDEBAR, DesignPanel, designIcon } from "../design/DesignPanel";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState, UIOptions } from "@excalidraw/excalidraw/types";
import { BoardSession } from "./BoardSession";
import { sessions, focusEditor } from "./registry";
export { focusEditor };
import { getApp, setApp, setTabStatus, useApp } from "../state/store";
import { schedulePersist, viewports } from "../state/persist";
import { libraryItems, onLibraryChange } from "../lib/library";
import { setLiveStats } from "../lib/liveStats";
import { boardName } from "../lib/paths";
import { closeTab, openWithDialog, saveAs, reveal } from "../lib/boards";
import { Icon } from "../shell/icons";

const UI_OPTIONS: Partial<UIOptions> = {
  // Let sidebars (Library, Design) dock beside the canvas on laptop screens.
  dockedSidebarBreakpoint: 1000,
  canvasActions: {
    loadScene: false, // replaced by native Open… (Cmd+O)
    saveToActiveFile: false, // Whiteboard autosaves to the board's file
    export: false, // replaced by native Save As… (Cmd+Shift+S)
    saveAsImage: true,
    toggleTheme: true,
    clearCanvas: true,
    changeViewBackgroundColor: true,
  },
};

interface Props {
  tabId: string;
  path: string;
  active: boolean;
  theme: "light" | "dark";
  langCode: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; initialData: ExcalidrawInitialDataState }
  | { status: "error"; message: string };

export const BoardEditor = memo(function BoardEditor({ tabId, path, active, theme, langCode }: Props) {
  const sessionRef = useRef<BoardSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new BoardSession(tabId, path);
  const session = sessionRef.current;
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const isDesign = useApp((s) => s.designBoards.includes(path));
  const isDesignRef = useRef(isDesign);
  isDesignRef.current = isDesign;

  // Open the Design panel when a board becomes a Design board (or opens as one).
  useEffect(() => {
    if (!isDesign || !session.api || window.innerWidth < 1000) return;
    const id = window.setTimeout(() => session.api?.toggleSidebar({ name: DESIGN_SIDEBAR, force: true }), 150);
    return () => window.clearTimeout(id);
  }, [isDesign, session, load.status]);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const lastSeenTheme = useRef<string | null>(null);

  // Keep the session pointed at the current path (renames/moves/Save As).
  useEffect(() => {
    if (session.path !== path) session.setPath(path);
  }, [path, session]);

  useEffect(() => {
    session.revive();
    sessions.set(tabId, session);
    return () => {
      sessions.delete(tabId);
      session.dispose();
    };
  }, [tabId, session]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    session
      .load()
      .then((scene) => {
        if (cancelled) return;
        const vp = viewports[session.path];
        setLoad({
          status: "ready",
          initialData: {
            elements: scene.elements,
            appState: {
              ...scene.appState,
              ...(vp ? { scrollX: vp.scrollX, scrollY: vp.scrollY, zoom: { value: vp.zoom as any } } : {}),
            },
            files: scene.files,
            libraryItems: libraryItems(),
            scrollToContent: !vp,
          },
        });
        setTabStatus(tabId, { loadError: null });
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e).replace(/^\w+: /, "");
        setLoad({ status: "error", message });
        setTabStatus(tabId, { loadError: message });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // When this tab becomes active: re-measure and give the canvas focus.
  useEffect(() => {
    if (!active || load.status !== "ready") return;
    const id = window.setTimeout(() => {
      session.api?.refresh();
      focusEditor(tabId);
      pushStats(session);
    }, 0);
    return () => window.clearTimeout(id);
  }, [active, load.status, session, tabId]);

  const handlers = useMemo(
    () => ({
      excalidrawAPI: (api: any) => {
        session.attach(api);
        if (isDesignRef.current && window.innerWidth >= 1000) {
          window.setTimeout(() => api.toggleSidebar({ name: DESIGN_SIDEBAR, force: true }), 150);
        }
        if (!viewports[session.path]) window.setTimeout(() => fitIfLarger(api), 60);
        if (activeRef.current) window.setTimeout(() => pushStats(session), 0);
      },
      onChange: (elements: any, appState: any, files: any) => {
        session.onChange(elements, appState, files);
        if (!activeRef.current) return;
        // Excalidraw's own theme toggle (main menu / Alt+Shift+D) updates
        // prefs. Only react to a change Excalidraw made itself, not to the
        // brief lag while it adopts a new `theme` prop.
        const prev = lastSeenTheme.current;
        lastSeenTheme.current = appState.theme;
        if (prev !== null && prev !== appState.theme && appState.theme !== themeRef.current) {
          setApp((s) => ({ prefs: { ...s.prefs, theme: appState.theme } }));
          schedulePersist();
        }
        throttledStats(session);
      },
      onScrollChange: (scrollX: number, scrollY: number, zoom: { value: number }) => {
        viewports[session.path] = { scrollX, scrollY, zoom: zoom.value };
        if (activeRef.current) throttledStats(session);
      },
      onLibraryChange: (items: any) => onLibraryChange(items, tabId),
      onPointerUpdate: (payload: { pointer: { x: number; y: number } }) => {
        session.lastPointer = { x: payload.pointer.x, y: payload.pointer.y, at: Date.now() };
      },
    }),
    [session, tabId],
  );

  if (load.status === "loading") return <div className="editor-loading" />;
  if (load.status === "error") {
    return (
      <div className="editor-error">
        <div className="editor-error__card">
          <div className="editor-error__title">“{boardName(path)}” couldn't be opened</div>
          <div className="editor-error__body">{load.message}</div>
          <div className="editor-error__body muted">Whiteboard hasn't changed the file.</div>
          <div className="row gap">
            <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Try Again</button>
            <button className="btn" onClick={() => reveal(path)}>Show in Finder</button>
            <button className="btn" onClick={() => closeTab(tabId)}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Excalidraw
      initialData={load.initialData}
      excalidrawAPI={handlers.excalidrawAPI}
      onChange={handlers.onChange}
      onScrollChange={handlers.onScrollChange}
      onLibraryChange={handlers.onLibraryChange}
      onPointerUpdate={handlers.onPointerUpdate}
      renderTopRightUI={isDesign ? renderDesignTrigger : undefined}
      theme={theme}
      langCode={langCode}
      name={boardName(path)}
      UIOptions={UI_OPTIONS}
      autoFocus={active}
      handleKeyboardGlobally={false}
      aiEnabled={false}
    >
      <MainMenu>
        <MainMenu.Item icon={Icon.folderOpen} shortcut="Cmd+O" onSelect={() => void openWithDialog()}>
          Open…
        </MainMenu.Item>
        <MainMenu.Item icon={Icon.save} shortcut="Cmd+Shift+S" onSelect={() => void saveAs()}>
          Save As…
        </MainMenu.Item>
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.Item icon={Icon.history} shortcut="Cmd+Y" onSelect={() => setApp({ historyOpen: true })}>
          Version History
        </MainMenu.Item>
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.Help />
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
      {isDesign && <DesignPanel getApi={() => session.api} />}
      <WelcomeScreen>
        <WelcomeScreen.Hints.MenuHint />
        <WelcomeScreen.Hints.ToolbarHint />
        <WelcomeScreen.Hints.HelpHint />
      </WelcomeScreen>
    </Excalidraw>
  );
});

function renderDesignTrigger() {
  return (
    <Sidebar.Trigger name={DESIGN_SIDEBAR} icon={designIcon} title="Design kit" className="wb-design-trigger">
      Design
    </Sidebar.Trigger>
  );
}

/** First open of a board: zoom out to fit if it's bigger than the window. */
function fitIfLarger(api: ExcalidrawImperativeAPI) {
  const elements = api.getSceneElements();
  if (!elements.length) return;
  const [x1, y1, x2, y2] = getCommonBounds(elements);
  const { width, height } = api.getAppState();
  if (x2 - x1 > width * 0.9 || y2 - y1 > height * 0.85) {
    api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.85 });
  }
}

function pushStats(session: BoardSession) {
  const api = session.api;
  if (!api) return;
  const st = api.getAppState();
  setLiveStats({ elements: api.getSceneElements().length, zoom: st.zoom.value });
}

let statsTimer: number | undefined;
let statsSession: BoardSession | null = null;
function throttledStats(session: BoardSession) {
  statsSession = session;
  if (statsTimer !== undefined) return;
  statsTimer = window.setTimeout(() => {
    statsTimer = undefined;
    const s = statsSession;
    if (s && getApp().activeTabId === s.tabId) pushStats(s);
  }, 300);
}
