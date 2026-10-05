import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ConnectionStatus, MinimapDiagnostic, SlgoEvent } from "../../contracts";
import { initialMinimapState, minimapReducer, selectMinimap, type MinimapAction, type MinimapState, type MinimapViewModel } from "./model";
import { mapDescriptorKey, resolveMinimap } from "./resolver";
import { normalizeRadarPreferences, type RadarPreferences, type RadarControls, type RadarRenderCapabilities } from "./preferences";

const monotonicNow = () => performance.now();
export type { RadarPreferences, RadarControls, RadarRenderCapabilities } from "./preferences";

/** The reducer state plus the presentation time the radar is sampled at. */
type MinimapSnapshot = { state: MinimapState; nowMs: number };

/**
 * Minimap state lives outside React, like a `useReducer` the radar subscribes to. The radar
 * advances its clock every displayed frame; held in `App`, each frame re-rendered the whole overlay.
 */
export type MinimapStore = {
  readonly now: () => number;
  getSnapshot(): MinimapSnapshot;
  subscribe(listener: () => void): () => void;
  /** `nowMs` moves the presentation time with the action (received events and clock ticks). */
  dispatch(action: MinimapAction, nowMs?: number): void;
};

function createMinimapStore(now: () => number): MinimapStore {
  let snapshot: MinimapSnapshot = { state: initialMinimapState, nowMs: now() };
  const listeners = new Set<() => void>();
  return {
    now,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispatch(action, nowMs = snapshot.nowMs) {
      const state = minimapReducer(snapshot.state, action);
      if (state === snapshot.state && nowMs === snapshot.nowMs) return;
      snapshot = { state, nowMs };
      for (const listener of listeners) listener();
    },
  };
}

export function useMinimapFeature(options: { now?: () => number } = {}) {
  const now = options.now ?? monotonicNow;
  const store = useMemo(() => createMinimapStore(now), [now]);
  const setConnectionStatus = useCallback((status: ConnectionStatus) => store.dispatch({ type: "connection", status }), [store]);
  const receiveEvent = useCallback((event: SlgoEvent, receivedAtMs = now()) => {
    store.dispatch({ type: "event", event, receivedAtMs }, receivedAtMs);
  }, [store, now]);
  const receiveDiagnostic = useCallback((diagnostic: MinimapDiagnostic) => store.dispatch({ type: "diagnostic", diagnostic }), [store]);
  const setGameForeground = useCallback(({ focused, revision }: { focused: boolean; revision: number }) => {
    store.dispatch({ type: "focus", focused, revision });
  }, [store]);
  return { store, setConnectionStatus, receiveEvent, receiveDiagnostic, setGameForeground };
}

/** Subscribes the radar to the store and drives everything time- and option-dependent from there. */
export function useMinimapView(store: MinimapStore, options: { preferences?: Partial<RadarPreferences>; controls?: Partial<RadarControls>;
  renderCapabilities?: Partial<RadarRenderCapabilities> } = {}): MinimapViewModel {
  const { state, nowMs } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { now } = store;
  const preferences = normalizeRadarPreferences(options.preferences);
  const alternateZoomActive = options.controls?.alternateZoomActive === true;

  useEffect(() => {
    store.dispatch({ type: "radar-options", preferences, controls: { alternateZoomActive }, nowMs: now() });
    // Only actual option values update camera state; fresh option objects on a
    // render must not restart dynamic recovery or resolver work.
  }, [preferences.alwaysCentered, preferences.orientation, preferences.mapBlend, preferences.blurBackground,
    preferences.backgroundAlpha, preferences.hudScale, preferences.mapScale, preferences.alternateMapScale,
    preferences.squareWithScoreboard, preferences.forceSquare, preferences.dynamicZoom, alternateZoomActive, store, now]);

  useEffect(() => {
    if (!state.init) return;
    let current = true;
    const token = state.requestToken;
    const descriptorKey = mapDescriptorKey(state.init);
    void resolveMinimap(state.init).then((geometry) => {
      if (current) store.dispatch({ type: "resolved", token, descriptorKey, geometry, nowMs: now() });
    }).catch(() => { if (current) store.dispatch({ type: "resolve-error", token }); });
    return () => { current = false; };
  }, [state.init, state.requestToken, store, now]);

  // Only a received frame changes with time (interpolation, fades, dynamic zoom, stale expiry);
  // without one the radar is static, so the clock stops instead of re-rendering the radar.
  const clockRunning = state.frame !== null || state.pendingFrame !== null;
  useEffect(() => {
    if (!clockRunning) return undefined;
    // Sample the interpolated poses once per displayed frame at its vsync time. A fixed
    // interval beats against both the display and the position rate, so the map rotated
    // in uneven steps. The callback reads `now()`, not the frame-start timestamp, which can
    // precede an event received earlier in the same frame and step the clock backwards.
    // The clock also expires the radar while other events keep arriving.
    let frame = window.requestAnimationFrame(function step() {
      const time = now();
      store.dispatch({ type: "tick", nowMs: time }, time);
      frame = window.requestAnimationFrame(step);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [clockRunning, store, now]);

  return selectMinimap(state, nowMs, preferences, options.renderCapabilities);
}
