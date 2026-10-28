import type { IdentityMode, InstanceEndReason } from "@slgo/protocol";

export * from "@slgo/protocol";

export type ConnectionStatus =
  | "signed-out"
  | "discovering"
  | "route-pending"
  | "connecting"
  | "baseline-required"
  | "live"
  | "stale"
  /** The routed server instance ended (the plugin said goodbye, or never came back): its data is dropped while a new route is resolved. */
  | "ended"
  | "offline"
  /**
   * The player is on no SLGO server: the control plane's route rejection `not-in-game`, or the sidecar's 4004
   * after they left; retried in the background.
   */
  | "not-in-game"
  | "incompatible"
  | "unauthorized"
  /** The game process is not running: the session reads only the Steam identity and waits for the game to start. */
  | "game-not-running";

/**
 * Whether the player's match is over: the instance ended, the player is on no server, or the game is closed.
 * Every feature drops its match state on these; a lost connection (`offline`, `stale`, …) keeps it for a reconnect.
 */
export function endsMatch(status: ConnectionStatus): boolean {
  return status === "ended" || status === "not-in-game" || status === "game-not-running";
}

export type SteamIdentity = {
  steamId: string;
  personaName?: string;
  avatarUrl?: string;
};

export type SteamIdentityProof =
  | { kind: "local-steamid"; steamId: string }
  | { kind: "session-ticket"; ticket: string; appId: number }
  | { kind: "openid"; claimedId: string }
  | { kind: "device-signature"; deviceId: string; signature: string };

export type VerificationState =
  | { kind: "unverified"; identity: SteamIdentity }
  /** A claimed SteamID; the sidecar authorizes each session by IP binding. */
  | { kind: "claimed"; identity: SteamIdentity; mode: "local-steamid" }
  /** Reserved for stronger proofs. */
  | { kind: "verified"; identity: SteamIdentity; mode: Exclude<IdentityMode, "local-steamid"> };

export type MinimapDiagnostic = {
  feature: "minimap";
  kind: "invalid-payload" | "incompatible-payload" | "incompatible-map";
  eventType: "minimap.init" | "minimap.positions";
  serverId: string;
  instanceId: string;
  roundId?: string | null;
  sequence: number;
  eventId: string;
  receivedAtMs: number;
};

/** Why a sidecar session ended or could not start, and whether the session layer should try again. */
export type ConnectionFailure = {
  status: Extract<ConnectionStatus, "offline" | "not-in-game" | "stale" | "ended" | "unauthorized" | "incompatible">;
  detail: string;
  /**
   * `reroute`: resolve a new route soon; `backoff`: retry with growing delays; `poll`: ask again at a fixed
   * short interval (waiting for the player to join a server); `none`: wait for the player.
   */
  retry: "reroute" | "backoff" | "poll" | "none";
  /** `ended` only: the reason from the `instance.ended` frame before the 4003 close; absent or null when the sidecar gave none. */
  endReason?: InstanceEndReason | null;
};

// The sidecar is the authorization boundary; the client only needs some identity claim.
export function canUsePlayerScopedFeatures(verification: VerificationState | null): boolean {
  return verification?.kind === "claimed" || verification?.kind === "verified";
}

export function createCommandId(prefix: string, now = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${now.toString(36)}-${random}`;
}
