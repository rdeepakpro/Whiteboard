// Brainstorm | Action — the top-level switch between thinking and doing.
import { useApp, setApp } from "../state/store";
import { useCheckInDue } from "../action/ActionView";
import { focusEditor } from "../editor/registry";

export function setMode(mode: "brainstorm" | "action") {
  setApp({ mode, dialog: null, quickLook: null, focusMode: false });
  if (mode === "brainstorm") {
    const s = useApp.getState();
    if (s.activeTabId) window.setTimeout(() => focusEditor(s.activeTabId!), 30);
  }
}

export function ModeSwitch() {
  const mode = useApp((s) => s.mode);
  const due = useCheckInDue();
  return (
    <div className="mode-switch" role="tablist" aria-label="Brainstorm or Action">
      <button role="tab" aria-selected={mode === "brainstorm"} className={mode === "brainstorm" ? "active" : ""} onClick={() => setMode("brainstorm")} title="Brainstorm (⇧⌘A to switch)">
        Brainstorm
      </button>
      <button role="tab" aria-selected={mode === "action"} className={mode === "action" ? "active" : ""} onClick={() => setMode("action")} title="Action (⇧⌘A to switch)">
        Action
        {due && mode !== "action" && <span className="mode-switch__dot" title="Daily check-in" />}
      </button>
    </div>
  );
}
