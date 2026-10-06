import { activeTab, effectiveTheme, EMPTY_STATUS, useApp } from "../state/store";
import { BoardEditor } from "../editor/BoardEditor";
import { sessions } from "../editor/registry";
import { closeTab, saveAs } from "../lib/boards";
import { boardName } from "../lib/paths";
import { HistoryPanel } from "./HistoryPanel";
import { Pages } from "./Pages";

/**
 * Every tab that has been opened keeps its own live Excalidraw instance
 * (instant switching, per-board undo history). Inactive ones are hidden and
 * made inert so they never receive focus, keys, paste or pointer input.
 */
export function EditorArea() {
  const tabs = useApp((s) => s.tabs);
  const mounted = useApp((s) => s.mounted);
  const activeTabId = useApp((s) => s.activeTabId);
  const page = useApp((s) => s.page);
  const theme = useApp((s) => effectiveTheme(s));
  const langCode = useApp((s) => s.prefs.langCode);
  const historyOpen = useApp((s) => s.historyOpen && !!s.activeTabId && !s.page);
  const showPage = page !== null || tabs.length === 0;

  return (
    <div className="editor-area">
      <ConflictBar />
      <div className="editor-row">
        <div className="editors">
          {tabs
            .filter((t) => mounted[t.id])
            .map((t) => {
              const visible = t.id === activeTabId && !showPage;
              return (
                <div
                  key={t.id}
                  className={`editor-slot${visible ? " visible" : ""}`}
                  data-editor-tab={t.id}
                  {...(visible ? {} : { inert: true as any, "aria-hidden": true })}
                >
                  <BoardEditor tabId={t.id} path={t.path} active={visible} theme={theme} langCode={langCode} />
                </div>
              );
            })}
          {showPage && <Pages />}
        </div>
        {historyOpen && <HistoryPanel />}
      </div>
    </div>
  );
}

function ConflictBar() {
  const tab = useApp((s) => (s.page ? null : activeTab(s)));
  const status = useApp((s) => (tab ? (s.tabStatus[tab.id] ?? EMPTY_STATUS) : EMPTY_STATUS));
  if (!tab) return null;
  const session = sessions.get(tab.id);
  const name = boardName(tab.path);

  if (status.conflict) {
    return (
      <div className="banner">
        <span>
          <strong>“{name}”</strong> was changed outside Whiteboard while you had unsaved edits. Whichever you choose,
          the other version is kept in Version History.
        </span>
        <div className="banner__actions">
          <button className="btn" onClick={() => session?.reloadFromDisk()}>
            Reload from Disk
          </button>
          <button className="btn" onClick={() => session?.keepMine()}>
            Keep Whiteboard Version
          </button>
          <button className="btn" onClick={() => saveAs()}>
            Save As…
          </button>
        </div>
      </div>
    );
  }
  if (status.missing) {
    return (
      <div className="banner">
        <span>
          <strong>“{name}”</strong> was moved or deleted outside Whiteboard. Your drawing is still open here.
        </span>
        <div className="banner__actions">
          <button className="btn" onClick={() => session?.save({ force: true })}>
            Save Here Again
          </button>
          <button className="btn" onClick={() => saveAs()}>
            Save As…
          </button>
          <button className="btn" onClick={() => closeTab(tab.id)}>
            Close
          </button>
        </div>
      </div>
    );
  }
  return null;
}
