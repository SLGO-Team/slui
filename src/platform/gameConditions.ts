/**
 * Conditions under which SLUI cannot take input over the game (Rust `game_conditions.rs`): the game runs elevated
 * and SLUI does not (`elevatedGame`), or the game runs in exclusive fullscreen and minimizes on any foreground loss
 * (`exclusiveFullscreen`). Both are false while unknown or without a game.
 */
export type GameConditions = Readonly<{ elevatedGame: boolean; exclusiveFullscreen: boolean; revision: number }>;
type GameConditionsListener = (conditions: GameConditions) => void;

export const NO_GAME_CONDITIONS: GameConditions = { elevatedGame: false, exclusiveFullscreen: false, revision: 0 };

/** While a condition holds the overlay hands its input-taking features back to the plugin's in-game UI. */
export function inputBlockedBy(conditions: Pick<GameConditions, "elevatedGame" | "exclusiveFullscreen">): boolean {
  return conditions.elevatedGame || conditions.exclusiveFullscreen;
}

export interface GameConditionsSource {
  subscribeGameConditions(listener: GameConditionsListener): () => void;
}

type GameConditionsBridge = {
  listen(listener: (conditions: unknown) => void): Promise<() => void>;
  getSnapshot(): Promise<unknown>;
};

function isGameConditions(value: unknown): value is GameConditions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const conditions = value as Record<string, unknown>;
  return Object.keys(conditions).length === 3
    && typeof conditions.elevatedGame === "boolean"
    && typeof conditions.exclusiveFullscreen === "boolean"
    && typeof conditions.revision === "number"
    && Number.isSafeInteger(conditions.revision)
    && conditions.revision >= 0;
}

export function createNativeGameConditionsSource(bridge: GameConditionsBridge): GameConditionsSource {
  return {
    subscribeGameConditions(listener) {
      let active = true;
      let revision = 0;
      let unlisten: (() => void) | undefined;
      listener(NO_GAME_CONDITIONS);

      // Without the native state SLUI keeps its panels, as before this state existed.
      const fail = (error: unknown) => {
        if (!active) return;
        active = false;
        unlisten?.();
        listener({ ...NO_GAME_CONDITIONS, revision: revision + 1 });
        console.error("Unable to subscribe to game conditions", error);
      };
      const receive = (conditions: unknown) => {
        if (!active) return;
        if (!isGameConditions(conditions)) {
          fail(new Error("Invalid game conditions"));
          return;
        }
        if (conditions.revision <= revision) return;
        revision = conditions.revision;
        listener({ elevatedGame: conditions.elevatedGame, exclusiveFullscreen: conditions.exclusiveFullscreen, revision });
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

const nativeSource = createNativeGameConditionsSource({
  async listen(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<unknown>("slgo-game-conditions", ({ payload }) => listener(payload));
  },
  async getSnapshot() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<unknown>("get_game_conditions");
  },
});

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Browser previews have no game: no condition ever holds. */
export function subscribeGameConditions(listener: GameConditionsListener): () => void {
  if (!inTauri()) {
    listener(NO_GAME_CONDITIONS);
    return () => {};
  }
  return nativeSource.subscribeGameConditions(listener);
}

/** `cancelled`: the player declined the UAC prompt. On success SLUI exits, so the promise may never settle. */
export type RelaunchOutcome = "started" | "cancelled";

/** Starts SLUI again as administrator (Rust `relaunch_elevated`); rejects with the reason when Windows refused. */
export async function relaunchElevated(invoke: ((command: string) => Promise<unknown>) | null = inTauri()
  ? async (command) => (await import("@tauri-apps/api/core")).invoke(command)
  : null): Promise<RelaunchOutcome> {
  if (!invoke) throw new Error("仅桌面版可用");
  try {
    await invoke("relaunch_elevated");
    return "started";
  } catch (error) {
    if (error === "cancelled") return "cancelled";
    throw error instanceof Error ? error : new Error(String(error));
  }
}
