import { canOpenPlayerScopedStream, EventSequenceGuard, parseEnvelope, parseEvent, type ConnectionStatus, type MinimapDiagnostic, type ParseErrorCode, type ParseResult, type ServerRoute, type SlgoEvent, type SteamIdentity } from "../contracts/index.ts";

export type RouteAdmission = { ok: true } | { ok: false; status: Extract<ConnectionStatus, "stale" | "unauthorized">; reason: string };

/** Client-side checks every sidecar connection runs before opening a routed stream. */
export function admitRoute(route: ServerRoute, identity: SteamIdentity, now = Date.now()): RouteAdmission {
  if (!Number.isFinite(Date.parse(route.expiresAt)) || Date.parse(route.expiresAt) <= now) return { ok: false, status: "stale", reason: "expired-route" };
  if (route.steamId !== identity.steamId) return { ok: false, status: "unauthorized", reason: "route-identity-mismatch" };
  if (!canOpenPlayerScopedStream(route)) return { ok: false, status: "unauthorized", reason: "unauthorized" };
  return { ok: true };
}

export type SidecarEventIntakeOptions = {
  /** Monotonic clock for diagnostic receipt times. */
  now?: () => number;
  /** Called after a stream-level rejection has changed the status. */
  onGlobalReject?: (code: ParseErrorCode) => void;
};

/**
 * Validation path shared by every sidecar connection: route/instance check,
 * sequence and baseline rules, minimap diagnostics and viewer binding. It owns
 * the connection status and the event, status and diagnostic listeners.
 */
export class SidecarEventIntake {
  private status: ConnectionStatus = "offline";
  private readonly guard = new EventSequenceGuard();
  private readonly listeners = new Set<(event: SlgoEvent) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly diagnosticListeners = new Set<(diagnostic: MinimapDiagnostic) => void>();
  private activeRoute: ServerRoute | null = null;
  private readonly now: () => number;
  private readonly onGlobalReject?: (code: ParseErrorCode) => void;

  constructor(options: SidecarEventIntakeOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.onGlobalReject = options.onGlobalReject;
  }

  get route(): ServerRoute | null { return this.activeRoute; }

  getStatus() { return this.status; }

  subscribe(listener: (event: SlgoEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeStatus(listener: (status: ConnectionStatus) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  subscribeDiagnostic(listener: (diagnostic: MinimapDiagnostic) => void) {
    this.diagnosticListeners.add(listener);
    return () => this.diagnosticListeners.delete(listener);
  }

  setStatus(status: ConnectionStatus) {
    if (status === this.status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  /** Accepts events for this route; the first one must be a baseline. */
  begin(route: ServerRoute) {
    this.guard.reset();
    this.activeRoute = route;
    this.setStatus("baseline-required");
  }

  /** Stops accepting events. Without a status the current one is kept. */
  end(status?: ConnectionStatus) {
    this.activeRoute = null;
    this.guard.reset();
    if (status) this.setStatus(status);
  }

  receive(event: unknown): ParseResult<SlgoEvent> {
    const receivedAtMs = this.now();
    const route = this.activeRoute;
    if (!route) return { ok: false, error: { code: this.status === "unauthorized" ? "unauthorized" : "wrong-instance", message: "No authenticated sidecar route is active" } };
    const envelope = parseEnvelope(event);
    if (!envelope.ok) {
      this.rejectGlobal(envelope.error.code);
      return envelope;
    }
    if (envelope.value.server_id !== route.serverId || envelope.value.instance_id !== route.instanceId) {
      this.rejectGlobal("wrong-instance");
      return {
        ok: false,
        error: {
          code: "wrong-instance",
          message: "Event does not match the active server route",
          eventId: envelope.value.event_id,
        },
      };
    }
    // A baseline can grant synchronization only after its full payload is valid.
    const baseline = envelope.value.type === "sidecar.baseline" ? parseEvent(envelope.value) : null;
    if (baseline && envelope.value.sequence <= this.guard.acceptedSequence) {
      return { ok: false, error: { code: "stale-sequence", message: "Baseline sequence is older than the accepted sequence", eventId: envelope.value.event_id } };
    }
    if (baseline && !baseline.ok) {
      this.rejectGlobal(baseline.error.code);
      return baseline;
    }
    const accepted = this.guard.accept(envelope.value);
    if (!accepted.ok) {
      if (accepted.error.code !== "stale-sequence") this.rejectGlobal(accepted.error.code);
      return accepted;
    }
    // Valid routed envelopes consume sequence even when their payload is rejected.
    const parsed = baseline ?? parseEvent(envelope.value);
    if (!parsed.ok) {
      // An event type this client does not know: drop the frame, the stream stays in sync.
      if (parsed.error.code === "unsupported-event-type") return parsed;
      const eventType = envelope.value.type;
      if ((eventType === "minimap.init" || eventType === "minimap.positions") && parsed.error.code !== "invalid-envelope") {
        const kind = parsed.error.code === "unsupported-minimap-schema" ? "incompatible-payload"
          : parsed.error.code === "unsupported-minimap-map" ? "incompatible-map" : "invalid-payload";
        const diagnostic: MinimapDiagnostic = {
          feature: "minimap", kind, eventType,
          serverId: envelope.value.server_id, instanceId: envelope.value.instance_id,
          roundId: envelope.value.round_id, sequence: envelope.value.sequence,
          eventId: envelope.value.event_id, receivedAtMs,
        };
        for (const listener of this.diagnosticListeners) listener(diagnostic);
      } else {
        this.rejectGlobal(parsed.error.code);
      }
      return parsed;
    }
    if (parsed.value.type === "minimap.positions" && parsed.value.payload.viewer.player_id !== route.steamId) {
      this.rejectGlobal("unauthorized");
      return { ok: false, error: { code: "unauthorized", message: "Minimap viewer does not match the authenticated route", eventId: parsed.value.event_id } };
    }
    this.setStatus("live");
    for (const listener of this.listeners) listener(parsed.value);
    return { ok: true, value: parsed.value };
  }

  private rejectGlobal(code: ParseErrorCode) {
    this.guard.requireBaseline();
    if (code === "unsupported-schema" || code === "unsupported-protocol" || code === "unauthorized") {
      this.activeRoute = null;
      this.setStatus(code === "unauthorized" ? "unauthorized" : "incompatible");
    } else {
      this.setStatus(code === "baseline-required" ? "baseline-required" : "stale");
    }
    this.onGlobalReject?.(code);
  }
}
