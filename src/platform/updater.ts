// Update state owned by Rust (src-tauri/src/updater.rs): the home window starts the checks and
// renders the state, the overlay only reads `required`. Browser previews have no updater; they
// show a fixed state (see src/mocks/updatePreview.ts) or none.
import { desktopBus, isTauri, tauriInvoke, type CommandInvoker, type DesktopBus } from "./desktop.ts";

export type UpdateFailReason = "network" | "signature" | "launch";

export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloading"; version: string; received: number; total: number | null }
  /** Downloaded and signature-verified; one click installs it. */
  | { kind: "ready"; version: string; notes: string | null }
  | { kind: "installing"; version: string }
  | { kind: "failed"; reason: UpdateFailReason };

export type UpdateState = Readonly<{
  /** The running version. */
  current: string;
  phase: UpdatePhase;
  /** The manifest's `min_version` while the running version is below it; SLUI must not connect. */
  required: string | null;
  /** Unix time in ms of the last finished check. */
  lastChecked: number | null;
}>;

/** Emitted by Rust to every window on each change. */
export const UPDATE_STATE_EVENT = "slui://update-state";

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const FAIL_REASONS: readonly unknown[] = ["network", "signature", "launch"] satisfies UpdateFailReason[];

function parsePhase(value: unknown): UpdatePhase | null {
  if (!value || typeof value !== "object") return null;
  const phase = value as Record<string, unknown>;
  switch (phase.kind) {
    case "idle":
    case "checking":
      return { kind: phase.kind };
    case "downloading":
      return isString(phase.version) && isNumber(phase.received) && (phase.total === null || isNumber(phase.total))
        ? { kind: "downloading", version: phase.version, received: phase.received, total: phase.total }
        : null;
    case "ready":
      return isString(phase.version) && (phase.notes === null || isString(phase.notes))
        ? { kind: "ready", version: phase.version, notes: phase.notes }
        : null;
    case "installing":
      return isString(phase.version) ? { kind: "installing", version: phase.version } : null;
    case "failed":
      return FAIL_REASONS.includes(phase.reason) ? { kind: "failed", reason: phase.reason as UpdateFailReason } : null;
    default:
      return null;
  }
}

export function parseUpdateState(value: unknown): UpdateState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  const phase = parsePhase(state.phase);
  if (!isString(state.current) || !phase) return null;
  if (!(state.required === null || isString(state.required))) return null;
  if (!(state.lastChecked === null || isNumber(state.lastChecked))) return null;
  return { current: state.current, phase, required: state.required, lastChecked: state.lastChecked };
}

export interface UpdateSource {
  /** Starts the check loop against `{controlPlaneUrl}/v0/update`; later calls only return the state. */
  start(controlPlaneUrl: string): Promise<UpdateState | null>;
  get(): Promise<UpdateState | null>;
  subscribe(listener: (state: UpdateState) => void): () => void;
  /** Checks now (the version tile's retry). */
  checkNow(): Promise<void>;
  /** Installs a ready update: SLUI exits and the installer takes over. */
  install(): Promise<void>;
}

/** `preview` is what a browser preview (no Rust updater) reports. */
export function createUpdateSource(
  bus: DesktopBus = desktopBus(),
  invoke: CommandInvoker | null = isTauri() ? tauriInvoke : null,
  preview: UpdateState | null = null,
): UpdateSource {
  if (!invoke) {
    return {
      start: async () => preview,
      get: async () => preview,
      subscribe: () => () => undefined,
      checkNow: async () => console.info("SLUI preview: update check"),
      install: async () => console.info("SLUI preview: update install"),
    };
  }
  return {
    start: async (controlPlaneUrl) => parseUpdateState(await invoke<unknown>("updater_start", { controlPlaneUrl })),
    get: async () => parseUpdateState(await invoke<unknown>("get_update_state")),
    subscribe(listener) {
      return bus.listen(UPDATE_STATE_EVENT, (payload) => {
        const state = parseUpdateState(payload);
        if (state) listener(state);
      });
    },
    checkNow: () => invoke<void>("updater_check_now"),
    install: () => invoke<void>("updater_install"),
  };
}
