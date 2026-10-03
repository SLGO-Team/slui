import { parseRoute, parseRouteRejected, PROTOCOL_VERSION, type IdentityProofWire, type ParseErrorCode, type ParseResult, type RouteRejectionReason, type RouteRequest, type ServerRoute, type SteamIdentity, type SteamIdentityProof } from "../contracts/index.ts";
import type { SlgoControlPlane } from "./index";

export class MockControlPlane implements SlgoControlPlane {
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async resolveActiveServer(identity: SteamIdentity, proof: SteamIdentityProof): Promise<ParseResult<ServerRoute>> {
    const expiresAt = new Date(this.now() + 5 * 60_000).toISOString();
    return parseRoute({
      protocol_version: 0,
      type: "control.route.resolved",
      identity_mode: proof.kind,
      steam_id: identity.steamId,
      server_id: "slgo-demo",
      instance_id: "instance-demo-1",
      sidecar_endpoint: "wss://mock.sidecar.invalid/slgo",
      session_token: "mock-session-token",
      expires_at: expiresAt,
    }, this.now());
  }
}

export function isRouteUsable(route: ServerRoute, now = Date.now()): boolean {
  return Date.parse(route.expiresAt) > now;
}

export function toWireProof(proof: SteamIdentityProof): IdentityProofWire {
  switch (proof.kind) {
    case "local-steamid": return { kind: "local-steamid" };
    case "session-ticket": return { kind: "session-ticket", ticket: proof.ticket, app_id: proof.appId };
    case "openid": return { kind: "openid", claimed_id: proof.claimedId };
    case "device-signature": return { kind: "device-signature", device_id: proof.deviceId, signature: proof.signature };
  }
}

const REJECTION_CODES: Record<RouteRejectionReason, ParseErrorCode> = {
  "invalid-request": "invalid-route",
  "unsupported-protocol": "unsupported-protocol",
  unauthorized: "unauthorized",
  "not-in-game": "not-in-game",
  "rate-limited": "rate-limited",
};

const REJECTION_MESSAGES: Record<RouteRejectionReason, string> = {
  "invalid-request": "Control plane rejected the route request",
  "unsupported-protocol": "Control plane does not support this client version",
  unauthorized: "Control plane did not accept the identity proof",
  "not-in-game": "Not playing on an SLGO server",
  "rate-limited": "Too many route requests; retrying later",
};

const REJECTION_STATUSES = new Set([400, 401, 404, 429]);

export type HttpControlPlaneOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

/** `POST {baseUrl}/v0/route` (packages/protocol/v0/README.md "Control-plane route request"). */
export class HttpControlPlane implements SlgoControlPlane {
  private readonly endpoint: string;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, options: HttpControlPlaneOptions = {}) {
    this.endpoint = `${baseUrl.replace(/\/+$/, "")}/v0/route`;
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async resolveActiveServer(identity: SteamIdentity, proof: SteamIdentityProof): Promise<ParseResult<ServerRoute>> {
    const request: RouteRequest = {
      protocol_version: PROTOCOL_VERSION,
      type: "control.route.request",
      steam_id: identity.steamId,
      proof: toWireProof(proof),
    };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    let response: Response;
    let body: unknown = null;
    try {
      response = await this.fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: abort.signal,
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      throw new Error(abort.signal.aborted ? "Control plane did not answer in time" : `Control plane is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 200) {
      const route = parseRoute(body, this.now());
      if (route.ok && route.value.steamId !== identity.steamId) return { ok: false, error: { code: "invalid-route", message: "Route is for another SteamID" } };
      return route;
    }
    if (!REJECTION_STATUSES.has(response.status)) throw new Error(`Control plane answered HTTP ${response.status}`);
    const rejected = parseRouteRejected(body);
    if (!rejected.ok) return rejected;
    const { reason, message } = rejected.value;
    return { ok: false, error: { code: REJECTION_CODES[reason], message: message || REJECTION_MESSAGES[reason] } };
  }
}
