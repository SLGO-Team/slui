import { useCallback, useEffect, useReducer, useState } from "react";
import type { ConnectionStatus, MinimapDiagnostic, SlgoEvent } from "../../contracts";
import { initialMinimapState, minimapReducer, selectMinimap } from "./model";
import { mapDescriptorKey, resolveMinimap } from "./resolver";
import { normalizeRadarPreferences, type RadarPreferences, type RadarControls, type RadarRenderCapabilities } from "./preferences";

const monotonicNow = () => performance.now();
export type { RadarPreferences, RadarControls, RadarRenderCapabilities } from "./preferences";

export function useMinimapFeature(options: { preferences?: Partial<RadarPreferences>; controls?: Partial<RadarControls>;
  renderCapabilities?: Partial<RadarRenderCapabilities>; now?: () => number } = {}) {
  const now = options.now ?? monotonicNow;
  const [state, dispatch] = useReducer(minimapReducer, initialMinimapState);
  const [nowMs, setNowMs] = useState(now);
  const preferences = normalizeRadarPreferences(options.preferences);
  const alternateZoomActive = options.controls?.alternateZoomActive === true;
  const setConnectionStatus = useCallback((status: ConnectionStatus) => dispatch({ type: "connection", status }), []);
  const receiveEvent = useCallback((event: SlgoEvent, receivedAtMs = now()) => {
    dispatch({ type: "event", event, receivedAtMs });
    setNowMs(receivedAtMs);
  }, [now]);
  const receiveDiagnostic = useCallback((diagnostic: MinimapDiagnostic) => dispatch({ type: "diagnostic", diagnostic }), []);
  const setGameForeground = useCallback(({ focused, revision }: { focused: boolean; revision: number }) => {
    dispatch({ type: "focus", focused, revision });
  }, []);
  const tick = useCallback((time = now()) => {
    dispatch({ type: "tick", nowMs: time });
    setNowMs(time);
  }, [now]);

  useEffect(() => {
    dispatch({ type: "radar-options", preferences, controls: { alternateZoomActive }, nowMs: now() });
    // Only actual option values update camera state; fresh option objects on a
    // render must not restart dynamic recovery or resolver work.
  }, [preferences.alwaysCentered, preferences.orientation, preferences.mapBlend, preferences.blurBackground,
    preferences.backgroundAlpha, preferences.hudScale, preferences.mapScale, preferences.alternateMapScale,
    preferences.squareWithScoreboard, preferences.forceSquare, preferences.dynamicZoom, alternateZoomActive, now]);

  useEffect(() => {
    if (!state.init) return;
    let current = true;
    const token = state.requestToken;
    const descriptorKey = mapDescriptorKey(state.init);
    void resolveMinimap(state.init).then((geometry) => {
      if (current) dispatch({ type: "resolved", token, descriptorKey, geometry, nowMs: now() });
    }).catch(() => { if (current) dispatch({ type: "resolve-error", token }); });
    return () => { current = false; };
  }, [state.init, state.requestToken, now]);

  // Only a received frame changes with time (interpolation, fades, dynamic zoom, stale expiry);
  // without one the radar is static, so the clock stops instead of re-rendering the overlay.
  const clockRunning = state.frame !== null || state.pendingFrame !== null;
  useEffect(() => {
    if (!clockRunning) return undefined;
    // A local clock also expires the radar when the rest of the overlay keeps receiving events.
    const timer = window.setInterval(() => tick(), 32);
    return () => window.clearInterval(timer);
  }, [clockRunning, tick]);

  return { state, view: selectMinimap(state, nowMs, preferences, options.renderCapabilities),
    setConnectionStatus, receiveEvent, receiveDiagnostic, setGameForeground, tick };
}
