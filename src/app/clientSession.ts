import type {
  ConnectionFailure,
  ConnectionStatus,
  MinimapDiagnostic,
  ParseErrorCode,
  SlgoEvent,
  SteamIdentity,
  SteamIdentityProof,
} from "../contracts";
import type {
  IdentityProofProvider,
  SlgoConnection,
  SlgoControlPlane,
  SteamClientIdentity,
} from "../platform";
import { SidecarConnectionError } from "../platform/connection.ts";

type RetryHint = ConnectionFailure["retry"];

export type ClientSessionState = {
  status: ConnectionStatus;
  identity: SteamIdentity | null;
  detail: string | null;
  attempt: number;
  /** Set by a failure that the session should retry on its own. */
  retry: RetryHint | null;
};

/**
 * `quiet` marks a progress step of a background retry: the state keeps showing the
 * previous outcome until the attempt reaches a new one, so polling does not flicker.
 */
export type ClientSessionAction =
  | { type: "discover"; attempt: number; quiet?: boolean }
  | { type: "signed-out"; attempt: number }
  | { type: "identity-found"; attempt: number; identity: SteamIdentity; quiet?: boolean }
  | { type: "route-resolved"; attempt: number; quiet?: boolean }
  | { type: "connected"; attempt: number; status: ConnectionStatus }
  | { type: "connection-status"; attempt: number; status: ConnectionStatus; quiet?: boolean }
  | { type: "failed"; attempt: number; status: ConnectionFailure["status"]; detail: string; retry?: RetryHint };

export const initialClientSessionState: ClientSessionState = {
  status: "signed-out",
  identity: null,
  detail: null,
  attempt: 0,
  retry: null,
};

export function clientSessionReducer(state: ClientSessionState, action: ClientSessionAction): ClientSessionState {
  if (action.attempt < state.attempt) return state;
  // Clearing `retry` still matters: the attempt is under way, so no further retry may be scheduled.
  if ("quiet" in action && action.quiet) {
    const identity = action.type === "identity-found" ? action.identity : state.identity;
    return { ...state, identity, attempt: action.attempt, retry: null };
  }
  switch (action.type) {
    case "discover":
      return { status: "discovering", identity: null, detail: null, attempt: action.attempt, retry: null };
    case "signed-out":
      return { status: "signed-out", identity: null, detail: "Steam client identity is unavailable", attempt: action.attempt, retry: null };
    case "identity-found":
      return { status: "route-pending", identity: action.identity, detail: null, attempt: action.attempt, retry: null };
    case "route-resolved":
      return { ...state, status: "connecting", detail: null, attempt: action.attempt, retry: null };
    case "connected":
    case "connection-status":
      return { ...state, status: action.status, detail: null, attempt: action.attempt, retry: null };
    case "failed":
      return { ...state, status: action.status, detail: action.detail, attempt: action.attempt, retry: action.retry ?? "none" };
  }
}

export function statusForRouteError(code: ParseErrorCode): Extract<ConnectionStatus, "offline" | "not-in-game" | "unauthorized" | "incompatible" | "stale"> {
  if (code === "unauthorized") return "unauthorized";
  if (code === "not-in-game") return "not-in-game";
  if (code === "unsupported-protocol" || code === "unsupported-schema") return "incompatible";
  if (code === "expired-route" || code === "wrong-instance" || code === "stale-sequence") return "stale";
  return "offline";
}

/**
 * `not-in-game` is polled at a fixed interval so joining a server is picked up within seconds, however long
 * the player waited in the menu; `rate-limited` backs off; an expired route just needs a new one.
 */
export function retryForRouteError(code: ParseErrorCode): RetryHint {
  if (code === "not-in-game") return "poll";
  if (code === "rate-limited") return "backoff";
  if (code === "expired-route") return "reroute";
  return "none";
}

export const RETRY_MAX_DELAY_MS = 60_000;
/** 12 route requests a minute, well inside the control plane's 30 per minute per address. */
export const NOT_IN_GAME_POLL_MS = 5_000;
/** A session live at least this long counts as recovered; the next failure starts the backoff over. */
export const RETRY_STABLE_LIVE_MS = 60_000;

export function retryDelayMs(retry: RetryHint, failures: number): number | null {
  if (retry === "none") return null;
  if (retry === "poll") return NOT_IN_GAME_POLL_MS;
  const base = retry === "reroute" ? 1_000 : 3_000;
  return Math.min(base * 2 ** Math.max(0, failures - 1), RETRY_MAX_DELAY_MS);
}

// Resetting only after a stable live period stops a sidecar that keeps failing
// right after its baseline from causing a fast reconnect loop.
export function nextFailureCount(previous: number, liveSinceMs: number | null, nowMs: number): number {
  return liveSinceMs !== null && nowMs - liveSinceMs >= RETRY_STABLE_LIVE_MS ? 1 : previous + 1;
}

export type ClientSessionDependencies = {
  identity: SteamClientIdentity;
  proof: IdentityProofProvider;
  controlPlane: SlgoControlPlane;
  connection: SlgoConnection;
};

export type SessionAttemptCallbacks = {
  dispatch(action: ClientSessionAction): void;
  onEvent(event: SlgoEvent): void;
  onDiagnostic?(diagnostic: MinimapDiagnostic): void;
  onStatus?(status: ConnectionStatus): void;
  isCurrent(): boolean;
};

export async function runClientSessionAttempt(
  dependencies: ClientSessionDependencies,
  attempt: number,
  callbacks: SessionAttemptCallbacks,
  /** A background retry: progress steps are `quiet`, only the outcome shows. */
  quiet = false,
): Promise<() => void> {
  callbacks.dispatch({ type: "discover", attempt, quiet });
  let currentIdentity: SteamIdentity | null;
  try {
    currentIdentity = await dependencies.identity.getCurrentUser();
  } catch (error) {
    callbacks.dispatch({ type: "failed", attempt, status: "offline", detail: errorMessage(error, "Steam identity discovery failed") });
    return () => undefined;
  }
  if (!callbacks.isCurrent()) return () => undefined;
  if (!currentIdentity) {
    callbacks.dispatch({ type: "signed-out", attempt });
    return () => undefined;
  }

  callbacks.dispatch({ type: "identity-found", attempt, identity: currentIdentity, quiet });
  let proof: SteamIdentityProof | null;
  try {
    proof = await dependencies.proof.getProof(currentIdentity);
  } catch (error) {
    callbacks.dispatch({ type: "failed", attempt, status: "unauthorized", detail: errorMessage(error, "Identity proof failed") });
    return () => undefined;
  }
  if (!callbacks.isCurrent()) return () => undefined;
  if (!proof) {
    callbacks.dispatch({ type: "failed", attempt, status: "unauthorized", detail: "No identity proof is available" });
    return () => undefined;
  }

  let route: Awaited<ReturnType<SlgoControlPlane["resolveActiveServer"]>>;
  try {
    route = await dependencies.controlPlane.resolveActiveServer(currentIdentity, proof);
  } catch (error) {
    if (callbacks.isCurrent()) callbacks.dispatch({ type: "failed", attempt, status: "offline", detail: errorMessage(error, "Control plane is unreachable"), retry: "backoff" });
    return () => undefined;
  }
  if (!callbacks.isCurrent()) return () => undefined;
  if (!route.ok) {
    callbacks.dispatch({ type: "failed", attempt, status: statusForRouteError(route.error.code), detail: route.error.message, retry: retryForRouteError(route.error.code) });
    return () => undefined;
  }

  callbacks.dispatch({ type: "route-resolved", attempt, quiet });
  let active = true;
  const isCurrent = () => active && callbacks.isCurrent();
  const subscriptions = [
    dependencies.connection.subscribe((event) => {
      if (isCurrent()) callbacks.onEvent(event);
    }),
    dependencies.connection.subscribeStatus((status) => {
      if (!isCurrent()) return;
      callbacks.dispatch({ type: "connection-status", attempt, status, quiet: quiet && status === "connecting" });
      callbacks.onStatus?.(status);
    }),
    dependencies.connection.subscribeDiagnostic((diagnostic) => {
      if (isCurrent()) callbacks.onDiagnostic?.(diagnostic);
    }),
    dependencies.connection.subscribeFailure((failure) => {
      if (isCurrent()) callbacks.dispatch({ type: "failed", attempt, ...failure });
    }),
  ];
  const unsubscribe = () => {
    active = false;
    for (const cleanup of subscriptions) cleanup();
  };
  try {
    await dependencies.connection.connect(route.value, currentIdentity);
    if (!callbacks.isCurrent()) {
      unsubscribe();
      return () => undefined;
    }
    callbacks.dispatch({ type: "connected", attempt, status: dependencies.connection.getStatus() });
  } catch (error) {
    if (callbacks.isCurrent() && error instanceof SidecarConnectionError) {
      callbacks.dispatch({ type: "failed", attempt, ...error.failure });
    } else if (callbacks.isCurrent()) {
      const status = dependencies.connection.getStatus();
      callbacks.dispatch({
        type: "failed",
        attempt,
        status: status === "unauthorized" || status === "incompatible" || status === "stale" ? status : "offline",
        detail: errorMessage(error, "Sidecar connection failed"),
      });
    }
    unsubscribe();
  }
  return unsubscribe;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
