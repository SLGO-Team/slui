import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ConnectionStatus, MinimapDiagnostic, SlgoEvent } from "../contracts";
import type { ClientSessionDependencies } from "./clientSession";
import { clientSessionReducer, failureCountFor, identityPollRetries, initialClientSessionState, retryDelayMs, runClientSessionAttempt, type LivePeriod } from "./clientSession";
import { updateRequiredDetail } from "./updateModel";

const IDENTITY_POLL_INTERVAL_MS = 3_000;

export function useClientSession(
  dependencies: ClientSessionDependencies,
  onEvent: (event: SlgoEvent) => void,
  onDiagnostic?: (diagnostic: MinimapDiagnostic) => void,
  onStatus?: (status: ConnectionStatus) => void,
  /** The SLUI version a required update asks for; while set, nothing connects. */
  updateRequired: string | null = null,
  /** Whether the game process runs (null until known): a closed game ends the session and connects nothing. */
  gameRunning: boolean | null = true,
) {
  const [state, dispatch] = useReducer(clientSessionReducer, initialClientSessionState);
  const [retryKey, requestRetry] = useReducer((value: number) => value + 1, 0);
  const stateRef = useRef(state);
  const eventHandlerRef = useRef(onEvent);
  const diagnosticHandlerRef = useRef(onDiagnostic);
  const statusHandlerRef = useRef(onStatus);
  const failuresRef = useRef(0);
  const liveRef = useRef<LivePeriod | null>(null);
  const updateRequiredRef = useRef(updateRequired);
  // Every run of the attempt effect gets a new number, so a game start or exit never reuses the last one's.
  const attemptRef = useRef(0);
  // Set only by the retry timer; a manual retry or an account switch shows its progress.
  const backgroundRetryRef = useRef(false);
  stateRef.current = state;
  eventHandlerRef.current = onEvent;
  diagnosticHandlerRef.current = onDiagnostic;
  statusHandlerRef.current = onStatus;
  updateRequiredRef.current = updateRequired;

  const retryNow = useCallback(() => {
    backgroundRetryRef.current = false;
    requestRetry();
  }, []);

  useEffect(() => {
    if (gameRunning === null) return undefined;
    const attempt = ++attemptRef.current;
    if (updateRequired) {
      dispatch({ type: "failed", attempt, status: "incompatible", detail: updateRequiredDetail(updateRequired), retry: "none" });
      statusHandlerRef.current?.("incompatible");
      return undefined;
    }
    const quiet = backgroundRetryRef.current;
    let current = true;
    let unsubscribe: () => void = () => undefined;

    void runClientSessionAttempt(dependencies, attempt, {
      dispatch,
      onEvent: (event) => eventHandlerRef.current(event),
      onDiagnostic: (diagnostic) => diagnosticHandlerRef.current?.(diagnostic),
      onStatus: (status) => statusHandlerRef.current?.(status),
      isCurrent: () => current,
    }, quiet, gameRunning).then((cleanup) => {
      if (current) unsubscribe = cleanup;
      else cleanup();
    });

    return () => {
      current = false;
      unsubscribe();
      void dependencies.connection.disconnect();
    };
  }, [dependencies, gameRunning, retryKey, updateRequired]);

  useEffect(() => {
    let active = true;
    const settle = (current: { steamId: string | null } | "error") => {
      if (active && identityPollRetries({
        updateRequired: updateRequiredRef.current !== null,
        previousSteamId: stateRef.current.identity?.steamId ?? null,
        current,
        status: stateRef.current.status,
      })) retryNow();
    };
    const timer = window.setInterval(() => {
      void dependencies.identity.getCurrentUser().then(
        (identity) => settle({ steamId: identity?.steamId ?? null }),
        () => settle("error"),
      );
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
      if (liveRef.current?.attempt !== state.attempt) liveRef.current = { attempt: state.attempt, sinceMs: Date.now() };
      return undefined;
    }
    if (!state.retry || state.retry === "none") return undefined;
    // Waiting for the player to join is not a failure: a later real failure starts its backoff over.
    failuresRef.current = failureCountFor(failuresRef.current, liveRef.current, state.attempt, state.retry, Date.now());
    liveRef.current = null;
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
