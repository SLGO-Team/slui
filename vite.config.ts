import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { themePackDevServer } from "./scripts/vite-theme-pack.mjs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Fails before serving or building instead of shipping a client that shows fake
// match data or a blank page. Mirrors readBackendConfig (src/platform/backend.ts),
// which also validates the URL at startup: only the `mock` mode runs the mocks,
// they are never packaged, and every other mode needs a control-plane URL.
function checkBackend(command: "build" | "serve", mode: string) {
  if (mode === "mock") {
    if (command === "build") throw new Error("The mock backend cannot be built into a package; use `npm run build:local` for a local test build.");
    return;
  }
  // @ts-expect-error process is a nodejs global
  if (!loadEnv(mode, process.cwd(), "VITE_").VITE_CONTROL_PLANE_URL?.trim()) {
    throw new Error(`VITE_CONTROL_PLANE_URL is not set for mode "${mode}". Set it in .env.${mode} or the environment, or use \`npm run dev:mock\` for the mock backend.`);
  }
}

// https://vite.dev/config/
export default defineConfig(async ({ command, mode }) => {
  checkBackend(command, mode);
  return {
  plugins: [react(), themePackDevServer()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  };
});
