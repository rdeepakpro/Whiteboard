// Copies the official Excalidraw font files from the installed package into
// public/fonts so they are served locally (fully offline) and bundled into the app.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const dest = join(root, "public/fonts");

if (!existsSync(src)) {
  console.error("Excalidraw fonts not found. Run npm install first.");
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("Copied Excalidraw fonts to public/fonts");
