import type { UpdateState } from "../platform/updater.ts";

// Fixed update states for browser previews of the home window (`?update=<name>`); the Rust
// updater does not run outside Tauri.
const CURRENT = "0.7.0";
const NEXT = "0.8.0";
const CHECKED = Date.UTC(2026, 9, 19, 8);

export const UPDATE_PREVIEWS = {
  unchecked: { current: CURRENT, phase: { kind: "idle" }, required: null, lastChecked: null },
  latest: { current: CURRENT, phase: { kind: "idle" }, required: null, lastChecked: CHECKED },
  checking: { current: CURRENT, phase: { kind: "checking" }, required: null, lastChecked: null },
  downloading: {
    current: CURRENT,
    phase: { kind: "downloading", version: NEXT, received: 15_300_000, total: 34_000_000 },
    required: null,
    lastChecked: CHECKED,
  },
  ready: { current: CURRENT, phase: { kind: "ready", version: NEXT, notes: null }, required: null, lastChecked: CHECKED },
  installing: { current: CURRENT, phase: { kind: "installing", version: NEXT }, required: null, lastChecked: CHECKED },
  failed: { current: CURRENT, phase: { kind: "failed", reason: "network" }, required: null, lastChecked: CHECKED },
  required: {
    current: CURRENT,
    phase: { kind: "downloading", version: NEXT, received: 6_800_000, total: 34_000_000 },
    required: NEXT,
    lastChecked: CHECKED,
  },
  "required-ready": {
    current: CURRENT,
    phase: { kind: "ready", version: NEXT, notes: null },
    required: NEXT,
    lastChecked: CHECKED,
  },
} satisfies Record<string, UpdateState>;

export function readUpdatePreview(search: string): UpdateState | null {
  const name = new URLSearchParams(search).get("update");
  return name && Object.prototype.hasOwnProperty.call(UPDATE_PREVIEWS, name) ? UPDATE_PREVIEWS[name as keyof typeof UPDATE_PREVIEWS] : null;
}
