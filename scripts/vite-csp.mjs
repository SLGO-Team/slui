// The webview's Content Security Policy, written into index.html as the first <head> element.
//
// It is a <meta> rather than Tauri's `app.security.csp` because connect-src must name the control
// plane, whose address is the build input VITE_CONTROL_PLANE_URL: the same value the client fetches,
// so every way of building SLUI (build-installer, tauri:build:local, deploy scripts that run
// `tauri build` themselves) gets a policy that matches it with nothing extra to pass. Tauri's `csp`
// stays null: a header policy would apply on top of this one and block the control plane.
import { createHash } from "node:crypto";

// WebView2 serves custom schemes as http://<scheme>.localhost; other webviews use <scheme>:.
// `theme` is src-tauri/src/theme_pack.rs; `ipc` is Tauri's IPC transport.
const THEME = ["theme:", "http://theme.localhost"];
const IPC = ["ipc:", "http://ipc.localhost"];

/**
 * @param {{ dev: boolean, controlPlaneOrigin: string | null, scriptHashes?: string[], styleHashes?: string[] }} options
 *   `dev` is the Vite dev server (`npm run dev`, `dev:mock`, `tauri dev`), not a development-mode build.
 * @returns {string}
 */
export function buildContentSecurityPolicy({ dev, controlPlaneOrigin, scriptHashes = [], styleHashes = [] }) {
  const directives = {
    "default-src": ["'none'"],
    "script-src": ["'self'", ...scriptHashes],
    // The dev server injects each CSS module as a <style> element.
    "style-src": ["'self'", ...(dev ? ["'unsafe-inline'"] : styleHashes)],
    // data: = inlined SVGs, washed radar artwork and the Steam avatar Rust reads; https: = server avatars and icons.
    "img-src": ["'self'", "data:", "https:"],
    "font-src": ["'self'", ...THEME],
    "media-src": ["'self'", ...THEME],
    // The sidecar socket runs in Rust under Tauri. A browser preview opens it itself, and the dev
    // server's HMR needs a socket too.
    "connect-src": ["'self'", ...IPC, ...(controlPlaneOrigin ? [controlPlaneOrigin] : []), ...(dev ? ["ws:", "wss:"] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
    "frame-src": ["'none'"],
    "worker-src": ["'none'"],
  };
  return Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

const sha256 = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

/** Hashes of the inline <script> (no src) and <style> elements in `html`. */
export function inlineHashes(html) {
  const scriptHashes = [];
  const styleHashes = [];
  for (const [, tag, attributes, body] of html.matchAll(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    if (tag.toLowerCase() === "style") styleHashes.push(sha256(body));
    else if (!/\bsrc\s*=/i.test(attributes)) scriptHashes.push(sha256(body));
  }
  return { scriptHashes, styleHashes };
}

/** Puts the policy at the top of <head> (after <meta charset> when that comes first), ahead of every script and style. */
export function injectContentSecurityPolicy(html, policy) {
  const head = /<head\b[^>]*>/i.exec(html);
  if (!head) throw new Error("index.html has no <head> for the Content Security Policy");
  const meta = `\n    <meta http-equiv="Content-Security-Policy" content="${policy.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")}" />`;
  const charset = /^\s*<meta\s+charset\b[^>]*>/i.exec(html.slice(head.index + head[0].length));
  const at = head.index + head[0].length + (charset ? charset[0].length : 0);
  return html.slice(0, at) + meta + html.slice(at);
}

/**
 * @param {{ controlPlaneUrl: string | null }} options the validated control-plane URL (readBackendConfig), null for mocks.
 * @returns {import("vite").Plugin}
 */
export function contentSecurityPolicy({ controlPlaneUrl }) {
  const controlPlaneOrigin = controlPlaneUrl ? new URL(controlPlaneUrl).origin : null;
  let dev = false;
  return {
    name: "slui-content-security-policy",
    configResolved(config) {
      dev = config.command === "serve";
    },
    transformIndexHtml: {
      // After every other plugin, so the inline scripts they inject (the React refresh preamble on the
      // dev server) are hashed.
      order: "post",
      handler(html) {
        const policy = buildContentSecurityPolicy({ dev, controlPlaneOrigin, ...inlineHashes(html) });
        return injectContentSecurityPolicy(html, policy);
      },
    },
  };
}
