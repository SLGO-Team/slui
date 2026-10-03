import type { IdentityMode } from "@slgo/protocol";

export * from "@slgo/protocol";

export type ConnectionStatus =
  | "signed-out"
  | "discovering"
  | "route-pending"
  | "connecting"
  | "baseline-required"
  | "live"
  | "stale"
  | "offline"
  /** The control plane found no SLGO server the player is on (route rejection `not-in-game`); retried in the background. */
  | "not-in-game"
  | "incompatible"
  | "unauthorized";

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
  status: Extract<ConnectionStatus, "offline" | "not-in-game" | "stale" | "unauthorized" | "incompatible">;
  detail: string;
  /**
   * `reroute`: resolve a new route soon; `backoff`: retry with growing delays; `poll`: ask again at a fixed
   * short interval (waiting for the player to join a server); `none`: wait for the player.
   */
  retry: "reroute" | "backoff" | "poll" | "none";
};

// The sidecar is the authorization boundary; the client only needs some identity claim.
export function canUsePlayerScopedFeatures(verification: VerificationState | null): boolean {
  return verification?.kind === "claimed" || verification?.kind === "verified";
}

export function createCommandId(prefix: string, now = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${now.toString(36)}-${random}`;
}
