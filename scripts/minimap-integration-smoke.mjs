import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `export * from "./src/platform/connection.ts";
    export * from "./src/app/clientSession.ts";
    export * from "./src/features/minimap/model.ts";
    export * from "./src/features/minimap/resolver.ts";`, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { MockSidecarConnection, runClientSessionAttempt, clientSessionReducer, initialClientSessionState,
  minimapReducer, initialMinimapState, selectMinimap, resolveMinimapSync, mapDescriptorKey } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const readFixture = (name) => JSON.parse(readFileSync(new URL(`../packages/protocol/v0/${name}.example.json`, import.meta.url), "utf8"));
const initEvent = readFixture("minimap-init");
const init = initEvent.payload;
const first = readFixture("minimap-positions").payload;
const self = first.positions[0];
const teammate = { ...self, player_id: "76561198000000002", visibility: "teammate", x: 150, zone: "Entrance" };
const teammate2 = { ...teammate, player_id: "76561198000000003", x: 165 };
const enemy = { ...self, player_id: "76561198000000004", team_id: "team-b", role: "scp", visibility: "spotted-by-teammate", z: 90 };
const enemy2 = { ...enemy, player_id: "76561198000000005", x: 120 };
const frame = { ...first, positions: [self, teammate, teammate2, enemy, enemy2] };
const pose = ({ player_id, x, y, z, yaw_degrees, zone, room_id }) => ({ player_id, x, y, z, yaw_degrees, zone, room_id });
const identity = { steamId: self.player_id };
const route = { protocolVersion: 0, identityMode: "device-signature", steamId: identity.steamId,
  serverId: initEvent.server_id, instanceId: initEvent.instance_id, sidecarEndpoint: "wss://mock.sidecar.invalid",
  sessionToken: "fixture-only", expiresAt: new Date(Date.now() + 60_000).toISOString() };

async function createSession() {
  let now = 100;
  let sequence = 0;
  let current = true;
  let state = initialMinimapState;
  let session = initialClientSessionState;
  const connection = new MockSidecarConnection([], () => now);
  const diagnostics = [];
  const events = [];
  const dispatch = (action) => { state = minimapReducer(state, action); };
  const unsubscribe = await runClientSessionAttempt({
    identity: { getCurrentUser: async () => identity },
    proof: { getProof: async () => ({ kind: "device-signature", deviceId: "fixture", signature: "fixture" }), isVerified: () => true },
    controlPlane: { resolveActiveServer: async () => ({ ok: true, value: route }) }, connection,
  }, 1, {
    dispatch: (action) => { session = clientSessionReducer(session, action); },
    onEvent: (event) => { events.push(event); dispatch({ type: "event", event, receivedAtMs: now }); },
    onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); dispatch({ type: "diagnostic", diagnostic }); },
    onStatus: (status) => dispatch({ type: "connection", status }),
    isCurrent: () => current,
  });
  const send = (type, payload, extras = {}) => connection.receive({ ...initEvent,
    sequence: ++sequence, event_id: `integration-${sequence}`, type, payload, ...extras });
  const resolveAction = () => ({ type: "resolved", token: state.requestToken,
    descriptorKey: mapDescriptorKey(state.init), geometry: resolveMinimapSync(state.init), nowMs: now });
  return {
    connection, diagnostics, events, send, dispatch, resolveAction,
    get state() { return state; }, get session() { return session; },
    view: (preferences) => selectMinimap(state, now, preferences),
    advance: (ms) => { now += ms; },
    resolve: () => dispatch(resolveAction()),
    start: () => { assert.equal(send("sidecar.baseline", { baseline: true }).ok, true); assert.equal(send("minimap.init", init).ok, true); },
    invalidateAttempt: () => { current = false; },
    close: async () => { unsubscribe(); await connection.disconnect(); },
  };
}

const harness = await createSession();
try {
  for (const payload of [{ baseline: false }, {}, { baseline: true, extra: true }]) {
    assert.equal(harness.send("sidecar.baseline", payload).error.code, "invalid-payload");
    assert.equal(harness.send("minimap.init", init).error.code, "baseline-required");
    assert.equal(harness.state.baselineAccepted, false);
    assert.equal(harness.state.init, null);
    assert.equal(harness.events.length, 0, "invalid baselines cannot publish map eligibility through a real session");
  }
  harness.start();
  harness.resolve();
  harness.dispatch({ type: "focus", focused: true, revision: 1 });
  assert.equal(harness.send("minimap.positions", frame).ok, true);
  assert.equal(harness.send("minimap.positions", { ...frame, scoreboard_visible: true }).ok, true);
  assert.equal(harness.view().markers.length, 5);
  assert.equal(harness.view().fullMap, true);
  const geometry = harness.state.geometry;
  assert.equal(harness.send("minimap.positions", { ...frame, positions: [self, { ...enemy, visibility: ["spotted-by-self"] }] }).ok, false);
  assert.equal(harness.view().markers.length, 0, "invalid wire frame clears existing rendered markers through adapter/session callbacks");
  assert.equal(harness.view().fullMap, false);
  assert.equal(harness.state.geometry, geometry);
  assert.equal(harness.state.availability, "invalid");
  assert.equal(harness.session.status, "live");
  assert.deepEqual(Object.keys(harness.diagnostics.at(-1)).sort(), ["eventId", "eventType", "feature", "instanceId", "kind", "receivedAtMs", "roundId", "sequence", "serverId"]);
  assert.equal(harness.send("minimap.positions", frame).ok, true);
  const recovered = harness.state;
  harness.advance(500);
  assert.equal(harness.send("minimap.positions", { ...frame, minimap_schema_version: 99 }, { sequence: recovered.sequence - 1 }).error.code, "stale-sequence");
  assert.equal(harness.state, recovered, "old malformed frames neither clear markers nor refresh receipt time");

  const death = { ...frame, visibility_revision: frame.visibility_revision + 1,
    viewer: { ...frame.viewer, is_alive: false }, positions: [teammate, teammate2, enemy, enemy2], viewpoint: pose(teammate) };
  assert.equal(harness.send("minimap.positions", death).ok, true);
  assert.equal(harness.view().markers.length, 4);
  assert.equal(harness.send("minimap.positions", { ...death, viewpoint: pose(teammate2) }).ok, true);
  assert.equal(harness.view().markers.length, 4, "changing observed teammate preserves both shared enemies");
  assert.equal(harness.send("minimap.positions", { ...death, viewpoint: null }).ok, true);
  assert.equal(harness.view({ orientation: "heading-up" }).camera.yaw, 0);
  assert.equal(harness.view().markers.length, 4);
  assert.equal(harness.view().availability, "waiting-viewpoint");
  harness.send("minimap.positions", { ...death, scoreboard_visible: true });
  assert.equal(harness.view().fullMap, true);
  harness.dispatch({ type: "focus", focused: false, revision: 2 });
  harness.dispatch({ type: "focus", focused: true, revision: 3 });
  harness.send("minimap.positions", { ...death, scoreboard_visible: true });
  assert.equal(harness.view().fullMap, false);
  harness.send("minimap.positions", death);
  harness.send("minimap.positions", { ...death, scoreboard_visible: true });
  assert.equal(harness.view().fullMap, true);
  harness.advance(1001);
  assert.equal(harness.send("shop.snapshot", { balance: 50, window_open: true, items: [] }).ok, true);
  assert.equal(harness.view().markers.length, 0, "other live feature traffic cannot extend minimap freshness");
  harness.send("minimap.positions", { ...death, scoreboard_visible: true });
  assert.equal(harness.view().fullMap, false, "a stale gap must rearm scoreboard even without a timer tick");

  const removed = { ...death, visibility_revision: death.visibility_revision + 1, positions: [teammate, teammate2] };
  harness.send("minimap.positions", removed);
  assert.equal(harness.view().markers.length, 2);
  harness.send("minimap.positions", death);
  assert.equal(harness.view().markers.length, 0, "revision rollback clears the displayed frame");
  harness.send("minimap.positions", removed);
  assert.equal(harness.view().markers.length, 2);
  harness.send("minimap.positions", removed, { round_id: "old-round" });
  assert.equal(harness.view().markers.length, 0, "positions from another round cannot render on this map");
  harness.send("minimap.positions", removed);
  harness.send("minimap.positions", { ...removed, map_id: "old-map" });
  assert.equal(harness.view().markers.length, 0);
  harness.send("minimap.positions", removed);

  harness.send("minimap.init", { ...init, minimap_schema_version: 99 });
  assert.equal(harness.state.init, null);
  assert.equal(harness.view().availability, "incompatible");
  assert.equal(harness.session.status, "live");
  harness.send("minimap.positions", frame);
  assert.equal(harness.view().markers.length, 0, "compatible positions alone cannot recover an incompatible init");
  assert.equal(harness.view().availability, "incompatible", "ongoing positions do not hide the initialization error");
  assert.equal(harness.send("shop.snapshot", { balance: 100, window_open: false, items: [] }).ok, true);
  harness.send("minimap.init", init);
  const oldResolution = harness.resolveAction();
  const rebuilt = { ...init, map_id: "rebuilt-map" };
  harness.send("minimap.init", rebuilt);
  harness.dispatch(oldResolution);
  assert.equal(harness.state.geometry, null, "old resolver completion cannot restore a previous map identity");
  const invalidPending = { ...frame, map_id: rebuilt.map_id, visibility_revision: 999,
    positions: [self, { ...enemy, room_id: "unknown-room" }] };
  harness.send("minimap.positions", invalidPending);
  assert.equal(harness.state.visibilityRevision, -1, "unvalidated queued frames grant no authorization version");
  harness.resolve();
  assert.equal(harness.view().availability, "invalid");
  harness.send("minimap.positions", { ...frame, map_id: rebuilt.map_id });
  assert.equal(harness.view().markers.length, 5, "invalid loading frame cannot block a valid lower revision");
  harness.send("minimap.init", { ...rebuilt, seed: 1 });
  assert.equal(harness.view().availability, "incompatible", "physical map identity cannot silently change its generator descriptor");

  harness.send("minimap.init", rebuilt);
  harness.resolve();
  harness.send("minimap.positions", { ...frame, map_id: rebuilt.map_id });
  assert.equal(harness.send("minimap.positions", frame, { instance_id: "other-instance" }).error.code, "wrong-instance");
  assert.equal(harness.state.baselineAccepted, false);
  assert.equal(harness.view().markers.length, 0);
  assert.equal(harness.send("minimap.init", init).error.code, "baseline-required");
  harness.start();
  harness.resolve();
  harness.send("minimap.positions", frame);
  const unauthorized = { ...frame, viewer: { ...frame.viewer, player_id: teammate.player_id }, viewpoint: null, positions: [] };
  assert.equal(harness.send("minimap.positions", unauthorized).error.code, "unauthorized");
  assert.equal(harness.session.status, "unauthorized");
  assert.equal(harness.view().markers.length, 0);
  assert.equal(harness.state.geometry, null);
  assert.equal(harness.send("sidecar.baseline", { baseline: true }).ok, false, "revoked identity needs a new authenticated connection");
} finally { await harness.close(); }

const oldSession = await createSession();
try {
  oldSession.start(); oldSession.resolve(); oldSession.send("minimap.positions", frame);
  const state = oldSession.state;
  const session = oldSession.session;
  oldSession.invalidateAttempt();
  oldSession.send("minimap.positions", { ...frame, all_players: [] });
  oldSession.send("minimap.positions", frame);
  await oldSession.connection.disconnect();
  assert.equal(oldSession.state, state, "obsolete attempts suppress event, diagnostic and status callbacks");
  assert.equal(oldSession.session, session);
} finally { await oldSession.close(); }

console.log("Minimap integration smoke passed (adapter -> session -> reducer: invalid baseline/frame, local compatibility, source/map/round, revision, loading, death, focus, stale, authorization and old attempts).");
