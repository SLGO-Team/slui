export type BackendEnv = {
  DEV: boolean;
  /** Vite mode; only `mock` selects the built-in mocks. */
  MODE: string;
  VITE_CONTROL_PLANE_URL?: string;
  VITE_DEV_SIDECAR_ENDPOINT?: string;
};

export type BackendConfig =
  | { kind: "mock" }
  | { kind: "real"; controlPlaneUrl: string; sidecarEndpointOverride: string | null };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Picks the backend from build-time configuration. The mocks run only in the
 * explicit `mock` mode (`npm run dev:mock`); every other mode needs a valid
 * `VITE_CONTROL_PLANE_URL` and throws without one, so nothing ever falls back to
 * fake match data. vite.config.ts repeats the presence check before serving or
 * building.
 *
 * `VITE_DEV_SIDECAR_ENDPOINT` exists because the local dev sidecar serves plain
 * `ws://` while routes always say `wss://`. It is honoured only in development
 * builds and only for a loopback address.
 */
export function readBackendConfig(env: BackendEnv, warn: (message: string) => void = console.warn): BackendConfig {
  if (env.MODE === "mock") return { kind: "mock" };
  const raw = env.VITE_CONTROL_PLANE_URL?.trim();
  if (!raw) {
    throw new Error(`VITE_CONTROL_PLANE_URL is not set for mode "${env.MODE}". Set it in .env.${env.MODE} or the environment, or use \`npm run dev:mock\` for the mock backend.`);
  }
  const url = parseUrl(raw);
  // The session token comes back in this response, so only loopback may skip TLS.
  if (!url || !(url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)))) {
    throw new Error("VITE_CONTROL_PLANE_URL must be an https:// URL (http:// only on a loopback host)");
  }
  const overrideRaw = env.VITE_DEV_SIDECAR_ENDPOINT?.trim();
  let sidecarEndpointOverride: string | null = null;
  if (overrideRaw) {
    const override = parseUrl(overrideRaw);
    if (!env.DEV) warn("VITE_DEV_SIDECAR_ENDPOINT is ignored outside development builds");
    else if (!override || !(override.protocol === "ws:" || override.protocol === "wss:") || !LOOPBACK_HOSTS.has(override.hostname)) warn("VITE_DEV_SIDECAR_ENDPOINT must be a ws:// or wss:// loopback URL; ignored");
    else sidecarEndpointOverride = override.href;
  }
  return { kind: "real", controlPlaneUrl: url.href.replace(/\/+$/, ""), sidecarEndpointOverride };
}
