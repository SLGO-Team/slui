// Real backend adapters against fakes: HttpControlPlane (fake fetch),
// WebSocketSidecarConnection (fake WebSocket), backend config and the
// session retry policy. No network access.
import assert from "node:assert/strict";
import { parseRouteRequest, parseSessionOpen } from "../src/contracts/index.ts";
import { readBackendConfig } from "../src/platform/backend.ts";
import { SAME_CONNECTION_HINT, SidecarConnectionError, WebSocketSidecarConnection } from "../src/platform/connection.ts";
import { createGameLogProofReader } from "../src/platform/gameLog.ts";
import { TauriSidecarSocket } from "../src/platform/sidecarSocket.ts";
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

// Game-log proof: offered only with a reader; a challenge is answered from the log after the mark.
const challengeFrame = { protocol_version: 0, schema_version: 1, type: "session.challenge", method: "game-log", challenge_id: "q8Zc1rT0aXw", expires_in_ms: 15000 };
{
  const { connection } = harness();
  const connecting = connection.connect(route, identity);
  const socket = lastSocket();
  socket.accept();
  assert.equal(parseSessionOpen(socket.sent[0]).value.proofs, undefined, "without a reader no proof is offered");
  socket.deliver(baselineEvent());
  await connecting;
}
{
  const calls = [];
  const gameLogProof = {
    mark: async () => { calls.push("mark"); return 1234; },
    find: async (mark, challengeId, timeoutMs) => { calls.push({ mark, challengeId, timeoutMs }); return "Vb3kN9sQ2LmP7xYt0cRw4e"; },
  };
  const { connection, log } = harness({ gameLogProof });
  sequence = 0;
  const connecting = connection.connect(route, identity);
  assert.deepEqual(calls, ["mark"], "the log is marked before the socket opens, so before session.open");
  const socket = lastSocket();
  socket.accept();
  assert.deepEqual(parseSessionOpen(socket.sent[0]).value.proofs, ["game-log"]);
  socket.deliver(challengeFrame);
  await flush();
  await flush();
  assert.deepEqual(calls[1], { mark: 1234, challengeId: "q8Zc1rT0aXw", timeoutMs: 15000 });
  assert.deepEqual(JSON.parse(socket.sent[1]), { type: "session.proof", challenge_id: "q8Zc1rT0aXw", response: "Vb3kN9sQ2LmP7xYt0cRw4e" });
  assert.deepEqual(log.events, [], "the challenge is a handshake frame, not an event");
  socket.deliver(baselineEvent());
  await connecting;
  assert.equal(connection.getStatus(), "live");
}
{
  const { connection } = harness({ gameLogProof: { mark: async () => 0, find: async () => null } });
  const connecting = connection.connect(route, identity);
  const socket = lastSocket();
  socket.accept();
  socket.deliver(challengeFrame);
  await flush();
  await flush();
  assert.equal(socket.sent.length, 1, "nothing to answer when the line never appears");
  socket.drop(4001, "Game log proof timed out");
  await assert.rejects(connecting, (error) => error instanceof SidecarConnectionError && error.failure.status === "unauthorized" && error.failure.detail.startsWith(SAME_CONNECTION_HINT));
}
{
  let gameLog = "[FROM SERVER] SLGO-PROOF q8Zc1rT0aXw OLDOLDOLDOLDOLDOLDOLD00\n";
  // Like game_log_read: complete lines only, a rewritten (shorter) log from the start.
  const source = {
    size: async () => gameLog.length,
    read: async (offset) => {
      const start = offset > gameLog.length ? 0 : offset;
      const end = gameLog.lastIndexOf("\n") + 1;
      return end > start ? { offset: end, text: gameLog.slice(start, end) } : { offset: start, text: "" };
    },
  };
  let clock = 0;
  const reader = createGameLogProofReader(source, {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      if (clock === 200) gameLog += "[FROM SERVER] 初始资金 +$800\r\n[FROM SERVER] SLGO-PROOF q8Zc1rT0aXw Vb3kN9sQ2LmP7xYt0cRw4e\r\n";
    },
  });
  const mark = await reader.mark();
  assert.equal(await reader.find(mark, "q8Zc1rT0aXw", 1000), "Vb3kN9sQ2LmP7xYt0cRw4e", "lines before the mark are not searched");
  assert.equal(await reader.find(gameLog.length, "q8Zc1rT0aXw", 300), null, "nothing new within the time limit");
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
  assert.deepEqual(open.value.minimap_schema_versions, [6]);
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
  [4003, "ended", "reroute"],
  [4004, "not-in-game", "poll"],
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
  if (code === 4004) assert.equal(log.failures[0].detail, "Player is not on this server", "4004 is waiting, not an IP-binding refusal");
  await assert.rejects(connection.send({ kind: "command.chat.send", command_id: "late", scope: "team", body: "hi" }), /connection-not-live/);
}

// Failures before the baseline reject connect() instead of reporting a failure.
for (const [when, code, status, retry, detail] of [
  ["before-open", 1006, "offline", "backoff", /unreachable/],
  ["after-open", 4001, "unauthorized", "backoff", new RegExp(SAME_CONNECTION_HINT)],
  ["after-open", 4003, "ended", "reroute", /instance/],
  ["after-open", 4004, "not-in-game", "poll", /not on this server/],
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
    minimap_schema_version: 6, map_id: "map-1", visibility_revision: 1,
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

// ---- Rust sidecar socket (Tauri) -------------------------------------------

// Fake Rust commands: records every call in order and lets the test play the sidecar.
function fakeSidecarIpc({ openFails = false } = {}) {
  const ipc = {
    calls: [],
    onEvent: null,
    async open(url, onEvent) {
      ipc.calls.push(["open", url]);
      if (openFails) throw new Error("Unsupported sidecar endpoint scheme http");
      ipc.onEvent = onEvent;
      return 7;
    },
    async send(id, data) { ipc.calls.push(["send", id, data]); },
    async close(id, code, reason) { ipc.calls.push(["close", id, code, reason]); },
  };
  return ipc;
}

function tauriHarness(ipc) {
  return harness({ createSocket: (url) => new TauriSidecarSocket(url, ipc) });
}

// The connection runs unchanged over the Rust socket: handshake, commands in order, local close.
{
  const ipc = fakeSidecarIpc();
  const { connection, log } = tauriHarness(ipc);
  sequence = 0;
  connection.setFeatures(["chat-input"]);
  const connecting = connection.connect(route, identity);
  await flush();
  assert.deepEqual(ipc.calls, [["open", route.sidecarEndpoint]]);
  ipc.onEvent({ kind: "open" });
  ipc.onEvent({ kind: "message", data: JSON.stringify(baselineEvent()) });
  await connecting;
  assert.equal(connection.getStatus(), "live");
  await connection.send({ kind: "command.chat.send", command_id: "c-1", scope: "team", body: "one" });
  await connection.send({ kind: "command.chat.send", command_id: "c-2", scope: "team", body: "two" });
  ipc.onEvent({ kind: "message", data: JSON.stringify(chat()) });
  assert.equal(log.events.at(-1).type, "chat.message");
  await connection.disconnect();
  await flush();
  const sent = ipc.calls.filter(([kind]) => kind === "send").map(([, id, data]) => [id, JSON.parse(data)]);
  assert.equal(sent[0][1].type, "session.open", "session.open goes first");
  assert.equal(sent[0][1].session_token, route.sessionToken);
  assert.deepEqual(sent.slice(1).map(([id, frame]) => [id, frame.type ?? frame.command_id]), [[7, "client.features"], [7, "c-1"], [7, "c-2"]], "frames keep their order");
  assert.deepEqual(ipc.calls.at(-1), ["close", 7, 1000, "SLUI closed the session"]);
  const before = log.events.length;
  ipc.onEvent({ kind: "message", data: JSON.stringify(chat()) });
  ipc.onEvent({ kind: "close", code: 1000, reason: "" });
  assert.equal(log.events.length, before, "nothing arrives after a local close");
  assert.equal(log.failures.length, 0);
}

// Close codes from Rust map exactly like browser close codes.
for (const [code, status, retry] of [[4001, "unauthorized", "backoff"], [4003, "ended", "reroute"], [4004, "not-in-game", "poll"], [1006, "offline", "backoff"]]) {
  const ipc = fakeSidecarIpc();
  const { connection, log } = tauriHarness(ipc);
  sequence = 0;
  const connecting = connection.connect(route, identity);
  await flush();
  ipc.onEvent({ kind: "open" });
  ipc.onEvent({ kind: "message", data: JSON.stringify(baselineEvent()) });
  await connecting;
  ipc.onEvent({ kind: "close", code, reason: "" });
  assert.equal(connection.getStatus(), status, `rust close ${code}`);
  assert.equal(log.failures.at(-1).retry, retry);
}

// A socket Rust refuses to open (or that never connects) reports 1006: unreachable, retry with backoff.
{
  const { connection } = tauriHarness(fakeSidecarIpc({ openFails: true }));
  const originalError = console.error;
  console.error = () => undefined;
  const error = await connection.connect(route, identity).then(() => null, (value) => value).finally(() => { console.error = originalError; });
  assert.ok(error instanceof SidecarConnectionError);
  assert.equal(error.failure.status, "offline");
  assert.equal(error.failure.retry, "backoff");
  assert.match(error.failure.detail, /unreachable/);
}
{
  const ipc = fakeSidecarIpc();
  const { connection } = tauriHarness(ipc);
  const connecting = connection.connect(route, identity);
  await flush();
  ipc.onEvent({ kind: "close", code: 1006, reason: "" });
  const error = await connecting.then(() => null, (value) => value);
  assert.match(error.failure.detail, /unreachable/);
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
async function attempt(dependencies, drive, { initial = initialClientSessionState, quiet = false, gameRunning = true } = {}) {
  const actions = [];
  const statuses = [];
  let state = initial;
  const states = [];
  const running = runClientSessionAttempt(dependencies, initial.attempt + 1, {
    dispatch: (action) => { actions.push(action); state = clientSessionReducer(state, action); states.push(state); },
    onEvent: () => undefined,
    onStatus: (status) => statuses.push(status),
    isCurrent: () => true,
  }, quiet, gameRunning);
  if (drive) {
    const sockets = FakeWebSocket.instances.length;
    for (let tick = 0; FakeWebSocket.instances.length === sockets; tick += 1) {
      assert.ok(tick < 100, "the session opens a sidecar socket");
      await flush();
    }
    drive(lastSocket());
  }
  const cleanup = await running;
  return { actions, cleanup, state: () => state, states, statuses };
}

// A closed game ends the session: only the local Steam identity is read, nothing is routed or retried.
{
  const routed = [];
  const controlPlane = { resolveActiveServer: async () => { routed.push(true); throw new Error("must not route"); } };
  const live = { ...initialClientSessionState, status: "live", identity, attempt: 3 };
  const { actions, state, statuses } = await attempt(sessionDependencies(controlPlane, harness().connection), null, { initial: live, gameRunning: false });
  assert.deepEqual(actions.map((action) => action.type), ["game-not-running"], "no discover step, so home never flashes");
  assert.equal(routed.length, 0, "no control-plane request while the game is closed");
  assert.equal(state().status, "game-not-running");
  assert.deepEqual(state().identity, identity, "the Steam tile keeps the account");
  assert.equal(state().retry, null, "nothing is scheduled; the game starting begins the next attempt");
  assert.deepEqual(statuses, ["game-not-running"], "features hear the end of the match");
}
{
  const failing = { ...sessionDependencies(answer(404, rejection("not-in-game")), harness().connection), identity: { getCurrentUser: async () => { throw new Error("registry"); } } };
  const { state } = await attempt(failing, null, { gameRunning: false });
  assert.equal(state().status, "game-not-running", "a closed game wins over an unreadable identity");
  assert.equal(state().identity, null);
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
  // The player left the server: the sidecar closes with 4004 and the session waits for the next one.
  const { connection } = harness();
  sequence = 0;
  const { state, cleanup } = await attempt(sessionDependencies(answer(200, routeBody()), connection), (socket) => {
    socket.accept();
    socket.deliver(baselineEvent());
  });
  lastSocket().drop(4004, "Player left the server");
  assert.equal(state().status, "not-in-game", "leaving the server is waiting, not unauthorized");
  assert.equal(state().retry, "poll");
  cleanup();
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
  // The plugin said goodbye (server shutdown): the sidecar ends the instance and closes with 4003.
  lastSocket().drop(4003, "Server instance ended");
  assert.equal(state().status, "ended");
  assert.equal(state().retry, "reroute", "4003 resolves a new route");
  assert.equal(state().detail, "Server instance ended");
  assert.equal(state().endReason, null, "an older sidecar sends no reason");
  cleanup();
}
{
  // instance.ended precedes the 4003 close and names the reason.
  const { connection } = harness();
  sequence = 0;
  const { state, cleanup } = await attempt(sessionDependencies(answer(200, routeBody()), connection), (socket) => {
    socket.accept();
    socket.deliver(baselineEvent());
  });
  lastSocket().deliver(event("instance.ended", { reason: "server-shutdown" }, { round_id: null }));
  assert.equal(state().status, "live", "the reason alone does not end the session");
  lastSocket().drop(4003, "Server instance ended");
  assert.equal(state().status, "ended");
  assert.equal(state().endReason, "server-shutdown");
  cleanup();
}
{
  // An unknown reason from a newer sidecar keeps the stream and reads as unspecified.
  const { connection } = harness();
  sequence = 0;
  const { state, cleanup } = await attempt(sessionDependencies(answer(200, routeBody()), connection), (socket) => {
    socket.accept();
    socket.deliver(baselineEvent());
  });
  lastSocket().deliver(event("instance.ended", { reason: "a-future-reason" }, { round_id: null }));
  assert.equal(state().status, "live");
  lastSocket().drop(4003, "Server instance ended");
  assert.equal(state().endReason, null);
  cleanup();
}
{
  // The reason outlives the reroute: a bare 4003 and "not in game" are the same end, a live session clears it.
  const ended = { ...initialClientSessionState, status: "ended", identity, detail: "Server instance ended", attempt: 1, retry: "reroute", endReason: "server-restart" };
  const refused = clientSessionReducer(ended, { type: "failed", attempt: 2, status: "ended", detail: "Routed server instance is not available", retry: "reroute" });
  assert.equal(refused.endReason, "server-restart", "a refused reroute keeps the reason");
  const away = clientSessionReducer(refused, { type: "failed", attempt: 3, status: "not-in-game", detail: "No server", retry: "poll" });
  assert.equal(away.status, "ended", "not in game after an end keeps showing the end");
  assert.equal(away.endReason, "server-restart");
  assert.equal(away.retry, "poll");
  const syncing = clientSessionReducer(away, { type: "connection-status", attempt: 4, status: "baseline-required" });
  assert.equal(syncing.endReason, "server-restart", "progress towards the next instance keeps it");
  assert.equal(clientSessionReducer(syncing, { type: "connection-status", attempt: 4, status: "live" }).endReason, null, "live clears it");
  assert.equal(clientSessionReducer(away, { type: "failed", attempt: 4, status: "offline", detail: "x", retry: "backoff" }).endReason, null, "another failure clears it");
  assert.equal(clientSessionReducer(away, { type: "discover", attempt: 4 }).endReason, null, "a manual retry clears it");
  assert.equal(clientSessionReducer(away, { type: "discover", attempt: 4, quiet: true }).endReason, "server-restart", "a background retry keeps it");
  const bare = clientSessionReducer({ ...ended, endReason: null }, { type: "failed", attempt: 2, status: "not-in-game", detail: "No server", retry: "poll" });
  assert.equal(bare.status, "not-in-game", "without a reason the session waits as before");
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
{
  // A background retry keeps the card on its last outcome instead of flashing through the progress steps.
  const waiting = { status: "not-in-game", identity, detail: "Join a server first", attempt: 1, retry: "poll", endReason: null };
  const polled = await attempt(sessionDependencies(answer(404, rejection("not-in-game")), harness().connection), undefined, { initial: waiting, quiet: true });
  assert.deepEqual([...new Set(polled.states.map((state) => state.status))], ["not-in-game"], "polling never leaves the waiting state");
  assert.ok(polled.states.every((state) => state.identity === identity), "polling keeps the Steam account shown");
  assert.equal(polled.states[0].retry, null, "a retry in flight schedules no other");
  assert.equal(polled.state().attempt, 2);
  assert.equal(polled.state().retry, "poll");

  const offline = { status: "offline", identity, detail: "Sidecar is unreachable", attempt: 1, retry: "backoff", endReason: null };
  const reconnect = await attempt(sessionDependencies(answer(200, routeBody()), harness().connection), (socket) => socket.drop(1006, ""), { initial: offline, quiet: true });
  assert.deepEqual([...new Set(reconnect.states.map((state) => state.status))], ["offline"], "a failed background reconnect never shows connecting");
  assert.equal(reconnect.state().retry, "backoff");

  const manual = await attempt(sessionDependencies(answer(404, rejection("not-in-game")), harness().connection), undefined, { initial: waiting });
  assert.deepEqual(manual.states.map((state) => state.status), ["discovering", "route-pending", "not-in-game"], "a manual retry shows its progress");
}

console.log("backend connection smoke: config, control plane, sidecar handshake/close codes/timeouts, Rust socket adapter and retry policy ok");
