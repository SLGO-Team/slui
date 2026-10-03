/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STEAM_ID?: string;
  readonly VITE_HUD_MODE?: "live" | "buy" | "spectator";
  readonly VITE_ENABLE_MOCK_VERIFIED_PROOF?: "true" | "false";
  /** SLGO control plane; required in every mode except `mock`. */
  readonly VITE_CONTROL_PLANE_URL?: string;
  /** Development only: loopback ws:// URL used instead of the route's sidecar endpoint. */
  readonly VITE_DEV_SIDECAR_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
