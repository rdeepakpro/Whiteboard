import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and must not clear the terminal output.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  build: { target: "safari16", chunkSizeWarningLimit: 6000 },
});
