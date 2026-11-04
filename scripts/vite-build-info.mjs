// slui-build.json: what the Rust side needs to know about this frontend build. It is written next to
// index.html and embedded in slui.exe with the rest of the frontend, so the updater
// (src-tauri/src/updater.rs) checks the control plane this very build's client talks to; no window
// can hand it another address at runtime.
export const BUILD_INFO_FILE = "slui-build.json";

/** The file's content; `controlPlaneUrl` is the validated VITE_CONTROL_PLANE_URL (readBackendConfig). */
export function buildInfoJson({ controlPlaneUrl }) {
  return `${JSON.stringify({ controlPlaneUrl })}\n`;
}

/**
 * @param {{ controlPlaneUrl: string | null }} options null only for the mock mode, which is never built.
 * @returns {import("vite").Plugin}
 */
export function buildInfo({ controlPlaneUrl }) {
  return {
    name: "slui-build-info",
    apply: "build",
    generateBundle() {
      if (!controlPlaneUrl) throw new Error("A build needs a control-plane URL for slui-build.json");
      this.emitFile({ type: "asset", fileName: BUILD_INFO_FILE, source: buildInfoJson({ controlPlaneUrl }) });
    },
  };
}
