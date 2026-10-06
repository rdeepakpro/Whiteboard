// Must run before Excalidraw is imported: installs native file pickers and
// the local font asset path.
import "./platform/nativeFilePickers";
import "@excalidraw/excalidraw/index.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./shell/App";

async function start() {
  // Dev only: run the UI in a plain browser against an in-memory backend.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    await import("./dev/mockBackend");
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
