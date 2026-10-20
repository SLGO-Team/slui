import {
  canUsePlayerScopedFeatures,
  type ChatMessage,
  type ConnectionFailure,
  type ConnectionStatus,
  type MinimapDiagnostic,
  type ParseResult,
  type ServerRoute,
  type SlgoCommand,
  type SlgoEvent,
  type SteamIdentity,
  type SteamIdentityProof,
} from "../contracts";
import { DEFAULT_HOTKEYS, hotkeyVirtualKey, normalizeHotkeys, type HotkeySettings } from "./hotkeys";

export interface SteamClientIdentity {
  getCurrentUser(): Promise<SteamIdentity | null>;
}

export interface IdentityProofProvider {
  getProof(identity: SteamIdentity): Promise<SteamIdentityProof | null>;
  isVerified(proof: SteamIdentityProof | null): boolean;
}

export interface SlgoControlPlane {
  /** Resolves or rejects a route; throws only when the control plane cannot be reached. */
  resolveActiveServer(identity: SteamIdentity, proof: SteamIdentityProof): Promise<ParseResult<ServerRoute>>;
}

export interface SlgoConnection {
  connect(route: ServerRoute, identity: SteamIdentity): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(listener: (event: SlgoEvent) => void): () => void;
  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void;
  subscribeDiagnostic(listener: (diagnostic: MinimapDiagnostic) => void): () => void;
  /** A session that had connected ended without `disconnect()`; status listeners have already been told. */
  subscribeFailure(listener: (failure: ConnectionFailure) => void): () => void;
  send(command: SlgoCommand): Promise<void>;
  /**
   * Features this client takes over from the plugin (`client.features`). The
   * connection keeps the latest list and reports it whenever a stream goes live.
   */
  setFeatures(features: readonly string[]): void;
  getStatus(): ConnectionStatus;
}

// Y opens global chat and U team chat, as in CS2.
export type OverlayShortcut = "chat-global" | "chat-team" | "shop";
const OVERLAY_SHORTCUTS: readonly string[] = ["chat-global", "chat-team", "shop"] satisfies readonly OverlayShortcut[];
const CHAT_KEYS: Readonly<Record<string, OverlayShortcut>> = { KeyY: "chat-global", KeyU: "chat-team" };

/**
 * `gameForeground` is whether the game had the foreground at the key press, read by
 * the Rust hook at that moment; false for a key the overlay's own focused window
 * received; null in the browser preview, which has no game.
 */
export type OverlayShortcutListener = (shortcut: OverlayShortcut, gameForeground: boolean | null) => void;

function parseShortcutEvent(payload: unknown): { shortcut: OverlayShortcut; gameForeground: boolean } | null {
  if (!payload || typeof payload !== "object") return null;
  const { shortcut, game_foreground: gameForeground } = payload as Record<string, unknown>;
  if (typeof shortcut !== "string" || !OVERLAY_SHORTCUTS.includes(shortcut) || typeof gameForeground !== "boolean") return null;
  return { shortcut: shortcut as OverlayShortcut, gameForeground };
}

/**
 * Scoreboard key events: `held` true when the scoreboard key went down over the game (or
 * over the page in the browser preview), false when it went up anywhere. Releases may
 * arrive twice (page and hook); `cursor` is a right-click the passive scoreboard took.
 */
export type ScoreboardInputListener = {
  held(held: boolean): void;
  cursor(): void;
};

// Interaction is never a user toggle: the overlay derives it from which UI is open.
export type OverlayWindowController = {
  setInteractive(interactive: boolean): Promise<void>;
  /** Makes the interactive overlay the foreground window so it receives typing; false hands the keyboard back. */
  setKeyboardFocus(focused: boolean): Promise<void>;
  /** Overlay diagnostics; the desktop app prints them to its stderr (the `tauri dev` terminal). */
  log(message: string): void;
  /** Applies the shop and scoreboard keys (normalized; Rust rejects an invalid pair). */
  setHotkeys(hotkeys: HotkeySettings): Promise<void>;
  subscribeShortcut(listener: OverlayShortcutListener): () => void;
  /** While true and the game holds the foreground, right-click goes to the scoreboard instead of the game. */
  setScoreboardCapture(capture: boolean): Promise<void>;
  subscribeScoreboard(listener: ScoreboardInputListener): () => void;
};

async function listenTauri(event: string, handler: (payload: unknown) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<unknown>(event, ({ payload }) => handler(payload));
}

export function createOverlayWindowController(): OverlayWindowController {
  const isTauri = "__TAURI_INTERNALS__" in window;
  // Browser preview matches keys itself; Tauri matches them in the Rust keyboard hook.
  let hotkeys: HotkeySettings = DEFAULT_HOTKEYS;
  // Mirrors the Rust capture flag so the browser preview's right-click plays the hook's part.
  let scoreboardCapture = false;
  return {
    async setInteractive(interactive) {
      if (!isTauri) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_overlay_interactive", { interactive });
    },
    async setKeyboardFocus(focused) {
      if (!isTauri) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_overlay_keyboard_focus", { focused });
    },
    log(message) {
      if (!isTauri) {
        console.info(`SLGO overlay: ${message}`);
        return;
      }
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("log_overlay_event", { message }))
        .catch((error: unknown) => console.error("Unable to log overlay event", message, error));
    },
    async setHotkeys(next) {
      const normalized = normalizeHotkeys(next);
      const shop = hotkeyVirtualKey(normalized.shop);
      const scoreboard = hotkeyVirtualKey(normalized.scoreboard);
      if (shop === null || scoreboard === null) throw new Error(`Unsupported hotkeys ${normalized.shop} / ${normalized.scoreboard}`);
      hotkeys = normalized;
      if (!isTauri) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_hotkeys", { shop, scoreboard });
    },
    async setScoreboardCapture(capture) {
      scoreboardCapture = capture;
      if (!isTauri) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_scoreboard_capture", { capture });
    },
    subscribeScoreboard(listener) {
      let active = true;
      const cleanups: (() => void)[] = [];
      // The browser preview has no hook: the page's own key events stand in, and right-click
      // on the page plays the captured right-click. In the app the hook reports both; the
      // page adds the key-up while the overlay holds the foreground (cursor mode), where an
      // IME can keep keys from the hook.
      const onKeyDown = (event: KeyboardEvent) => {
        if (active && !isTauri && !event.repeat && event.code === hotkeys.scoreboard) listener.held(true);
      };
      const onKeyUp = (event: KeyboardEvent) => {
        if (active && event.code === hotkeys.scoreboard) listener.held(false);
      };
      const onContextMenu = (event: MouseEvent) => {
        if (!active || isTauri || !scoreboardCapture) return;
        event.preventDefault();
        listener.cursor();
      };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("contextmenu", onContextMenu);
      cleanups.push(
        () => window.removeEventListener("keydown", onKeyDown),
        () => window.removeEventListener("keyup", onKeyUp),
        () => window.removeEventListener("contextmenu", onContextMenu),
      );
      if (isTauri) {
        const subscriptions = [
          listenTauri("slgo-scoreboard-key", (payload) => {
            const held = (payload as { held?: unknown } | null)?.held;
            if (!active) return;
            if (typeof held === "boolean") listener.held(held);
            else console.error("Invalid scoreboard key event", payload);
          }),
          listenTauri("slgo-scoreboard-cursor", () => {
            if (active) listener.cursor();
          }),
        ];
        for (const subscription of subscriptions) {
          void subscription.then((cleanup) => {
            if (active) cleanups.push(cleanup);
            else cleanup();
          }).catch((error: unknown) => console.error("Unable to subscribe to scoreboard input", error));
        }
      }
      return () => {
        active = false;
        for (const cleanup of cleanups.splice(0)) cleanup();
      };
    },
    subscribeShortcut(listener) {
      let active = true;
      const onKeyDown = (event: KeyboardEvent) => {
        if (!active || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
        const shortcut = event.code === hotkeys.shop ? "shop" : CHAT_KEYS[event.code];
        if (!shortcut) return;
        event.preventDefault();
        // While the overlay holds the foreground (the open shop), keys reach this page
        // but not reliably the Rust hook: an IME such as Sogou in Chinese mode consumes
        // them before the low-level hook chain. So the page reports them itself; the
        // hook may report the same press too, which the handler must tolerate.
        listener(shortcut, isTauri ? false : null);
      };
      window.addEventListener("keydown", onKeyDown);
      let unlisten: (() => void) | undefined;
      let disposed = false;
      if (isTauri) {
        void import("@tauri-apps/api/event").then(({ listen }) => listen<unknown>("slgo-shortcut", ({ payload }) => {
          if (!active) return;
          const event = parseShortcutEvent(payload);
          if (event) listener(event.shortcut, event.gameForeground);
          else console.error("Invalid overlay shortcut event", payload);
        })).then((cleanup) => {
          if (disposed) cleanup();
          else unlisten = cleanup;
        }).catch((error: unknown) => {
          console.error("Unable to subscribe to overlay shortcuts", error);
        });
      }
      return () => {
        active = false;
        disposed = true;
        window.removeEventListener("keydown", onKeyDown);
        unlisten?.();
      };
    },
  };
}

export { canUsePlayerScopedFeatures, ChatMessage };
export type { MinimapDiagnostic };
