import { useSyncExternalStore } from "react";

type OverlayVisibleListener = (visible: boolean) => void;

/**
 * Whether the overlay window is shown (Rust reads `IsWindowVisible` after each native show and hide). WebView2 keeps
 * the page of a hidden window visible to Chromium, whose rAF then keeps running at the display rate, so the overlay
 * pauses its per-frame work while this is false (task 10-31-perf-hidden-pause). A browser preview is always shown.
 */
export interface OverlayVisibilitySource {
  subscribeOverlayVisible(listener: OverlayVisibleListener): () => void;
}

type OverlayVisibilityBridge = {
  listen(listener: (state: unknown) => void): Promise<() => void>;
  getSnapshot(): Promise<unknown>;
};

function isOverlayVisibility(value: unknown): value is { visible: boolean; revision: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return Object.keys(state).length === 2
    && typeof state.visible === "boolean"
    && typeof state.revision === "number"
    && Number.isSafeInteger(state.revision)
    && state.revision >= 0;
}

export function createNativeOverlayVisibilitySource(bridge: OverlayVisibilityBridge): OverlayVisibilitySource {
  return {
    subscribeOverlayVisible(listener) {
      let active = true;
      // Rust starts at revision 0 (hidden); the first state received is taken whatever its revision.
      let revision = -1;
      let unlisten: (() => void) | undefined;
      // Shown until told otherwise: without the native state the overlay works as before it existed.
      listener(true);

      const fail = (error: unknown) => {
        if (!active) return;
        active = false;
        unlisten?.();
        listener(true);
        console.error("Unable to subscribe to overlay visibility", error);
      };
      const receive = (state: unknown) => {
        if (!active) return;
        if (!isOverlayVisibility(state)) {
          fail(new Error("Invalid overlay visibility"));
          return;
        }
        if (state.revision <= revision) return;
        revision = state.revision;
        listener(state.visible);
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

const nativeSource = createNativeOverlayVisibilitySource({
  async listen(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<unknown>("slgo-overlay-visibility", ({ payload }) => listener(payload));
  },
  async getSnapshot() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<unknown>("get_overlay_visibility");
  },
});

// One native subscription for the page, started by the first subscriber and kept for the page's life.
let shown = true;
let started = false;
const listeners = new Set<OverlayVisibleListener>();

function start() {
  if (started || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  started = true;
  nativeSource.subscribeOverlayVisible((visible) => {
    if (visible === shown) return;
    shown = visible;
    for (const listener of [...listeners]) listener(visible);
  });
}

/** Calls `listener` with each change of the overlay window's visibility; read the current one with `overlayShown`. */
export function subscribeOverlayVisible(listener: OverlayVisibleListener): () => void {
  listeners.add(listener);
  start();
  return () => { listeners.delete(listener); };
}

export function overlayShown(): boolean {
  return shown;
}

export function useOverlayVisible(): boolean {
  return useSyncExternalStore(subscribeOverlayVisible, overlayShown);
}
