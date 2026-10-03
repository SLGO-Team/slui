// Real backend adapters against fakes: HttpControlPlane (fake fetch),
// WebSocketSidecarConnection (fake WebSocket), backend config and the
// session retry policy. No network access.
import assert from "node:assert/strict";
import { parseRouteRequest, parseSessionOpen } from "../src/contracts/index.ts";
import { readBackendConfig } from "../src/platform/backend.ts";
import { SAME_CONNECTION_HINT, SidecarConnectionError, WebSocketSidecarConnection } from "../src/platform/connection.ts";
import { HttpControlPlane, toWireProof } from "../src/platform/route.ts";
import {
  clientSessionReducer,
  initialClientSessionState,
  nextFailureCount,
  retryDelayMs,
  retryForRouteError,
  runClientSessionAttempt,
  statusForRouteError,
} from "../src/app/clientSession.ts";

const steamId = "76561198000000100";
const identity = { steamId };
const flush = () => new Promise((resolve) => setImmediate(resolve));

// ---- Backend configuration ----------------------------------------------

{
  const warnings = [];
  const warn = (message) => warnings.push(message);
  // Mocks are explicit: only the `mock` mode selects them, whatever else is set.
  assert.deepEqual(readBackendConfig({ DEV: true, MODE: "mock" }, warn), { kind: "mock" });
  assert.deepEqual(readBackendConfig({ DEV: true, MODE: "mock", VITE_CONTROL_PLANE_URL: "https://control.example.com" }, warn), { kind: "mock" });
  // Any other mode without a control plane is a configuration error, never a mock fallback.
  assert.throws(() => readBackendConfig({ DEV: true, MODE: "development" }, warn), /VITE_CONTROL_PLANE_URL is not set for mode "development"/);
  assert.throws(() => readBackendConfig({ DEV: false, MODE: "production", VITE_CONTROL_PLANE_URL: "  " }, warn), /dev:mock/);
  assert.deepEqual(readBackendConfig({ DEV: false, MODE: "production", VITE_CONTROL_PLANE_URL: "https://control.example.com/" }, warn),
    { kind: "real", controlPlaneUrl: "https://control.example.com", sidecarEndpointOverride: null });
  assert.deepEqual(readBackendConfig({ DEV: true, MODE: "development", VITE_CONTROL_PLANE_URL: "http://127.0.0.1:7800", VITE_DEV_SIDECAR_ENDPOINT: "ws://127.0.0.1:7801/slgo/sidecar" }, warn),
    { kind: "real", controlPlaneUrl: "http://127.0.0.1:7800", sidecarEndpointOverride: "ws://127.0.0.1:7801/slgo/sidecar" });
  assert.equal(warnings.length, 0);
  assert.throws(() => readBackendConfig({ DEV: true, MODE: "development", VITE_CONTROL_PLANE_URL: "http://control.example.com" }, warn), /https/, "plain http only on loopback");
  assert.throws(() => readBackendConfig({ DEV: true, MODE: "development", VITE_CONTROL_PLANE_URL: "not a url" }, warn), /https/);
  for (const [env, why] of [
    [{ DEV: false, VITE_DEV_SIDECAR_ENDPOINT: "ws://127.0.0.1:7801/slgo/sidecar" }, "release builds ignore the override"],
    [{ DEV: true, VITE_DEV_SIDECAR_ENDPOINT: "ws://sidecar.example.com:7801/slgo/sidecar" }, "only loopback"],
    [{ DEV: true, VITE_DEV_SIDECAR_ENDPOINT: "http://127.0.0.1:7801/slgo/sidecar" }, "only ws:// or wss://"],
  ]) {
    const config = readBackendConfig({ MODE: "development", VITE_CONTROL_PLANE_URL: "http://localhost:7800", ...env }, warn);
    assert.equal(config.sidecarEndpointOverride, null, why);
  }
  assert.equal(warnings.length, 3, "an ignored override is reported");
}

// ---- Control plane --------------------------------------------------------

const routeBody = (overrides = {}) => ({
  protocol_version: 0,
  type: "control.route.resolved",
  identity_mode: "local-steamid",
  steam_id: steamId,
  server_id: "slgo-local-7777",
  instance_id: "instance-dev-1",
  sidecar_endpoint: "wss://localhost:7801/slgo/sidecar",
  session_token: "v0.token.signature",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  ...overrides,
});
const rejection = (reason, message) => ({ protocol_version: 0, type: "control.route.rejected", reason, ...(message ? { message } : {}) });
const json = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const localProof = { kind: "local-steamid", steamId };

{
  const requests = [];
  const controlPlane = new HttpControlPlane("http://127.0.0.1:7800/", {
    fetch: async (url, init) => {
      requests.push({ url, init });
      return json(200, routeBody());
    },
  });
  const route = await controlPlane.resolveActiveServer(identity, localProof);
  assert.equal(route.ok, true);
  assert.equal(route.value.sidecarEndpoint, "wss://localhost:7801/slgo/sidecar");
  assert.equal(route.value.identityMode, "local-steamid");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:7800/v0/route");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers["content-type"], "application/json");
  const body = JSON.parse(requests[0].init.body);
  assert.deepEqual(body, { protocol_version: 0, type: "control.route.request", steam_id: steamId, proof: { kind: "local-steamid" } });
  assert.equal(parseRouteRequest(body).ok, true, "request matches the protocol parser");
}

assert.deepEqual(toWireProof({ kind: "session-ticket", ticket: "t", appId: 700330 }), { kind: "session-ticket", ticket: "t", app_id: 700330 });
assert.deepEqual(toWireProof({ kind: "openid", claimedId: "c" }), { kind: "openid", claimed_id: "c" });
assert.deepEqual(toWireProof({ kind: "device-signature", deviceId: "d", signature: "s" }), { kind: "device-signature", device_id: "d", signature: "s" });

const answer = (status, body) => new HttpControlPlane("http://127.0.0.1:7800", { fetch: async () => json(status, body) });

for (const [status, body, code, connectionStatus, retry] of [
  [404, rejection("not-in-game"), "not-in-game", "not-in-game", "poll"],
  [429, rejection("rate-limited"), "rate-limited", "offline", "backoff"],
  [401, rejection("unauthorized"), "unauthorized", "unauthorized", "none"],
  [400, rejection("unsupported-protocol"), "unsupported-protocol", "incompatible", "none"],
  [400, rejection("invalid-request"), "invalid-route", "offline", "none"],
  [404, "<html>not found</html>", "invalid-route", "offline", "none"],
  [200, routeBody({ steam_id: "76561198000000001" }), "invalid-route", "offline", "none"],
  [200, routeBody({ sidecar_endpoint: "ws://localhost:7801/slgo/sidecar" }), "invalid-route", "offline", "none"],
  [200, routeBody({ expires_at: new Date(Date.now() - 1).toISOString() }), "expired-route", "stale", "reroute"],
]) {
  const result = await answer(status, body).resolveActiveServer(identity, localProof);
  assert.equal(result.ok, false, `${status} ${JSON.stringify(body)}`);
  assert.equal(result.error.code, code);
  assert.equal(statusForRouteError(result.error.code), connectionStatus, code);
  assert.equal(retryForRouteError(result.error.code), retry, code);
}
assert.equal((await answer(404, rejection("not-in-game", "Player is not on a registered server")).resolveActiveServer(identity, localProof)).error.message, "Player is not on a registered server");
await assert.rejects(answer(500, { error: "boom" }).resolveActiveServer(identity, localProof), /HTTP 500/);
await assert.rejects(new HttpControlPlane("http://127.0.0.1:7800", { fetch: async () => { throw new TypeError("fetch failed"); } }).resolveActiveServer(identity, localProof), /unreachable/);
await assert.rejects(new HttpControlPlane("http://127.0.0.1:7800", {
  timeoutMs: 10,
  fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
}).resolveActiveServer(identity, localProof), /in time/);

// ---- Sidecar WebSocket ----------------------------------------------------

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closedWith = null;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    if (this.readyState !== 1) throw new Error("socket is not open");
    this.sent.push(data);
  }
  close(code, reason) {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }
  // Sidecar side.
  accept() { this.readyState = 1; this.onopen?.({}); }
  deliver(value) { this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) }); }
  drop(code, reason = "") { this.readyState = 3; this.onerror?.({}); this.onclose?.({ code, reason }); }
}
const lastSocket = () => FakeWebSocket.instances.at(-1);

const route = {
  protocolVersion: 0,
  identityMode: "local-steamid",
  steamId,
  serverId: "slgo-local-7777",
  instanceId: "instance-dev-1",
  sidecarEndpoint: "wss://localhost:7801/slgo/sidecar",
  sessionToken: "v0.secret-token.signature",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
let sequence = 0;
const event = (type, payload, extra = {}) => ({
  protocol_version: 0, schema_version: 1, event_id: `evt-${++sequence}`,
  server_id: route.serverId, instance_id: route.instanceId, round_id: "round-7",
  sequence, type, sent_at: new Date().toISOString(), payload, ...extra,
});
const baselineEvent = () => event("sidecar.baseline", { baseline: true });
const chat = () => event("chat.message", { message_id: `chat-${sequence}`, scope: "team", sender_id: steamId, sender_name: "Nova", body: "hi", sent_at: new Date().toISOString() });

function harness(options = {}) {
  const connection = new WebSocketSidecarConnection({ createSocket: (url) => new FakeWebSocket(url), now: () => 42, ...options });
  const log = { statuses: [], events: [], diagnostics: [], failures: [] };
  connection.subscribeStatus((status) => log.statuses.push(status));
  connection.subscribe((value) => log.events.push(value));
  connection.subscribeDiagnostic((value) => log.diagnostics.push(value));
  connection.subscribeFailure((value) => log.failures.push(value));
  return { connection, log };
}

async function live(options) {
  const { connection, log } = harness(options);
  sequence = 0;
  const connecting = connection.connect(route, identity);
  const socket = lastSocket();
  socket.accept();
  socket.deliver(baselineEvent());
  await connecting;
  return { connection, log, socket };
}

// Handshake, events, diagnostics and commands.
{
  const { connection, log } = harness();
  sequence = 0;
  const connecting = connection.connect(route, identity);
  const socket = lastSocket();
  assert.equal(socket.url, route.sidecarEndpoint);
  assert.equal(socket.url.includes(route.sessionToken), false, "the token never goes in the URL");
  assert.equal(connection.getStatus(), "connecting");
  socket.accept();
  assert.equal(socket.sent.length, 1, "session.open is sent as soon as the socket opens");
  const open = parseSessionOpen(socket.sent[0]);
  assert.equal(open.ok, true);
  assert.equal(open.value.session_token, route.sessionToken);
  assert.deepEqual(open.value.minimap_schema_versions, [5]);
  assert.equal(connection.getStatus(), "baseline-required");
  await assert.rejects(connection.send({ kind: "command.chat.send", command_id: "early", scope: "team", body: "hi" }), /connection-not-live/, "no command before the baseline (the sidecar would close with 4000)");
  assert.equal(socket.sent.length, 1);
  socket.deliver(baselineEvent());
  await connecting;
  assert.equal(connection.getStatus(), "live");
  assert.deepEqual(log.statuses, ["connecting", "baseline-required", "live"]);

  socket.deliver(chat());
  assert.equal(log.events.at(-1).type, "chat.message");
  socket.deliver(event("minimap.init", { minimap_schema_version: 999 }));
  assert.equal(log.diagnostics.length, 1, "minimap payload errors become local diagnostics");
  assert.equal(log.diagnostics[0].kind, "incompatible-payload");
  assert.equal(log.diagnostics[0].receivedAtMs, 42);
  assert.equal(connection.getStatus(), "live");
  const eventsBefore = log.events.length;
  socket.deliver(event("future.event", { anything: true }));
  assert.equal(connection.getStatus(), "live", "an unknown event type is skipped without desynchronising");
  assert.equal(log.events.length, eventsBefore);
  socket.deliver(chat());
  assert.equal(log.events.at(-1).type, "chat.message", "events after an unknown type still arrive");
  socket.deliver({ ...chat(), sequence: 1 });
  assert.equal(connection.getStatus(), "live", "a stale sequence is ignored");

  const command = { kind: "command.shop.purchase", command_id: "buy-1", item_id: "GunE11SR", quantity: 1 };
  await connection.send(command);
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), command, "commands are bare v0 command frames");
  await assert.rejects(connection.send({ ...command, quantity: 0 }), /invalid-payload/);
  assert.equal(log.failures.length, 0);

  await connection.disconnect();
  assert.deepEqual(socket.closedWith?.code, 1000);
  assert.equal(connection.getStatus(), "offline");
  assert.equal(log.failures.length, 0, "a local disconnect is not a failure");
  const before = log.events.length;
  socket.deliver(chat());
  assert.equal(log.events.length, before, "a closed socket cannot reach the intake");
  await assert.rejects(connection.send(command), /connection-not-live/);
}

// client.features: kept across sessions, sent only while live, only on change.
{
  const { connection } = harness();
  sequence = 0;
  connection.setFeatures(["chat-input"]);
  const connecting = connection.connect(route, identity);
  const socket = lastSocket();
  socket.accept();
  assert.equal(socket.sent.length, 1, "features wait for the baseline (the sidecar would close with 4000)");
  socket.deliver(baselineEvent());
  await connecting;
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: "client.features", features: ["chat-input"] }, "the stored features follow the baseline");
  connection.setFeatures(["chat-input"]);
  assert.equal(socket.sent.length, 2, "an unchanged list is not resent");
  connection.setFeatures([]);
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: "client.features", features: [] }, "disabling withdraws the features");
  assert.throws(() => connection.setFeatures(["Chat Input"]), /kebab-case/);
  assert.equal(socket.sent.length, 3);

  socket.drop(1006);
  connection.setFeatures(["chat-input"]);
  const reconnecting = connection.connect(route, identity);
  const next = lastSocket();
  next.accept();
  next.deliver(baselineEvent());
  await reconnecting;
  assert.deepEqual(next.sent.map((frame) => JSON.parse(frame).type), ["session.open", "client.features"], "a new session reports the features set while offline");

  connection.setFeatures([]);
  await connection.disconnect();
  const quiet = connection.connect(route, identity);
  const empty = lastSocket();
  empty.accept();
  empty.deliver(baselineEvent());
  await quiet;
  assert.equal(empty.sent.length, 1, "an empty list is the sidecar default and is not sent");
  await connection.disconnect();
}

// Dev endpoint override.
{
  const { connection } = harness({ endpointOverride: "ws://127.0.0.1:7801/slgo/sidecar" });
  const connecting = connection.connect(route, identity);
  assert.equal(lastSocket().url, "ws://127.0.0.1:7801/slgo/sidecar");
  await connection.disconnect();
  await assert.rejects(connecting, SidecarConnectionError);
}

// Close codes after the session is live.
for (const [code, status, retry] of [
  [4000, "incompatible", "none"],
  [4002, "incompatible", "none"],
  [4001, "unauthorized", "backoff"],
  [4003, "stale", "reroute"],
  [1006, "offline", "backoff"],
  [1000, "offline", "backoff"],
]) {
  const { connection, log, socket } = await live();
  socket.drop(code, code === 4001 ? "Game connection address changed" : "");
  assert.equal(connection.getStatus(), status, `close ${code}`);
  assert.equal(log.statuses.at(-1), status, "status listeners hear the close");
  assert.equal(log.failures.length, 1, `close ${code} is reported once`);
  assert.equal(log.failures[0].status, status);
  assert.equal(log.failures[0].retry, retry);
  if (code === 4001) assert.ok(log.failures[0].detail.startsWith(SAME_CONNECTION_HINT), "4001 explains IP binding");
  if (code === 1006) assert.equal(log.failures[0].detail, "Sidecar connection lost");
  await assert.rejects(connection.send({ kind: "command.chat.send", command_id: "late", scope: "team", body: "hi" }), /connection-not-live/);
}

// Failures before the baseline reject connect() instead of reporting a failure.
for (const [when, code, status, retry, detail] of [
  ["before-open", 1006, "offline", "backoff", /unreachable/],
  ["after-open", 4001, "unauthorized", "backoff", new RegExp(SAME_CONNECTION_HINT)],
  ["after-open", 4003, "stale", "reroute", /instance/],
  ["after-open", 4002, "incompatible", "none", /Unsupported/],
]) {
  const { connection, log } = harness();
  const connecting = connection.connect(route, identity);
  const socket = lastSocket();
  if (when === "after-open") socket.accept();
  socket.drop(code, code === 4002 ? "Unsupported protocol version" : code === 4003 ? "Routed server instance is not available" : "");
  const error = await connecting.then(() => null, (value) => value);
  assert.ok(error instanceof SidecarConnectionError, `${when} ${code}`);
  assert.equal(error.failure.status, status);
  assert.equal(error.failure.retry, retry);
  assert.match(error.failure.detail, detail);
  assert.equal(connection.getStatus(), status);
  assert.equal(log.failures.length, 0);
}

// Timeouts close the socket.
{
  const { connection } = harness({ openTimeoutMs: 10 });
  const connecting = connection.connect(route, identity);
  const socket = lastSocket();
  const error = await connecting.then(() => null, (value) => value);
  assert.equal(error.failure.status, "offline");
  assert.equal(error.failure.retry, "backoff");
  assert.equal(socket.closedWith?.code, 1000);
}
{
  const { connection } = harness({ baselineTimeoutMs: 10 });
  const connecting = connection.connect(route, identity);
  const socket = lastSocket();
  socket.accept();
  const error = await connecting.then(() => null, (value) => value);
  assert.match(error.failure.detail, /baseline/);
  assert.equal(socket.closedWith?.code, 1000);
}

// A stream the intake rejects cannot recover on the same socket.
for (const [name, incoming, status, retry] of [
  ["wrong instance", () => event("chat.message", {}, { instance_id: "instance-other" }), "stale", "reroute"],
  ["unknown schema", () => ({ ...chat(), schema_version: 99 }), "incompatible", "none"],
  ["foreign viewer", () => event("minimap.positions", {
    minimap_schema_version: 5, map_id: "map-1", visibility_revision: 1,
    viewer: { player_id: "76561198000000001", team_id: "team-a", is_alive: true },
    viewpoint: null, scoreboard_visible: false, positions: [], commander_keycard: null,
  }), "unauthorized", "none"],
]) {
  const { connection, log, socket } = await live();
  socket.deliver(incoming());
  assert.equal(connection.getStatus(), status, name);
  assert.equal(log.failures.at(-1)?.retry, retry, name);
  assert.equal(socket.closedWith?.code, 1000, `${name}: the client closes the socket`);
}

// A newer connect replaces an older one; admission failures open no socket.
{
  const { connection } = harness();
  const first = connection.connect(route, identity);
  const firstSocket = lastSocket();
  const second = connection.connect(route, identity);
  assert.notEqual(lastSocket(), firstSocket);
  assert.equal(firstSocket.closedWith?.code, 1000);
  await assert.rejects(first, SidecarConnectionError);
  lastSocket().accept();
  lastSocket().deliver({ ...event("sidecar.baseline", { baseline: true }), sequence: 1 });
  await second;
  assert.equal(connection.getStatus(), "live");
  await connection.disconnect();

  const sockets = FakeWebSocket.instances.length;
  const expired = await connection.connect({ ...route, expiresAt: new Date(Date.now() - 1).toISOString() }, identity).then(() => null, (value) => value);
  assert.equal(expired.failure.status, "stale");
  assert.equal(expired.failure.retry, "reroute");
  const mismatch = await connection.connect(route, { steamId: "76561198000000001" }).then(() => null, (value) => value);
  assert.equal(mismatch.failure.status, "unauthorized");
  assert.equal(FakeWebSocket.instances.length, sockets, "a refused route opens no socket");
}

// ---- Session retry policy -------------------------------------------------

assert.equal(retryDelayMs("none", 1), null);
assert.deepEqual([1, 2, 3].map((n) => retryDelayMs("reroute", n)), [1_000, 2_000, 4_000]);
assert.deepEqual([1, 2, 5, 6, 20].map((n) => retryDelayMs("backoff", n)), [3_000, 6_000, 48_000, 60_000, 60_000]);
assert.deepEqual([1, 6, 100].map((n) => retryDelayMs("poll", n)), [5_000, 5_000, 5_000], "waiting for a server never backs off");
assert.equal(nextFailureCount(3, null, 1_000_000), 4);
assert.equal(nextFailureCount(3, 0, 59_999), 4, "a short live period does not reset the backoff");
assert.equal(nextFailureCount(3, 0, 60_000), 1, "a stable session starts the backoff over");
{
  const failed = clientSessionReducer({ ...initialClientSessionState, attempt: 1 }, { type: "failed", attempt: 1, status: "offline", detail: "x", retry: "backoff" });
  assert.equal(failed.retry, "backoff");
  assert.equal(clientSessionReducer(failed, { type: "failed", attempt: 1, status: "offline", detail: "x" }).retry, "none");
  assert.equal(clientSessionReducer(failed, { type: "discover", attempt: 2 }).retry, null);
}

const sessionDependencies = (controlPlane, connection) => ({
  identity: { getCurrentUser: async () => identity },
  proof: { getProof: async () => localProof, isVerified: () => false },
  controlPlane,
  connection,
});
async function attempt(dependencies, drive) {
  const actions = [];
  let state = initialClientSessionState;
  const running = runClientSessionAttempt(dependencies, 1, {
    dispatch: (action) => { actions.push(action); state = clientSessionReducer(state, action); },
    onEvent: () => undefined,
    isCurrent: () => true,
  });
  if (drive) {
    const sockets = FakeWebSocket.instances.length;
    for (let tick = 0; FakeWebSocket.instances.length === sockets; tick += 1) {
      assert.ok(tick < 100, "the session opens a sidecar socket");
      await flush();
    }
    drive(lastSocket());
  }
  const cleanup = await running;
  return { actions, cleanup, state: () => state };
}

{
  const { state } = await attempt(sessionDependencies({ resolveActiveServer: async () => { throw new Error("Control plane is unreachable: fetch failed"); } }, harness().connection));
  assert.equal(state().status, "offline");
  assert.equal(state().retry, "backoff", "an unreachable control plane is retried");
  assert.match(state().detail, /unreachable/);
}
{
  const { state } = await attempt(sessionDependencies(answer(404, rejection("not-in-game")), harness().connection));
  assert.equal(state().status, "not-in-game", "not being on a server yet is waiting, not a failure");
  assert.equal(state().retry, "poll");
}
{
  const { state } = await attempt(sessionDependencies(answer(400, rejection("unsupported-protocol")), harness().connection));
  assert.equal(state().status, "incompatible");
  assert.equal(state().retry, "none");
}
{
  const { connection } = harness();
  sequence = 0;
  const { state, cleanup } = await attempt(sessionDependencies(answer(200, routeBody()), connection), (socket) => {
    socket.accept();
    socket.deliver(baselineEvent());
  });
  assert.equal(state().status, "live");
  assert.equal(state().retry, null);
  lastSocket().drop(4003, "Server instance ended");
  assert.equal(state().status, "stale");
  assert.equal(state().retry, "reroute", "4003 resolves a new route");
  assert.equal(state().detail, "Server instance ended");
  cleanup();
}
{
  const { state } = await attempt(sessionDependencies(answer(200, routeBody()), harness().connection), (socket) => {
    socket.accept();
    socket.drop(4001, "Client address does not match the game connection");
  });
  assert.equal(state().status, "unauthorized");
  assert.equal(state().retry, "backoff");
  assert.ok(state().detail.startsWith(SAME_CONNECTION_HINT));
}

console.log("backend connection smoke: config, control plane, sidecar handshake/close codes/timeouts and retry policy ok");
