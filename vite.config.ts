import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readBackendConfig } from "./src/platform/backend.ts";
import { contentSecurityPolicy } from "./scripts/vite-csp.mjs";
import { themePackDevServer } from "./scripts/vite-theme-pack.mjs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Fails before serving or building instead of shipping a client that shows fake
// match data, a blank page or a policy that blocks its own control plane. The
// same readBackendConfig (src/platform/backend.ts) runs again in the client:
// only the `mock` mode runs the mocks, they are never packaged, and every other
// mode needs a valid control-plane URL. Returns that URL, or null for mocks.
function controlPlaneUrl(command: "build" | "serve", mode: string): string | null {
  if (mode === "mock" && command === "build") {
    throw new Error("The mock backend cannot be built into a package; use `npm run build:local` for a local test build.");
  }
  // @ts-expect-error process is a nodejs global
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // Only the address: the dev sidecar override is checked (and reported) by the client.
  const backend = readBackendConfig({ DEV: false, MODE: mode, VITE_CONTROL_PLANE_URL: env.VITE_CONTROL_PLANE_URL });
  return backend.kind === "real" ? backend.controlPlaneUrl : null;
}

// https://vite.dev/config/
export default defineConfig(async ({ command, mode }) => {
  const plugins = [react(), themePackDevServer(), contentSecurityPolicy({ controlPlaneUrl: controlPlaneUrl(command, mode) })];
  return {
  plugins,

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
