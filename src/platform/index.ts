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
import { DEFAULT_HOTKEYS, hotkeyVirtualKey, isBindableHotkey, type HotkeyCode } from "./hotkeys";

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

// Interaction is never a user toggle: the overlay derives it from which UI is open.
export type OverlayWindowController = {
  setInteractive(interactive: boolean): Promise<void>;
  /** Makes the interactive overlay the foreground window so it receives typing; false hands the keyboard back. */
  setKeyboardFocus(focused: boolean): Promise<void>;
  /** Overlay diagnostics; the desktop app prints them to its stderr (the `tauri dev` terminal). */
  log(message: string): void;
  setShopHotkey(code: HotkeyCode): Promise<void>;
  subscribeShortcut(listener: OverlayShortcutListener): () => void;
};

export function createOverlayWindowController(): OverlayWindowController {
  const isTauri = "__TAURI_INTERNALS__" in window;
  // Browser preview matches keys itself; Tauri matches them in the Rust keyboard hook.
  let shopHotkey: HotkeyCode = DEFAULT_HOTKEYS.shop;
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
    async setShopHotkey(code) {
      const virtualKey = hotkeyVirtualKey(code);
      if (!isBindableHotkey(code) || virtualKey === null) throw new Error(`Unsupported hotkey ${code}`);
      shopHotkey = code;
      if (!isTauri) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_shop_hotkey", { virtualKey });
    },
    subscribeShortcut(listener) {
      let active = true;
      const onKeyDown = (event: KeyboardEvent) => {
        if (!active || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
        const shortcut = event.code === shopHotkey ? "shop" : CHAT_KEYS[event.code];
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
