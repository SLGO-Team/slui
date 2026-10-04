import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ConnectionStatus, MinimapDiagnostic, SlgoEvent } from "../contracts";
import type { ClientSessionDependencies } from "./clientSession";
import { clientSessionReducer, initialClientSessionState, nextFailureCount, retryDelayMs, runClientSessionAttempt } from "./clientSession";

const IDENTITY_POLL_INTERVAL_MS = 3_000;

export function useClientSession(
  dependencies: ClientSessionDependencies,
  onEvent: (event: SlgoEvent) => void,
  onDiagnostic?: (diagnostic: MinimapDiagnostic) => void,
  onStatus?: (status: ConnectionStatus) => void,
) {
  const [state, dispatch] = useReducer(clientSessionReducer, initialClientSessionState);
  const [retryKey, requestRetry] = useReducer((value: number) => value + 1, 0);
  const stateRef = useRef(state);
  const eventHandlerRef = useRef(onEvent);
  const diagnosticHandlerRef = useRef(onDiagnostic);
  const statusHandlerRef = useRef(onStatus);
  const failuresRef = useRef(0);
  const liveSinceRef = useRef<number | null>(null);
  // Set only by the retry timer; a manual retry or an account switch shows its progress.
  const backgroundRetryRef = useRef(false);
  stateRef.current = state;
  eventHandlerRef.current = onEvent;
  diagnosticHandlerRef.current = onDiagnostic;
  statusHandlerRef.current = onStatus;

  const retryNow = useCallback(() => {
    backgroundRetryRef.current = false;
    requestRetry();
  }, []);

  useEffect(() => {
    const attempt = retryKey + 1;
    const quiet = backgroundRetryRef.current;
    let current = true;
    let unsubscribe: () => void = () => undefined;

    void runClientSessionAttempt(dependencies, attempt, {
      dispatch,
      onEvent: (event) => eventHandlerRef.current(event),
      onDiagnostic: (diagnostic) => diagnosticHandlerRef.current?.(diagnostic),
      onStatus: (status) => statusHandlerRef.current?.(status),
      isCurrent: () => current,
    }, quiet).then((cleanup) => {
      if (current) unsubscribe = cleanup;
      else cleanup();
    });

    return () => {
      current = false;
      unsubscribe();
      void dependencies.connection.disconnect();
    };
  }, [dependencies, retryKey]);

  useEffect(() => {
    let active = true;
    const timer = window.setInterval(() => {
      void dependencies.identity.getCurrentUser().then((identity) => {
        if (!active) return;
        const previousSteamId = stateRef.current.identity?.steamId ?? null;
        const nextSteamId = identity?.steamId ?? null;
        if (previousSteamId !== nextSteamId) retryNow();
      }).catch(() => {
        if (active && stateRef.current.status !== "offline") retryNow();
      });
    }, IDENTITY_POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [dependencies.identity]);

  // A failure that clears up by itself (not in game, rate limit, lost or
  // restarted sidecar) schedules the next attempt; a new attempt cancels it.
  useEffect(() => {
    if (state.status === "live") {
      liveSinceRef.current ??= Date.now();
      return undefined;
    }
    if (!state.retry || state.retry === "none") return undefined;
    const now = Date.now();
    // Waiting for the player to join is not a failure: a later real failure starts its backoff over.
    failuresRef.current = state.retry === "poll" ? 0 : nextFailureCount(failuresRef.current, liveSinceRef.current, now);
    liveSinceRef.current = null;
    const delay = retryDelayMs(state.retry, failuresRef.current);
    if (delay === null) return undefined;
    const timer = window.setTimeout(() => {
      backgroundRetryRef.current = true;
      requestRetry();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.attempt, state.retry, state.status]);

  return { ...state, retry: retryNow };
}
