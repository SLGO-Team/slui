export type GameForegroundState = Readonly<{ focused: boolean; revision: number }>;
type GameForegroundListener = (state: GameForegroundState) => void;

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
  return Object.keys(state).length === 2
    && typeof state.focused === "boolean"
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
      listener({ focused: false, revision });

      const fail = (error: unknown) => {
        if (!active) return;
        active = false;
        unlisten?.();
        listener({ focused: false, revision: revision + 1 });
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
        listener({ focused: state.focused, revision });
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
    listener({ focused: false, revision: 0 });
    return () => {};
  }
  return nativeSource.subscribeGameForeground(listener);
}

// Explicit fixture input, independent of browser focus and native game detection.
export function createPreviewGameForegroundSource(initialFocused = false): GameForegroundSource & {
  setFocused(focused: boolean): void;
} {
  let state: GameForegroundState = { focused: initialFocused, revision: initialFocused ? 1 : 0 };
  const listeners = new Set<GameForegroundListener>();
  return {
    subscribeGameForeground(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => { listeners.delete(listener); };
    },
    setFocused(focused) {
      if (state.focused === focused) return;
      state = { focused, revision: state.revision + 1 };
      for (const listener of listeners) listener({ ...state });
    },
  };
}
