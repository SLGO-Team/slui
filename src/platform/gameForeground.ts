/**
 * `focused`: the game holds the foreground. `overGame`: the overlay is over the game, i.e. the game or the overlay
 * itself holds the foreground (the native overlay visibility rule, from the same sample), so a panel that takes the
 * foreground from the game stays drawn.
 */
export type GameForegroundState = Readonly<{ focused: boolean; overGame: boolean; revision: number }>;
type GameForegroundListener = (state: GameForegroundState) => void;

/** The overlay itself holds the foreground: it is over the game and the game does not hold it. */
export function overlayHoldsForeground(state: Pick<GameForegroundState, "focused" | "overGame">): boolean {
  return state.overGame && !state.focused;
}

/**
 * A panel that takes the foreground (shop, chat) and the native foreground state: `held` whether the overlay has held
 * the foreground since the panel opened, `lost` whether it has now gone to the game (`toGame`) or another window. A
 * focus bounce inside the overlay window (another application's overlay showing its own window) changes neither.
 */
export function foregroundLoss(
  heldSinceOpen: boolean,
  state: Pick<GameForegroundState, "focused" | "overGame">,
): Readonly<{ held: boolean; lost: boolean; toGame: boolean }> {
  const holds = overlayHoldsForeground(state);
  return { held: heldSinceOpen || holds, lost: heldSinceOpen && !holds, toGame: state.focused };
}

export interface GameForegroundSource {
  subscribeGameForeground(listener: GameForegroundListener): () => void;
}

type GameForegroundBridge = {
  listen(listener: (state: unknown) => void): Promise<() => void>;
  getSnapshot(): Promise<unknown>;
};

function isGameForegroundState(value: unknown): value is GameForegroundState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return Object.keys(state).length === 3
    && typeof state.focused === "boolean"
    && typeof state.overGame === "boolean"
    && typeof state.revision === "number"
    && Number.isSafeInteger(state.revision)
    && state.revision >= 0;
}

export function createNativeGameForegroundSource(bridge: GameForegroundBridge): GameForegroundSource {
  return {
    subscribeGameForeground(listener) {
      let active = true;
      let revision = 0;
      let unlisten: (() => void) | undefined;
      listener({ focused: false, overGame: false, revision });

      const fail = (error: unknown) => {
        if (!active) return;
        active = false;
        unlisten?.();
        listener({ focused: false, overGame: false, revision: revision + 1 });
        console.error("Unable to subscribe to game foreground state", error);
      };
      const receive = (state: unknown) => {
        if (!active) return;
        if (!isGameForegroundState(state)) {
          fail(new Error("Invalid game foreground state"));
          return;
        }
        if (state.revision <= revision) return;
        revision = state.revision;
        listener({ focused: state.focused, overGame: state.overGame, revision });
      };

      // Register first, then query; a late snapshot cannot overwrite a newer event.
      void bridge.listen(receive).then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        receive(await bridge.getSnapshot());
      }).catch(fail);

      return () => {
        if (!active) return;
        active = false;
        unlisten?.();
      };
    },
  };
}

const nativeSource = createNativeGameForegroundSource({
  async listen(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<unknown>("slgo-game-foreground", ({ payload }) => listener(payload));
  },
  async getSnapshot() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<unknown>("get_game_foreground");
  },
});

export function subscribeGameForeground(listener: GameForegroundListener): () => void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    listener({ focused: false, overGame: false, revision: 0 });
    return () => {};
  }
  return nativeSource.subscribeGameForeground(listener);
}

// Explicit fixture input, independent of browser focus and native game detection; a preview has no overlay window, so
// the overlay is over the game exactly while the game is focused.
export function createPreviewGameForegroundSource(initialFocused = false): GameForegroundSource & {
  setFocused(focused: boolean): void;
} {
  let state: GameForegroundState = { focused: initialFocused, overGame: initialFocused, revision: initialFocused ? 1 : 0 };
  const listeners = new Set<GameForegroundListener>();
  return {
    subscribeGameForeground(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => { listeners.delete(listener); };
    },
    setFocused(focused) {
      if (state.focused === focused) return;
      state = { focused, overGame: focused, revision: state.revision + 1 };
      for (const listener of listeners) listener({ ...state });
    },
  };
}
