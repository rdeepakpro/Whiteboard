import { activeTab, EMPTY_STATUS, useApp } from "../state/store";
import { useLiveStats } from "../lib/liveStats";
import { boardName, prettyLocation } from "../lib/paths";
import { activeSession } from "../editor/registry";
import { reveal } from "../lib/boards";
import { Icon } from "./icons";

export function StatusBar() {
  const tab = useApp((s) => (s.page ? null : activeTab(s)));
  const root = useApp((s) => s.prefs.libraryRoot);
  const status = useApp((s) => (tab ? (s.tabStatus[tab.id] ?? EMPTY_STATUS) : EMPTY_STATUS));
  const stats = useLiveStats();

  if (!tab) return <footer className="statusbar" />;

  const location = prettyLocation(tab.path, root);
  let save: React.ReactNode;
  if (status.loadError) save = <span className="status-err">Couldn't open</span>;
  else if (status.conflict) save = <span className="status-err">Changed on disk</span>;
  else if (status.missing) save = <span className="status-err">File missing</span>;
  else if (status.error)
    save = (
      <button
        className="status-err linkish"
        title={status.error}
        onClick={() => void activeSession()?.save({ manual: true })}
      >
        Save failed — retry
      </button>
    );
  else if (status.saving || status.dirty) save = <span>Saving…</span>;
  else
    save = (
      <span className="status-ok">
        Saved locally <span className="status-check">{Icon.check}</span>
      </span>
    );

  return (
    <footer className="statusbar">
      <button
        className="statusbar__path linkish"
        title={`Show “${tab.path}” in Finder`}
        onClick={() => reveal(tab.path)}
      >
        {location} / <strong>{boardName(tab.path)}</strong>
      </button>
      <div className="statusbar__right">
        {!status.loadError && (
          <>
            <span>
              {stats.elements} element{stats.elements === 1 ? "" : "s"}
            </span>
            <span className="sep">·</span>
            <span>{Math.round(stats.zoom * 100)}%</span>
            <span className="sep">·</span>
          </>
        )}
        {save}
      </div>
    </footer>
  );
}
