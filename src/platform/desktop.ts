import type { ConnectionStatus } from "../contracts/index.ts";

// Cross-window messaging for the home and overlay windows. Tauri builds use
// app events; browser preview tabs use a BroadcastChannel so a home tab and an
// overlay tab can still drive each other.
export type WindowLabel = "home" | "overlay";

export interface DesktopBus {
  emit(event: string, payload: unknown, target?: WindowLabel): void;
  listen(event: string, listener: (payload: unknown) => void): () => void;
}

export type CommandInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function createTauriBus(): DesktopBus {
  return {
    emit(event, payload, target) {
      void import("@tauri-apps/api/event").then(({ emit, emitTo }) => target ? emitTo(target, event, payload) : emit(event, payload))
        .catch((error: unknown) => console.error(`Unable to emit ${event}`, error));
    },
    listen(event, listener) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      void import("@tauri-apps/api/event").then(({ listen }) => listen<unknown>(event, ({ payload }) => {
        if (!disposed) listener(payload);
      })).then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      }).catch((error: unknown) => console.error(`Unable to listen to ${event}`, error));
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
  };
}

// BroadcastChannel does not deliver to its own tab, which matches Tauri emitTo
// between two different windows closely enough for preview.
function createBrowserBus(): DesktopBus {
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("slui-desktop");
  return {
    emit(event, payload) {
      channel?.postMessage({ event, payload });
    },
    listen(event, listener) {
      const onMessage = ({ data }: MessageEvent) => {
        if (data && typeof data === "object" && data.event === event) listener(data.payload);
      };
      channel?.addEventListener("message", onMessage);
      return () => channel?.removeEventListener("message", onMessage);
    },
  };
}

let sharedBus: DesktopBus | null = null;
export function desktopBus(): DesktopBus {
  sharedBus ??= isTauri() ? createTauriBus() : createBrowserBus();
  return sharedBus;
}

export const tauriInvoke: CommandInvoker = async (command, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command, args);
};

// ---- Overlay enabled state (owned by Rust) ----

export type OverlayState = Readonly<{ enabled: boolean; interactive: boolean }>;
export const DISABLED_OVERLAY: OverlayState = { enabled: false, interactive: false };

export function parseOverlayState(value: unknown): OverlayState | null {
  if (!value || typeof value !== "object") return null;
  const { enabled, interactive } = value as Record<string, unknown>;
  return typeof enabled === "boolean" && typeof interactive === "boolean" ? { enabled, interactive } : null;
}

export interface OverlayStateSource {
  get(): Promise<OverlayState>;
  setEnabled(enabled: boolean): Promise<OverlayState>;
  subscribe(listener: (state: OverlayState) => void): () => void;
}

export function createOverlayStateSource(bus: DesktopBus = desktopBus(), invoke: CommandInvoker | null = isTauri() ? tauriInvoke : null): OverlayStateSource {
  // Browser preview has no Rust owner, so the state lives in this tab and is broadcast.
  let local: OverlayState = DISABLED_OVERLAY;
  return {
    async get() {
      if (!invoke) return local;
      return parseOverlayState(await invoke<unknown>("get_overlay_state")) ?? DISABLED_OVERLAY;
    },
    async setEnabled(enabled) {
      if (!invoke) {
        local = { enabled, interactive: false };
        bus.emit("slgo-overlay-state", local);
        return local;
      }
      const state = parseOverlayState(await invoke<unknown>("set_overlay_enabled", { enabled }));
      if (!state) throw new Error("Invalid overlay state");
      return state;
    },
    subscribe(listener) {
      return bus.listen("slgo-overlay-state", (payload) => {
        const state = parseOverlayState(payload);
        if (!state) return;
        local = state;
        listener(state);
      });
    },
  };
}

// ---- Game process ----

export interface GameProcessSource {
  get(): Promise<boolean>;
  subscribe(listener: (running: boolean) => void): () => void;
}

export function createGameProcessSource(bus: DesktopBus = desktopBus(), invoke: CommandInvoker | null = isTauri() ? tauriInvoke : null): GameProcessSource {
  return {
    async get() {
      return invoke ? (await invoke<unknown>("get_game_running")) === true : false;
    },
    subscribe(listener) {
      return bus.listen("slgo-game-running", (payload) => {
        if (typeof payload === "boolean") listener(payload);
      });
    },
  };
}

// ---- Session status bridge: the overlay owns the session, home displays it ----

const CONNECTION_STATUSES: readonly ConnectionStatus[] = ["signed-out", "discovering", "route-pending", "connecting",
  "baseline-required", "live", "stale", "ended", "offline", "not-in-game", "incompatible", "unauthorized"];

export type SessionStatusSnapshot = Readonly<{ status: ConnectionStatus; steamId: string | null; detail: string | null }>;

export function parseSessionStatus(value: unknown): SessionStatusSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const { status, steamId, detail } = value as Record<string, unknown>;
  if (!CONNECTION_STATUSES.includes(status as ConnectionStatus)) return null;
  if (steamId !== null && (typeof steamId !== "string" || !/^\d{17}$/.test(steamId))) return null;
  if (detail !== null && typeof detail !== "string") return null;
  return { status: status as ConnectionStatus, steamId, detail };
}

export interface SessionStatusPublisher {
  publish(snapshot: SessionStatusSnapshot): void;
  onRequest(listener: () => void): () => void;
  onRetry(listener: () => void): () => void;
}

export function createSessionStatusPublisher(bus: DesktopBus = desktopBus()): SessionStatusPublisher {
  return {
    publish: (snapshot) => bus.emit("slgo-session-status", snapshot, "home"),
    onRequest: (listener) => bus.listen("slgo-session-status-request", listener),
    onRetry: (listener) => bus.listen("slgo-session-retry", listener),
  };
}

export interface SessionStatusSubscriber {
  subscribe(listener: (snapshot: SessionStatusSnapshot) => void): () => void;
  requestSnapshot(): void;
  retry(): void;
}

export function createSessionStatusSubscriber(bus: DesktopBus = desktopBus()): SessionStatusSubscriber {
  return {
    subscribe(listener) {
      return bus.listen("slgo-session-status", (payload) => {
        const snapshot = parseSessionStatus(payload);
        if (snapshot) listener(snapshot);
      });
    },
    requestSnapshot: () => bus.emit("slgo-session-status-request", null, "overlay"),
    retry: () => bus.emit("slgo-session-retry", null, "overlay"),
  };
}

// ---- Window chrome: home draws its own title bar ----

export interface WindowControls {
  minimize(): void;
  /** Same as the system close: Rust turns it into hiding home to the tray. */
  close(): void;
}

export function createWindowControls(): WindowControls {
  // A browser preview has no window to drive.
  if (!isTauri()) return { minimize() {}, close() {} };
  const run = (action: "minimize" | "close") => {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow()[action]())
      .catch((error: unknown) => console.error(`[slui] window ${action} failed`, error));
  };
  return { minimize: () => run("minimize"), close: () => run("close") };
}

// ---- Window selection ----

export async function currentWindowLabel(): Promise<WindowLabel> {
  if (isTauri()) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow().label === "home" ? "home" : "overlay";
  }
  return new URLSearchParams(window.location.search).get("window") === "home" ? "home" : "overlay";
}
