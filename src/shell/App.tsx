import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../state/store";
import { bootstrap } from "../lib/lifecycle";
import { installCommandRouting } from "../lib/commands";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { StatusBar } from "./StatusBar";
import { EditorArea } from "./EditorArea";
import { CommandPalette } from "./CommandPalette";
import { Dialogs } from "./Dialogs";
import { QuickLook } from "./QuickLook";
import { ContextMenuHost } from "./ContextMenu";
import { Toasts } from "./Toasts";
import { ActionView } from "../action/ActionView";
import { ErrorBoundary } from "./ErrorBoundary";

let started = false;

if (import.meta.env.DEV) {
  // Debug handle for development/testing only.
  void import("../editor/registry").then((r) => {
    (window as any).__wb = { sessions: r.sessions, activeSession: r.activeSession, getApp: useApp.getState };
  });
}

export function App() {
  const ready = useApp((s) => s.ready);
  const focusMode = useApp((s) => s.focusMode);
  const mode = useApp((s) => s.mode);
  const collapsed = useApp((s) => s.sidebarCollapsed);
  const palette = useApp((s) => (s.dialog?.kind === "palette" ? s.dialog : null));
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    if (started) return; // StrictMode double-invoke guard
    started = true;
    installCommandRouting()
      .then(bootstrap)
      .catch((e) => {
        console.error(e);
        setFatal(String(e));
      })
      .finally(() => void getCurrentWindow().show());
  }, []);

  if (fatal) {
    return (
      <div className="fatal">
        <div>
          <strong>Whiteboard couldn't start.</strong>
          <p>{fatal}</p>
        </div>
      </div>
    );
  }
  if (!ready) return <div className="app-loading" data-tauri-drag-region />;

  // Brainstorm stays mounted underneath Action (keeping every board's editor
  // and undo history alive) but is inert and hidden while Action is shown.
  const action = mode === "action";
  return (
    <>
      <div
        className={`app${focusMode ? " focus-mode" : ""}${collapsed ? " sidebar-collapsed" : ""}${action ? " app--hidden" : ""}`}
        {...(action ? { inert: true as any, "aria-hidden": true } : {})}
      >
        {!focusMode && !collapsed && <Sidebar />}
        <main className="main">
          {focusMode ? <div className="focus-strip" data-tauri-drag-region /> : <TabBar />}
          <ErrorBoundary label="the editor area">
            <EditorArea />
          </ErrorBoundary>
          {!focusMode && <StatusBar />}
        </main>
      </div>
      {action && (
        <ErrorBoundary label="Action">
          <ActionView />
        </ErrorBoundary>
      )}
      {palette && <CommandPalette initialQuery={palette.query} />}
      <Dialogs />
      <QuickLook />
      <ContextMenuHost />
      <Toasts />
    </>
  );
}
