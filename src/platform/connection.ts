import { MINIMAP_SCHEMA_VERSION, parseClientFeatures, parseCommand, PROTOCOL_VERSION, SIDECAR_CLOSE_CODES, SUPPORTED_SCHEMA_VERSION, type ConnectionFailure, type ConnectionStatus, type MinimapDiagnostic, type ParseErrorCode, type ParseResult, type ServerRoute, type ClientFeatures, type SessionOpen, type SlgoCommand, type SlgoEvent, type SteamIdentity } from "../contracts/index.ts";
import type { SlgoConnection } from "./index.ts";
import { admitRoute, SidecarEventIntake } from "./sidecarIntake.ts";

export class MockSidecarConnection implements SlgoConnection {
  private readonly events: SlgoEvent[];
  private readonly intake: SidecarEventIntake;
  private sentCommands = new Set<string>();

  constructor(events: SlgoEvent[] = [], now: () => number = () => performance.now()) {
    this.events = events;
    this.intake = new SidecarEventIntake({ now });
  }

  async connect(route: ServerRoute, identity: SteamIdentity) {
    this.intake.end();
    this.intake.setStatus("connecting");
    const admission = admitRoute(route, identity);
    if (!admission.ok) {
      this.intake.setStatus(admission.status);
      throw new Error(admission.reason);
    }
    this.intake.begin(route);
    for (const event of this.events) this.receive(event);
  }

  async disconnect() {
    this.intake.end("offline");
  }

  subscribe(listener: (event: SlgoEvent) => void) { return this.intake.subscribe(listener); }
  subscribeStatus(listener: (status: ConnectionStatus) => void) { return this.intake.subscribeStatus(listener); }
  subscribeDiagnostic(listener: (diagnostic: MinimapDiagnostic) => void) { return this.intake.subscribeDiagnostic(listener); }
  // The mock stream never ends by itself.
  subscribeFailure(_listener: (failure: ConnectionFailure) => void) { return () => undefined; }

  async send(command: SlgoCommand) {
    if (this.intake.getStatus() !== "live" || !this.intake.route) throw new Error("connection-not-live");
    const parsed = parseCommand(command);
    if (!parsed.ok) throw new Error(parsed.error.code);
    if (this.sentCommands.has(parsed.value.command_id)) return;
    this.sentCommands.add(parsed.value.command_id);
  }

  // The mock stream has no plugin to tell; still reject lists a sidecar would drop.
  setFeatures(features: readonly string[]) {
    toClientFeatures(features);
  }

  getStatus() { return this.intake.getStatus(); }

  receive(event: unknown): ParseResult<SlgoEvent> {
    return this.intake.receive(event);
  }
}

function toClientFeatures(features: readonly string[]): ClientFeatures {
  const parsed = parseClientFeatures({ type: "client.features", features: [...features] });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

/** The part of the browser WebSocket API the sidecar connection uses. */
export type WebSocketLike = Pick<WebSocket, "readyState" | "onopen" | "onmessage" | "onclose" | "onerror" | "send" | "close">;

export type WebSocketSidecarOptions = {
  createSocket?: (url: string) => WebSocketLike;
  /** Development only: connect here instead of the route's endpoint (see readBackendConfig). */
  endpointOverride?: string | null;
  /** Monotonic clock for diagnostics. */
  now?: () => number;
  openTimeoutMs?: number;
  baselineTimeoutMs?: number;
};

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

/** Shown when the sidecar refuses the session (4001): IP binding needs SLUI next to the game. */
export const SAME_CONNECTION_HINT = "请在运行游戏的同一台电脑、同一网络连接上运行 SLUI";

export class SidecarConnectionError extends Error {
  readonly failure: ConnectionFailure;

  constructor(failure: ConnectionFailure) {
    super(failure.detail);
    this.name = "SidecarConnectionError";
    this.failure = failure;
  }
}

export function failureForClose(code: number, reason: string, opened: boolean): ConnectionFailure {
  switch (code) {
    case SIDECAR_CLOSE_CODES.invalidHandshake:
    case SIDECAR_CLOSE_CODES.unsupportedProtocol:
      return { status: "incompatible", detail: reason || "Sidecar refused the session handshake", retry: "none" };
    case SIDECAR_CLOSE_CODES.unauthorized:
      return { status: "unauthorized", detail: reason ? `${SAME_CONNECTION_HINT}（${reason}）` : SAME_CONNECTION_HINT, retry: "backoff" };
    case SIDECAR_CLOSE_CODES.instanceUnavailable:
      return { status: "stale", detail: reason || "Server instance ended", retry: "reroute" };
    default:
      return { status: "offline", detail: opened ? "Sidecar connection lost" : "Sidecar is unreachable", retry: "backoff" };
  }
}

/**
 * Real sidecar session: `session.open` handshake, then baseline, replayed
 * snapshots and live events through the shared intake. Commands are bare v0
 * command frames and are only sent once the stream is live. `client.features`
 * is sent after each accepted baseline (when not empty) and on every change.
 */
export class WebSocketSidecarConnection implements SlgoConnection {
  private readonly intake: SidecarEventIntake;
  private readonly failureListeners = new Set<(failure: ConnectionFailure) => void>();
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly endpointOverride: string | null;
  private readonly openTimeoutMs: number;
  private readonly baselineTimeoutMs: number;
  private socket: WebSocketLike | null = null;
  private features: ClientFeatures = { type: "client.features", features: [] };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: { resolve(): void; reject(error: SidecarConnectionError): void } | null = null;

  constructor(options: WebSocketSidecarOptions = {}) {
    this.intake = new SidecarEventIntake({ now: options.now, onGlobalReject: (code) => this.rejectStream(code) });
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.endpointOverride = options.endpointOverride ?? null;
    this.openTimeoutMs = options.openTimeoutMs ?? 10_000;
    this.baselineTimeoutMs = options.baselineTimeoutMs ?? 10_000;
  }

  async connect(route: ServerRoute, identity: SteamIdentity) {
    this.settlePending({ status: "offline", detail: "Connection replaced", retry: "none" });
    this.detach();
    this.intake.end();
    this.intake.setStatus("connecting");
    const admission = admitRoute(route, identity);
    if (!admission.ok) {
      this.intake.setStatus(admission.status);
      throw new SidecarConnectionError({ status: admission.status, detail: admission.reason, retry: admission.status === "stale" ? "reroute" : "none" });
    }
    let socket: WebSocketLike;
    try {
      socket = this.createSocket(this.endpointOverride ?? route.sidecarEndpoint);
    } catch (error) {
      this.intake.setStatus("offline");
      throw new SidecarConnectionError({ status: "offline", detail: error instanceof Error ? error.message : "Invalid sidecar endpoint", retry: "none" });
    }
    await new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.socket = socket;
      let opened = false;
      this.startTimer(this.openTimeoutMs, () => this.fail({ status: "offline", detail: "Sidecar did not answer", retry: "backoff" }));
      socket.onopen = () => {
        opened = true;
        // The token travels only in this first frame, never in the URL.
        const open: SessionOpen = {
          protocol_version: PROTOCOL_VERSION,
          schema_version: SUPPORTED_SCHEMA_VERSION,
          type: "session.open",
          session_token: route.sessionToken,
          minimap_schema_versions: [MINIMAP_SCHEMA_VERSION],
        };
        socket.send(JSON.stringify(open));
        this.intake.begin(route);
        this.startTimer(this.baselineTimeoutMs, () => this.fail({ status: "offline", detail: "Sidecar sent no baseline", retry: "backoff" }));
      };
      socket.onmessage = (event) => {
        this.intake.receive(event.data);
        if (this.pending && this.intake.getStatus() === "live") {
          this.clearTimer();
          this.settlePending(null);
          // A new session starts with no features on the sidecar side.
          if (this.features.features.length > 0) this.sendFeatures();
        }
      };
      socket.onclose = (event) => this.fail(failureForClose(event.code, event.reason, opened));
      // A close event always follows an error; it carries the useful code.
      socket.onerror = () => undefined;
    });
  }

  async disconnect() {
    this.settlePending({ status: "offline", detail: "Disconnected", retry: "none" });
    this.detach();
    this.intake.end("offline");
  }

  subscribe(listener: (event: SlgoEvent) => void) { return this.intake.subscribe(listener); }
  subscribeStatus(listener: (status: ConnectionStatus) => void) { return this.intake.subscribeStatus(listener); }
  subscribeDiagnostic(listener: (diagnostic: MinimapDiagnostic) => void) { return this.intake.subscribeDiagnostic(listener); }

  subscribeFailure(listener: (failure: ConnectionFailure) => void) {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  async send(command: SlgoCommand) {
    const socket = this.socket;
    if (this.intake.getStatus() !== "live" || !this.intake.route || !socket || socket.readyState !== SOCKET_OPEN) throw new Error("connection-not-live");
    const parsed = parseCommand(command);
    if (!parsed.ok) throw new Error(parsed.error.code);
    socket.send(JSON.stringify(parsed.value));
  }

  setFeatures(features: readonly string[]) {
    const next = toClientFeatures(features);
    if (next.features.length === this.features.features.length && next.features.every((feature, index) => feature === this.features.features[index])) return;
    this.features = next;
    this.sendFeatures();
  }

  getStatus() { return this.intake.getStatus(); }

  private sendFeatures() {
    const socket = this.socket;
    if (this.intake.getStatus() !== "live" || !socket || socket.readyState !== SOCKET_OPEN) return;
    socket.send(JSON.stringify(this.features));
  }

  // A real sidecar never sends a second baseline on one socket, so a rejected stream cannot recover.
  private rejectStream(code: ParseErrorCode) {
    if (!this.socket) return;
    const status = this.intake.getStatus();
    const terminal = status === "incompatible" || status === "unauthorized";
    this.fail({ status: terminal ? status : "stale", detail: `Sidecar stream rejected: ${code}`, retry: terminal ? "none" : "reroute" });
  }

  /** Ends the current socket after a remote or protocol failure. */
  private fail(failure: ConnectionFailure) {
    this.detach();
    this.intake.end(failure.status);
    if (this.pending) this.settlePending(failure);
    else for (const listener of this.failureListeners) listener(failure);
  }

  private settlePending(failure: ConnectionFailure | null) {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    if (failure) pending.reject(new SidecarConnectionError(failure));
    else pending.resolve();
  }

  // Handlers go first, so a socket closed here can never reach the intake again.
  private detach() {
    this.clearTimer();
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    if (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN) socket.close(1000, "SLUI closed the session");
  }

  private startTimer(ms: number, onTimeout: () => void) {
    this.clearTimer();
    this.timer = setTimeout(onTimeout, ms);
  }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
