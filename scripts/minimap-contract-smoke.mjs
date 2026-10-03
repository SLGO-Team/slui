import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnvelope, parseEvent, parseMinimapInit, parseMinimapPositions } from "../src/contracts/index.ts";
import { MockSidecarConnection } from "../src/platform/connection.ts";
import { clientSessionReducer, initialClientSessionState, runClientSessionAttempt } from "../src/app/clientSession.ts";

const initExample = JSON.parse(readFileSync(new URL("../packages/protocol/v0/minimap-init.example.json", import.meta.url), "utf8"));
const frameExample = JSON.parse(readFileSync(new URL("../packages/protocol/v0/minimap-positions.example.json", import.meta.url), "utf8"));
assert.equal(parseEvent(initExample).ok, true, "public init example matches runtime contract");
assert.equal(parseEvent(frameExample).ok, true, "public frame example matches runtime contract");
const init = initExample.payload;
const frame = frameExample.payload;
const self = frame.positions[0];
const teammate = { ...self, player_id: "76561198000000002", visibility: "teammate", x: 150, zone: "Entrance" };
const teammate2 = { ...teammate, player_id: "76561198000000003", x: 165 };
const enemy = { ...self, player_id: "76561198000000004", team_id: "team-b", role: "scp", visibility: "spotted-by-teammate", z: 90 };
const enemy2 = { ...enemy, player_id: "76561198000000005", x: 120 };
const poseOf = ({ player_id, x, y, z, yaw_degrees, zone, room_id }) => ({ player_id, x, y, z, yaw_degrees, zone, room_id });
const sharedFrame = { ...frame, positions: [self, teammate, teammate2, enemy, enemy2] };
assert.equal(parseMinimapPositions(sharedFrame).ok, true);
const deadFrame = { ...sharedFrame, viewer: { ...frame.viewer, is_alive: false }, positions: [teammate, teammate2, enemy, enemy2], viewpoint: poseOf(teammate) };
assert.equal(parseMinimapPositions(deadFrame).ok, true, "death retains all teammate-provided enemies");
assert.equal(parseMinimapPositions({ ...deadFrame, viewpoint: poseOf(teammate2) }).ok, true, "spectating switch does not narrow shared visibility");
assert.equal(parseMinimapPositions({ ...deadFrame, viewpoint: null }).ok, true, "null viewpoint retains shared visibility");
assert.equal(parseMinimapPositions({ ...frame, positions: [], viewpoint: null }).ok, true, "complete frame may revoke all markers");
assert.equal(parseMinimapPositions({ ...frame, viewer: { ...frame.viewer, team_id: null }, positions: [], viewpoint: null }).ok, true);
const lastKnown = { ...enemy, player_id: "76561198000000006", status: "last-known", status_age_ms: 5999 };
const deadEnemy = { ...enemy2, player_id: "76561198000000007", visibility: "spotted-by-self", status: "dead", status_age_ms: 3999 };
const deadTeammate = { ...teammate2, player_id: "76561198000000008", status: "dead", status_age_ms: 0 };
assert.equal(parseMinimapPositions({ ...frame, positions: [self, lastKnown, deadEnemy, deadTeammate] }).ok, true, "v3 last-known and death markers");
assert.equal(parseMinimapPositions({ ...deadFrame, positions: [{ ...self, status: "dead", status_age_ms: 10 }, teammate, lastKnown] }).ok, true,
  "dead viewer keeps own death marker and team last-known markers");
const observedEnemy = { ...enemy, visibility: "observed" };
const observedDead = { ...enemy2, visibility: "observed", status: "dead", status_age_ms: 100 };
assert.equal(parseMinimapPositions({ ...deadFrame, positions: [teammate, observedEnemy, observedDead], viewpoint: poseOf(observedEnemy) }).ok, true,
  "a dead viewer with observation rights follows an observed opponent");
const spectatorViewer = { ...frame.viewer, team_id: null, is_alive: false };
const observedFriendly = { ...teammate, visibility: "observed" };
assert.equal(parseMinimapPositions({ ...frame, viewer: spectatorViewer, positions: [observedFriendly, observedEnemy], viewpoint: poseOf(observedFriendly) }).ok, true,
  "a team-less spectator may observe both teams");
const holder = { ...teammate, has_commander_keycard: true };
const noDrop = { ...sharedFrame, commander_keycard: null };
const card = frame.commander_keycard;
const fading = { ...card, status: "last-known", status_age_ms: 7999, state: "carried" };
assert.equal(parseMinimapPositions({ ...noDrop, positions: [self, holder, enemy] }).ok, true, "v4 friendly keycard holder");
assert.equal(parseMinimapPositions({ ...noDrop, positions: [{ ...self, has_commander_keycard: true }, teammate] }).ok, true, "v4 self keycard holder");
assert.equal(parseMinimapPositions({ ...noDrop, positions: [self, { ...enemy, has_commander_keycard: true }] }).ok, true,
  "like the CS2 bomb carrier, a spotted opponent reveals the card");
assert.equal(parseMinimapPositions({ ...frame, viewer: spectatorViewer, commander_keycard: null,
  positions: [{ ...observedFriendly, has_commander_keycard: true }, observedEnemy], viewpoint: poseOf(observedFriendly) }).ok, true,
  "an observer with rights to the holder's team sees the holder");
assert.equal(parseMinimapPositions({ ...sharedFrame, commander_keycard: { ...card, zone: "Entrance", room_id: "room-001" } }).ok, true,
  "v4 visible keycard drop");
assert.equal(parseMinimapPositions({ ...sharedFrame, commander_keycard: fading }).ok, true, "v4 keycard fading at a holder's last seen spot");
assert.equal(parseMinimapPositions({ ...sharedFrame, commander_keycard: { ...fading, status_age_ms: 0, state: "dropped" } }).ok, true,
  "v4 dropped keycard fading where it was last seen");
assert.equal(parseMinimapPositions({ ...sharedFrame, commander_keycard: { ...card, state: "planted" } }).ok, true,
  "v4 keycard planted in a started generator (CS2 planted bomb)");
assert.equal(parseMinimapPositions({ ...sharedFrame, commander_keycard: { ...fading, state: "planted" } }).ok, true,
  "v4 planted keycard fading where the SCP side last saw it");

const invalidFrames = [
  ["missing keycard flag", { ...frame, positions: [{ ...self, has_commander_keycard: undefined }] }],
  ["string keycard flag", { ...frame, positions: [{ ...self, has_commander_keycard: "true" }] }],
  ["dead keycard holder", { ...noDrop, positions: [self, { ...deadTeammate, has_commander_keycard: true }] }],
  ["last-known keycard holder", { ...noDrop, positions: [self, { ...lastKnown, has_commander_keycard: true }] }],
  ["two keycard holders", { ...noDrop, positions: [{ ...self, has_commander_keycard: true }, holder] }],
  ["held and dropped keycard", { ...frame, positions: [self, holder] }],
  ["held and fading keycard", { ...frame, positions: [self, holder], commander_keycard: fading }],
  ["missing keycard item", { ...frame, commander_keycard: undefined }],
  ["keycard item with heading", { ...frame, commander_keycard: { ...card, yaw_degrees: 0 } }],
  ["keycard item outside zones", { ...frame, commander_keycard: { ...card, zone: "Surface" } }],
  ["keycard item non-finite", { ...frame, commander_keycard: { ...card, x: Infinity } }],
  ["keycard item missing room", { ...frame, commander_keycard: { ...card, room_id: undefined } }],
  ["keycard item empty room", { ...frame, commander_keycard: { ...card, room_id: " " } }],
  ["live keycard item on a holder", { ...frame, commander_keycard: { ...card, state: "carried" } }],
  ["unknown keycard state", { ...frame, commander_keycard: { ...card, state: "lost" } }],
  ["legacy keycard dropped flag", { ...frame, commander_keycard: { ...card, dropped: true } }],
  ["live keycard item with age", { ...frame, commander_keycard: { ...card, status_age_ms: 1 } }],
  ["dead keycard item", { ...frame, commander_keycard: { ...card, status: "dead", status_age_ms: 10 } }],
  ["expired keycard item", { ...frame, commander_keycard: { ...fading, status_age_ms: 8000 } }],
  ["negative keycard age", { ...frame, commander_keycard: { ...fading, status_age_ms: -1 } }],
  ["fractional keycard age", { ...frame, commander_keycard: { ...fading, status_age_ms: 1.5 } }],
  ["missing keycard state", { ...frame, commander_keycard: { ...fading, state: undefined } }],
  ["missing keycard team", { ...frame, commander_keycard: { ...card, team_id: undefined } }],
  ["unknown keycard team", { ...frame, commander_keycard: { ...card, team_id: "team-c" } }],
  ["unknown top-level key", { ...frame, all_players: [] }],
  ["unknown viewer key", { ...frame, viewer: { ...frame.viewer, health: 100 } }],
  ["unknown viewpoint key", { ...frame, viewpoint: { ...frame.viewpoint, inventory: [] } }],
  ["unknown marker key", { ...frame, positions: [{ ...self, health: 100 }] }],
  ["duplicate id", { ...frame, positions: [self, self] }],
  ["unsafe revision", { ...frame, visibility_revision: Number.MAX_SAFE_INTEGER + 1 }],
  ["negative revision", { ...frame, visibility_revision: -1 }],
  ["fractional revision", { ...frame, visibility_revision: 0.5 }],
  ["empty map id", { ...frame, map_id: " " }],
  ["unsupported zone", { ...frame, positions: [{ ...self, zone: "LightContainment" }] }],
  ["empty room id", { ...frame, positions: [{ ...self, room_id: " " }] }],
  ["missing room id", { ...frame, positions: [{ ...self, room_id: undefined }] }],
  ["unknown visibility", { ...frame, positions: [{ ...self, visibility: "omniscient" }] }],
  ["self identity spoof", { ...frame, positions: [{ ...self, player_id: teammate.player_id }] }],
  ["self team spoof", { ...frame, positions: [{ ...self, team_id: "team-b" }] }],
  ["self alive mismatch", { ...frame, positions: [{ ...self, status: "dead" }] }],
  ["dead viewer live self", { ...deadFrame, positions: [self, teammate] }],
  ["v2 is_alive marker", { ...frame, positions: [{ ...self, is_alive: true }] }],
  ["missing status", { ...frame, positions: [{ ...self, status: undefined }] }],
  ["missing status age", { ...frame, positions: [{ ...self, status_age_ms: undefined }] }],
  ["unknown status", { ...frame, positions: [self, { ...enemy, status: "ghost" }] }],
  ["live age", { ...frame, positions: [{ ...self, status_age_ms: 1 }] }],
  ["fractional age", { ...frame, positions: [self, { ...lastKnown, status_age_ms: 1.5 }] }],
  ["negative age", { ...frame, positions: [self, { ...lastKnown, status_age_ms: -1 }] }],
  ["expired last-known", { ...frame, positions: [self, { ...lastKnown, status_age_ms: 6000 }] }],
  ["expired death", { ...frame, positions: [self, { ...deadEnemy, status_age_ms: 4000 }] }],
  ["last-known teammate", { ...frame, positions: [self, { ...teammate, status: "last-known", status_age_ms: 10 }] }],
  ["last-known self", { ...frame, positions: [{ ...self, status: "last-known", status_age_ms: 10 }] }],
  ["string status age", { ...frame, positions: [self, { ...lastKnown, status_age_ms: "10" }] }],
  ["viewer as teammate", { ...frame, positions: [{ ...self, visibility: "teammate" }] }],
  ["enemy as teammate", { ...frame, positions: [self, { ...enemy, visibility: "teammate" }] }],
  ["friendly spotted", { ...frame, positions: [self, { ...teammate, visibility: "spotted-by-self" }] }],
  ["dead self LOS", { ...deadFrame, positions: [teammate, { ...enemy, visibility: "spotted-by-self" }] }],
  ["coerced dead self LOS", { ...deadFrame, positions: [teammate, { ...enemy, visibility: ["spotted-by-self"] }] }],
  ["array visibility", { ...sharedFrame, positions: [self, { ...enemy, visibility: ["spotted-by-teammate"] }] }],
  ["spectator markers", { ...sharedFrame, viewer: { ...frame.viewer, team_id: null } }],
  ["spectator non-observed marker", { ...frame, viewer: { ...frame.viewer, team_id: null, is_alive: false }, positions: [{ ...enemy, visibility: "spotted-by-teammate" }], viewpoint: null }],
  ["observed self", { ...frame, positions: [{ ...self, visibility: "observed" }] }],
  ["observed teammate", { ...deadFrame, positions: [{ ...teammate, visibility: "observed" }], viewpoint: null }],
  ["observed last-known", { ...deadFrame, positions: [teammate, { ...enemy, visibility: "observed", status: "last-known", status_age_ms: 10 }] }],
  ["alive viewer follows observed", { ...frame, positions: [self, { ...enemy, visibility: "observed" }], viewpoint: poseOf(enemy) }],
  ["dead observed viewpoint", { ...deadFrame, positions: [teammate, observedDead], viewpoint: poseOf(observedDead) }],
  ["spectator viewpoint", { ...frame, positions: [], viewer: { ...frame.viewer, team_id: null } }],
  ["enemy viewpoint", { ...sharedFrame, viewpoint: poseOf(enemy) }],
  ["alive viewer follows teammate", { ...sharedFrame, viewpoint: poseOf(teammate) }],
  ["dead viewpoint target", { ...deadFrame, positions: [{ ...teammate, status: "dead" }, enemy] }],
  ["last-known viewpoint target", { ...frame, positions: [self, lastKnown], viewpoint: poseOf(lastKnown) }],
  ["missing viewpoint target", { ...deadFrame, positions: [enemy] }],
  ["pose mismatch", { ...frame, viewpoint: { ...frame.viewpoint, x: self.x + 1 } }],
  ["scoreboard required", { ...frame, scoreboard_visible: undefined }],
  ["viewpoint required", { ...frame, viewpoint: undefined }],
];
for (const key of ["x", "y", "z", "yaw_degrees"]) {
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    invalidFrames.push([`non-finite marker ${key}`, { ...frame, positions: [{ ...self, [key]: value }] }]);
    invalidFrames.push([`non-finite viewpoint ${key}`, { ...frame, viewpoint: { ...frame.viewpoint, [key]: value } }]);
  }
}
for (const yaw_degrees of [-1, 360]) invalidFrames.push(["yaw range", { ...frame, positions: [{ ...self, yaw_degrees }] }]);
for (const [label, payload] of invalidFrames) {
  const result = parseMinimapPositions(payload);
  assert.equal(result.ok, false, label);
  assert.equal(result.error.code, "invalid-payload", label);
}
for (const minimap_schema_version of [undefined, 1, 2, 3, 4, 6]) {
  assert.equal(parseMinimapInit({ ...init, minimap_schema_version }).error.code, "unsupported-minimap-schema");
  assert.equal(parseMinimapPositions({ ...frame, minimap_schema_version }).error.code, "unsupported-minimap-schema");
}
for (const key of ["game_version", "map_generator", "map_generator_version", "map_schema_version", "coordinate_system"]) {
  assert.equal(parseMinimapInit({ ...init, [key]: "unknown" }).error.code, "unsupported-minimap-map");
}
for (const position_update_hz of [Number.NaN, Infinity, 0, -1, 61]) assert.equal(parseMinimapInit({ ...init, position_update_hz }).ok, false);
assert.equal(parseMinimapInit({ ...init, all_players: [] }).ok, false);
assert.equal(parseMinimapInit({ ...init, holiday: ["None"] }).ok, false, "holiday must be a wire string, not a coercible array");

// v5 bombsites: static init data, one uppercase letter each, a heading-less pose with the marker zone/room rules.
const site = init.bombsites[0];
assert.deepEqual(init.bombsites.map(({ label }) => label), ["A", "B"], "public init example carries A and B");
assert.equal(parseMinimapInit({ ...init, bombsites: [] }).ok, true, "a map may have no bombsites");
assert.equal(parseMinimapInit({ ...init, bombsites: [{ ...site, room_id: null }] }).ok, true, "an unmapped room is null");
assert.equal(parseMinimapInit({ ...init, bombsites: [{ ...site, label: "B" }, { ...site, label: "A", zone: "Entrance", room_id: null }] }).ok, true,
  "array order carries no meaning");
assert.equal(parseMinimapInit({ ...init, bombsites: Array.from({ length: 26 }, (_, index) => ({ ...site, label: String.fromCharCode(65 + index) })) }).ok, true,
  "every letter A-Z");
const invalidInits = [
  ["missing bombsites", { ...init, bombsites: undefined }],
  ["null bombsites", { ...init, bombsites: null }],
  ["object bombsites", { ...init, bombsites: { A: site } }],
  ["too many bombsites", { ...init, bombsites: Array.from({ length: 27 }, (_, index) => ({ ...site, label: String.fromCharCode(65 + (index % 26)) })) }],
  ["duplicate label", { ...init, bombsites: [site, { ...site, x: site.x + 10 }] }],
  ["two-letter label", { ...init, bombsites: [{ ...site, label: "AB" }] }],
  ["lowercase label", { ...init, bombsites: [{ ...site, label: "a" }] }],
  ["empty label", { ...init, bombsites: [{ ...site, label: "" }] }],
  ["numeric label", { ...init, bombsites: [{ ...site, label: 1 }] }],
  ["array label", { ...init, bombsites: [{ ...site, label: ["A"] }] }],
  ["missing label", { ...init, bombsites: [{ ...site, label: undefined }] }],
  ["unsupported zone", { ...init, bombsites: [{ ...site, zone: "LightContainment" }] }],
  ["missing room", { ...init, bombsites: [{ ...site, room_id: undefined }] }],
  ["empty room", { ...init, bombsites: [{ ...site, room_id: " " }] }],
  ["heading", { ...init, bombsites: [{ ...site, yaw_degrees: 0 }] }],
  ["unknown key", { ...init, bombsites: [{ ...site, radius: 5 }] }],
  ["non-object site", { ...init, bombsites: ["A"] }],
  ["null site", { ...init, bombsites: [null] }],
];
for (const key of ["x", "y", "z"]) {
  for (const value of [Number.NaN, Infinity, -Infinity, "1", undefined]) invalidInits.push([`bombsite ${key} ${String(value)}`, { ...init, bombsites: [{ ...site, [key]: value }] }]);
}
for (const [label, payload] of invalidInits) {
  const result = parseMinimapInit(payload);
  assert.equal(result.ok, false, label);
  assert.equal(result.error.code, "invalid-payload", label);
}
assert.equal(parseMinimapInit({ ...init, seed: 0 }).ok, false);
assert.equal(parseMinimapInit({ ...init, seed: 1.5 }).ok, false);
assert.equal(parseMinimapInit({ ...init, seed: 2147483648 }).ok, false);
for (const event of [initExample, frameExample]) {
  for (const round_id of [undefined, null, " "]) assert.equal(parseEvent({ ...event, round_id }).error.code, "invalid-envelope");
  assert.equal(parseEvent({ ...event, sent_at: undefined }).error.code, "invalid-envelope");
  assert.equal(parseEvent({ ...event, sent_at: "not-a-date" }).error.code, "invalid-envelope");
}
assert.equal(parseEnvelope({ ...initExample, sequence: Number.MAX_SAFE_INTEGER + 1 }).ok, false);

const identity = { steamId: frame.viewer.player_id };
const route = {
  protocolVersion: 0, identityMode: "device-signature", steamId: identity.steamId,
  serverId: initExample.server_id, instanceId: initExample.instance_id,
  sidecarEndpoint: "wss://mock.sidecar.invalid", sessionToken: "fixture-only",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const event = (type, sequence, payload) => ({ ...initExample, type, sequence, event_id: `event-${sequence}`, payload });
const baseline = (sequence) => event("sidecar.baseline", sequence, { baseline: true });
const shop = (sequence) => event("shop.snapshot", sequence, { balance: 100, window_open: true, items: [] });
const hud = (sequence) => event("match.snapshot", sequence, {
  viewer_team_id: "team-a", state: "ActionPhase", round: 1, max_rounds: 15,
  phase_remaining_ms: 1000, phase_paused: false,
  teams: [
    { team_id: "team-a", role: "ntf", display_name: "A", score: 0, players: [] },
    { team_id: "team-b", role: "scp", display_name: "B", score: 0, players: [] },
  ],
});
let now = 100;
const connection = new MockSidecarConnection([], () => now);
const events = [];
const statuses = [];
const diagnostics = [];
const actions = [];
let current = true;
let session = initialClientSessionState;
const cleanup = await runClientSessionAttempt({
  identity: { getCurrentUser: async () => identity },
  proof: { getProof: async () => ({ kind: "device-signature", deviceId: "fixture", signature: "fixture" }), isVerified: () => true },
  controlPlane: { resolveActiveServer: async () => ({ ok: true, value: route }) },
  connection,
}, 1, {
  dispatch: (action) => { actions.push(action); session = clientSessionReducer(session, action); },
  onEvent: (value) => events.push(value),
  onDiagnostic: (value) => diagnostics.push(value),
  onStatus: (value) => statuses.push(value),
  isCurrent: () => current,
});
assert.deepEqual(statuses, ["connecting", "baseline-required"], "session subscribes before connect");
assert.equal(connection.receive(baseline(1)).ok, true);
assert.equal(connection.receive(event("minimap.init", 2, init)).ok, true);
assert.equal(connection.receive(event("minimap.positions", 3, sharedFrame)).ok, true);
assert.equal(session.status, "live");
now = 150;
assert.equal(connection.receive(event("minimap.positions", 5, { ...sharedFrame, all_players: ["private"] })).ok, false);
assert.equal(events.length, 3, "invalid payload never reaches event subscribers");
assert.deepEqual(diagnostics, [{
  feature: "minimap", kind: "invalid-payload", eventType: "minimap.positions",
  serverId: route.serverId, instanceId: route.instanceId, roundId: initExample.round_id,
  sequence: 5, eventId: "event-5", receivedAtMs: 150,
}], "real adapter routes only safe envelope metadata through session");
assert.equal(JSON.stringify(diagnostics).includes("private"), false);
assert.equal(connection.getStatus(), "live", "local payload failure leaves HUD/shop connection live");
const statusCount = statuses.length;
assert.equal(connection.receive(event("minimap.positions", 4, sharedFrame)).error.code, "stale-sequence");
assert.equal(connection.receive(event("minimap.positions", 4, { ...frame, minimap_schema_version: 999 })).error.code, "stale-sequence");
assert.equal(diagnostics.length, 1, "old malformed frame produces no diagnostic");
assert.equal(statuses.length, statusCount, "old frame does not turn healthy connection stale");
assert.equal(connection.receive(event("sidecar.baseline", 4, { baseline: false })).error.code, "stale-sequence");
assert.equal(statuses.length, statusCount, "old invalid baseline cannot disturb live synchronization");
assert.equal(connection.receive(event("minimap.positions", 6, sharedFrame)).ok, true);
for (const [sequence, payload, kind] of [
  [7, { ...init, minimap_schema_version: undefined }, "incompatible-payload"],
  [8, { ...init, game_version: "unknown" }, "incompatible-map"],
]) {
  assert.equal(connection.receive(event("minimap.init", sequence, payload)).ok, false);
  assert.equal(diagnostics.at(-1).kind, kind);
  assert.equal(connection.getStatus(), "live");
}
assert.equal(connection.receive(hud(9)).ok, true, "HUD recovers after minimap-only compatibility errors");
assert.equal(connection.receive(shop(10)).ok, true, "shop continues after minimap-only compatibility errors");
assert.equal(connection.receive(event("chat.message", 11, { message_id: "chat", scope: "team", sender_id: identity.steamId, sender_name: "Fixture", body: "Ready", sent_at: initExample.sent_at })).ok, true);

const beforeMalformed = diagnostics.length;
assert.equal(connection.receive({ ...event("minimap.positions", 12, frame), extra: "invalid envelope" }).ok, false);
assert.equal(diagnostics.length, beforeMalformed, "unvalidated envelope cannot manufacture feature diagnostics");
assert.equal(session.status, "stale", "session observes failures after connect has returned");
assert.equal(connection.receive(event("minimap.init", 13, init)).error.code, "baseline-required");
assert.equal(session.status, "baseline-required");
assert.equal(connection.receive(baseline(14)).ok, true);

const countBeforeOldSession = { actions: actions.length, events: events.length, statuses: statuses.length, diagnostics: diagnostics.length };
current = false;
connection.receive(event("minimap.positions", 15, { ...frame, extra: true }));
connection.receive(shop(16));
await connection.disconnect();
assert.deepEqual({ actions: actions.length, events: events.length, statuses: statuses.length, diagnostics: diagnostics.length }, countBeforeOldSession, "old attempts suppress all three notification paths");
current = true;
cleanup();
await connection.connect(route, identity);
connection.receive(baseline(1));
connection.receive(event("minimap.positions", 2, { ...frame, extra: true }));
assert.deepEqual({ actions: actions.length, events: events.length, statuses: statuses.length, diagnostics: diagnostics.length }, countBeforeOldSession, "cleanup removes every subscription even if isCurrent becomes true");
await connection.disconnect();

for (const payload of [{ baseline: false }, {}, { baseline: true, extra: true }]) {
  const adapter = new MockSidecarConnection();
  const published = [];
  adapter.subscribe((value) => published.push(value));
  await adapter.connect(route, identity);
  assert.equal(adapter.receive(event("sidecar.baseline", 1, payload)).error.code, "invalid-payload");
  assert.equal(adapter.receive(event("minimap.init", 2, init)).error.code, "baseline-required", "invalid baseline cannot establish map qualification");
  assert.equal(published.length, 0, "neither invalid baseline nor early init is published");
  assert.equal(adapter.getStatus(), "baseline-required");
  assert.equal(adapter.receive(baseline(3)).ok, true);
  assert.equal(adapter.receive(event("minimap.init", 4, init)).ok, true);
  assert.equal(adapter.receive(event("minimap.positions", 5, sharedFrame)).ok, true);
  await adapter.disconnect();
}

for (const attack of ["viewer", "schema", "protocol"]) {
  const adapter = new MockSidecarConnection();
  const localDiagnostics = [];
  const localStatuses = [];
  adapter.subscribeDiagnostic((value) => localDiagnostics.push(value));
  adapter.subscribeStatus((value) => localStatuses.push(value));
  await adapter.connect(route, identity);
  adapter.receive(baseline(1));
  const incoming = attack === "viewer"
    ? event("minimap.positions", 2, { ...frame, viewer: { ...frame.viewer, player_id: teammate.player_id }, viewpoint: null, positions: [] })
    : { ...event("minimap.init", 2, init), [attack === "schema" ? "schema_version" : "protocol_version"]: 99 };
  assert.equal(adapter.receive(incoming).ok, false);
  const expected = attack === "viewer" ? "unauthorized" : "incompatible";
  assert.equal(adapter.getStatus(), expected);
  assert.equal(adapter.receive("late invalid JSON").ok, false);
  assert.equal(adapter.getStatus(), expected, "late malformed input cannot override terminal status");
  assert.equal(localStatuses.at(-1), expected);
  assert.equal(localDiagnostics.length, 0, "global failures use status, not local diagnostics");
  assert.equal(adapter.receive(hud(3)).ok, false, "higher sequence cannot recover a terminal auth/global error");
  assert.equal(adapter.receive(baseline(4)).ok, false, "baseline alone cannot recover terminal authorization");
  assert.equal(adapter.getStatus(), expected);
  await assert.rejects(adapter.send({ kind: "command.chat.send", command_id: "blocked", scope: "team", body: "test" }), /connection-not-live/);
  await adapter.connect(route, identity);
  assert.equal(adapter.receive(event("minimap.init", 1, init)).error.code, "baseline-required");
  assert.equal(adapter.receive(baseline(2)).ok, true);
  assert.equal(adapter.receive(shop(3)).ok, true);
  await adapter.disconnect();
  assert.equal(adapter.receive("late input after disconnect").ok, false);
  assert.equal(adapter.getStatus(), "offline");
}

console.log(`minimap contract smoke: ok (${invalidFrames.length} malformed frame cases, adapter/session lifecycle and compatibility)`);
