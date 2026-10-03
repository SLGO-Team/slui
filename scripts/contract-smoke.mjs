import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  EventSequenceGuard,
  canUsePlayerScopedFeatures,
  canOpenPlayerScopedStream,
  parseClientFeatures,
  parseCommand,
  parseEvent,
  parseEnvelope,
  parseMatchSnapshot,
  parseMinimapPositions,
  parseRoute,
  parseShopSnapshot,
} from "../src/contracts/index.ts";
import { MockSidecarConnection } from "../src/platform/connection.ts";
import {
  clientSessionReducer,
  initialClientSessionState,
  runClientSessionAttempt,
  statusForRouteError,
} from "../src/app/clientSession.ts";
import {
  DevelopmentMockVerifiedProofProvider,
  LocalSteamProofProvider,
  getVerificationState,
} from "../src/platform/identity.ts";
import {
  avatarSource,
  DEFAULT_AVATAR_BY_SIDE,
  hudHealthPercent,
  hudPlayerState,
  playerSlotColors,
  PLAYER_COLORS,
  hudScaleForViewport,
  hudSideForRole,
  resolveHudTeams,
} from "../src/features/hud/presentation.ts";
import {
  HUD_STALE_AFTER_MS,
  formatRoundClock,
  initialRoundHudState,
  phaseLabel,
  remainingMilliseconds,
  roundHudReducer,
  selectRoundHud,
  toHudPhase,
} from "../src/features/hud/model.ts";

assert.equal(hudScaleForViewport(1920, 1080), 1);
assert.equal(hudScaleForViewport(1280, 720), 2 / 3);
assert.equal(hudScaleForViewport(1920, 1200), 1);
{
  // Radar, HUD counter and chat share one slot colour per player: side palette by team-list index.
  const slots = playerSlotColors([
    { role: "ntf", players: [{ player_id: "n0" }, { player_id: "n1" }, { player_id: "n2" }, { player_id: "n3" }, { player_id: "n4" }, { player_id: "n5" }] },
    { role: "scp", players: [{ player_id: "s0" }, { player_id: "s1" }] },
  ]);
  const ntf = PLAYER_COLORS[hudSideForRole("ntf")];
  const scp = PLAYER_COLORS[hudSideForRole("scp")];
  assert.deepEqual([slots.n0, slots.n1, slots.n4, slots.n5], [ntf[0], ntf[1], ntf[4], ntf[0]], "palette wraps after five players");
  assert.deepEqual([slots.s0, slots.s1], [scp[0], scp[1]]);
  assert.equal(new Set(ntf).size, 5, "five distinct teammate colours");
}
assert.equal(hudPlayerState({ player_id: "alive", display_name: "Alive", is_online: true, is_alive: true, health: 63 }), "alive");
assert.equal(hudPlayerState({ player_id: "dead", display_name: "Dead", is_online: true, is_alive: false, health: 0 }), "dead");
assert.equal(hudPlayerState({ player_id: "offline", display_name: "Offline", is_online: false, is_alive: true, health: 100 }), "offline");
assert.equal(hudHealthPercent({ player_id: "healthy", display_name: "Healthy", is_online: true, is_alive: true, health: 130 }), 100);
assert.equal(hudHealthPercent({ player_id: "offline", display_name: "Offline", is_online: false, is_alive: true, health: 100 }), 0);
assert.equal(hudHealthPercent({ player_id: "unknown", display_name: "Unknown", is_online: true, is_alive: true, health: null }), null);
assert.equal(avatarSource({ player_id: "missing", display_name: "Missing", is_online: true, is_alive: true }, "ct"), DEFAULT_AVATAR_BY_SIDE.ct);
assert.equal(avatarSource({ player_id: "steam", display_name: "Steam", avatar_url: "https://avatars.example/player.jpg", is_online: true, is_alive: true }, "t"), "https://avatars.example/player.jpg");
assert.equal(hudSideForRole("ntf"), "t");
assert.equal(hudSideForRole("scp"), "ct");
assert.equal(formatRoundClock(93), "1:33");
assert.equal(formatRoundClock(-10), "0:00");

const baseline = {
  protocol_version: 0,
  schema_version: 1,
  event_id: "baseline-1",
  server_id: "server-a",
  instance_id: "instance-a",
  sequence: 1,
  type: "sidecar.baseline",
  payload: { baseline: true },
};

assert.equal(parseEnvelope(baseline).ok, true);
assert.equal(parseEnvelope({ ...baseline, schema_version: 99 }).ok, false);
assert.equal(parseEnvelope("not-json").ok, false);
assert.equal(parseEnvelope({ ...baseline, unexpected: true }).ok, false);
assert.equal(parseEvent({ ...baseline, type: "sidecar.baseline", payload: { baseline: true } }).ok, true);
assert.equal(parseEvent({ ...baseline, type: "unknown.event", payload: {} }).ok, false);

const hudNow = Date.parse("2026-08-26T08:00:10.000Z");
const makeMatchSnapshot = (overrides = {}) => ({
  viewer_team_id: "team-a",
  state: "ActionPhase",
  round: 7,
  max_rounds: 15,
  phase_remaining_ms: 10_000,
  phase_paused: false,
  teams: [
    {
      team_id: "team-b",
      role: "scp",
      display_name: "Team B",
      score: 2,
      players: [
        { player_id: "enemy", display_name: "Enemy", is_online: true, is_alive: true },
      ],
    },
    {
      team_id: "team-a",
      role: "ntf",
      display_name: "Team A",
      score: 4,
      players: [
        { player_id: "viewer", display_name: "Viewer", is_online: true, is_alive: true, health: 60 },
        { player_id: "unknown", display_name: "Unknown", is_online: true, is_alive: true },
        { player_id: "offline", display_name: "Offline", is_online: false, is_alive: false, health: null },
      ],
    },
  ],
  ...overrides,
});
const makeMatchEvent = (overrides = {}) => ({
  ...baseline,
  event_id: "match-2",
  sequence: 2,
  type: "match.snapshot",
  sent_at: "2026-08-26T08:00:09.000Z",
  payload: makeMatchSnapshot(),
  ...overrides,
});

const validSnapshot = makeMatchSnapshot();
assert.equal(parseMatchSnapshot(validSnapshot).ok, true);
assert.equal(parseMatchSnapshot({
  ...validSnapshot,
  teams: validSnapshot.teams.map((team) => team.team_id === "team-b"
    ? { ...team, players: [{ ...team.players[0], health: 100 }] }
    : team),
}).ok, false, "enemy health must be rejected at the parser boundary");
for (const key of ["max_health", "max_shield", "aux_power", "max_aux_power"]) {
  assert.equal(parseMatchSnapshot({
    ...validSnapshot,
    teams: validSnapshot.teams.map((team) => team.team_id === "team-b"
      ? { ...team, players: [{ ...team.players[0], [key]: 100 }] }
      : team),
  }).ok, false, `enemy ${key} must be rejected like health`);
  for (const value of [-1, Number.NaN, "100"]) {
    assert.equal(parseMatchSnapshot({
      ...validSnapshot,
      teams: validSnapshot.teams.map((team) => team.team_id === "team-a"
        ? { ...team, players: team.players.map((player, index) => index === 0 ? { ...player, [key]: value } : player) }
        : team),
    }).ok, false, `${key} ${String(value)} is not a vital`);
  }
}
assert.equal(parseMatchSnapshot({
  ...validSnapshot,
  teams: [validSnapshot.teams[0], { ...validSnapshot.teams[1], team_id: "team-b" }],
}).ok, false, "team ids must be unique");
assert.equal(parseMatchSnapshot({
  ...validSnapshot,
  teams: [validSnapshot.teams[0], { ...validSnapshot.teams[1], role: "scp" }],
}).ok, false, "team roles must be unique");
assert.equal(parseEvent({ ...makeMatchEvent(), sent_at: undefined }).ok, false, "match snapshots require sent_at");
assert.equal(parseEvent(makeMatchEvent()).ok, true);

{
  // Top-HUD fields (slgo-backend protocol/ipc/README.md "match.snapshot top-HUD fields"): additive and optional.
  const v0Example = JSON.parse(readFileSync(new URL("../packages/protocol/v0/match-snapshot.example.json", import.meta.url), "utf8"));
  const v0Parsed = parseEvent(v0Example);
  assert.equal(v0Parsed.ok, true, "the v0 match snapshot example parses");
  assert.equal(v0Parsed.value.payload.teams[0].players[0].loadout.primary_item_id, "GunE11SR");

  // The plugin's IPC v1 fixture is authoritative for the wire shape; the sibling checkout is optional for this repo.
  const backendFixtureUrl = new URL("../../slgo-backend/protocol/ipc/v1/publish-match-snapshot.example.json", import.meta.url);
  if (existsSync(backendFixtureUrl)) {
    const publish = JSON.parse(readFileSync(backendFixtureUrl, "utf8"));
    const parsed = parseMatchSnapshot(publish.payload);
    assert.equal(parsed.ok, true, "the slgo-backend publish-match-snapshot payload parses");
    assert.equal(parsed.value.generator_remaining_ms, 31_000);
    assert.equal(parsed.value.pause_remaining_ms, null);
    const viewerTeam = parsed.value.teams.find((team) => team.team_id === parsed.value.viewer_team_id);
    const otherTeam = parsed.value.teams.find((team) => team.team_id !== parsed.value.viewer_team_id);
    assert.deepEqual(viewerTeam.players[0].loadout, {
      money: 4250,
      primary_item_id: "GunE11SR",
      utility_item_ids: ["GrenadeFlash", "Medkit", "SCP207"],
      armor: "combat",
      has_commander_keycard: true,
      has_generator_upgrade: false,
    });
    assert.deepEqual(viewerTeam.players[1].loadout, { money: 1900, primary_item_id: null, utility_item_ids: [], armor: null, has_commander_keycard: false, has_generator_upgrade: false }, "a dead teammate carries money only");
    assert.equal(otherTeam.players.some((player) => Object.hasOwn(player, "loadout")), false);
  } else {
    console.log("contract smoke: slgo-backend checkout not found, backend match.snapshot fixture skipped");
  }

  const loadout = { money: 3100, primary_item_id: "Scp173", utility_item_ids: ["HealthUpgrade2"], armor: null, has_commander_keycard: false, has_generator_upgrade: true };
  const withViewerLoadout = (playerLoadout, overrides = {}) => ({
    ...validSnapshot,
    ...overrides,
    teams: validSnapshot.teams.map((team) => team.team_id === "team-a"
      ? { ...team, players: [{ ...team.players[0], loadout: playerLoadout }, ...team.players.slice(1)] }
      : team),
  });
  assert.equal(parseMatchSnapshot(validSnapshot).value.generator_remaining_ms, undefined, "older plugins omit the clocks");
  assert.equal(parseMatchSnapshot({ ...validSnapshot, generator_remaining_ms: null, pause_remaining_ms: null }).ok, true);
  assert.equal(parseMatchSnapshot({ ...validSnapshot, generator_remaining_ms: 12_000, pause_remaining_ms: 0 }).ok, true);
  for (const bad of ["31000", -1, 1.5, true, {}]) {
    assert.equal(parseMatchSnapshot({ ...validSnapshot, generator_remaining_ms: bad }).ok, false, `generator_remaining_ms ${JSON.stringify(bad)} is rejected`);
    assert.equal(parseMatchSnapshot({ ...validSnapshot, pause_remaining_ms: bad }).ok, false, `pause_remaining_ms ${JSON.stringify(bad)} is rejected`);
  }
  assert.equal(parseMatchSnapshot(withViewerLoadout(loadout)).ok, true);
  assert.equal(parseMatchSnapshot(withViewerLoadout(null)).ok, true, "an offline teammate's loadout is null");
  assert.equal(parseMatchSnapshot(withViewerLoadout({ ...loadout, extra: 1 })).ok, true, "unknown loadout keys are tolerated");
  for (const [key, bad] of [
    ["money", -1], ["money", 1.5], ["money", "100"],
    ["primary_item_id", ""], ["primary_item_id", 7],
    ["utility_item_ids", null], ["utility_item_ids", ["Medkit", ""]], ["utility_item_ids", [1]],
    ["armor", "kevlar"], ["armor", undefined],
    ["has_commander_keycard", "yes"], ["has_generator_upgrade", null],
  ]) {
    assert.equal(parseMatchSnapshot(withViewerLoadout({ ...loadout, [key]: bad })).ok, false, `loadout.${key} ${JSON.stringify(bad)} is rejected`);
  }
  for (const bad of ["money", 0, [], true]) {
    assert.equal(parseMatchSnapshot(withViewerLoadout(bad)).ok, false, `loadout ${JSON.stringify(bad)} is rejected`);
  }
  assert.equal(parseMatchSnapshot({
    ...validSnapshot,
    teams: validSnapshot.teams.map((team) => team.team_id === "team-b"
      ? { ...team, players: [{ ...team.players[0], loadout }] }
      : team),
  }).ok, false, "an opponent loadout is rejected at the parser boundary");
  const spectatorTeams = validSnapshot.teams.map((team) => ({
    ...team,
    players: team.players.map(({ health: _health, shield: _shield, ...player }) => player),
  }));
  assert.equal(parseMatchSnapshot({ ...validSnapshot, viewer_team_id: null, teams: spectatorTeams }).ok, true);
  assert.equal(parseMatchSnapshot({
    ...validSnapshot,
    viewer_team_id: null,
    teams: spectatorTeams.map((team) => team.team_id === "team-a" ? { ...team, players: [{ ...team.players[0], loadout: null }] } : team),
  }).ok, false, "a spectator variant carries no loadout, not even null");
}

const roundStates = ["Idle", "WaitingForPlayers", "PreRoundWait", "BuyPhase", "ActionPhase", "RoundEnd", "MatchEnd"];
for (const state of roundStates) {
  assert.ok(phaseLabel(state).length > 0, `${state} must have a label`);
  assert.ok(["LIVE", "BUY", "PAUSED"].includes(toHudPhase(state)), `${state} must map to a HUD phase`);
}

let phaseTestState = roundHudReducer(initialRoundHudState, { type: "connection", status: "live" });
phaseTestState = roundHudReducer(phaseTestState, { type: "event", event: baseline, receivedAtMs: hudNow });
for (const [index, state] of roundStates.entries()) {
  phaseTestState = roundHudReducer(phaseTestState, {
    type: "event",
    event: makeMatchEvent({
      event_id: `phase-${state}`,
      sequence: index + 2,
      payload: makeMatchSnapshot({ state }),
    }),
    receivedAtMs: hudNow,
  });
  const phaseHud = selectRoundHud(phaseTestState, hudNow);
  assert.equal(phaseHud.hasSnapshot, true);
  assert.equal(phaseHud.state, state);
  assert.equal(phaseHud.phaseLabel, phaseLabel(state));
}

const withoutBaseline = roundHudReducer(initialRoundHudState, {
  type: "event",
  event: makeMatchEvent(),
  receivedAtMs: hudNow,
});
assert.equal(withoutBaseline.frame, null);
assert.equal(selectRoundHud(withoutBaseline, hudNow).availability, "baseline-required");

let hudState = roundHudReducer(initialRoundHudState, { type: "connection", status: "live" });
hudState = roundHudReducer(hudState, { type: "event", event: baseline, receivedAtMs: hudNow });
assert.equal(selectRoundHud(hudState, hudNow).availability, "no-match");
hudState = roundHudReducer(hudState, { type: "event", event: makeMatchEvent(), receivedAtMs: hudNow });
const liveHud = selectRoundHud(hudState, hudNow);
assert.equal(liveHud.hasSnapshot, true);
assert.equal(liveHud.availability, "live");
assert.equal(liveHud.clockSeconds, 10, "sent_at is on the server clock; no transit time is deducted");
assert.equal(liveHud.teams[0].teamId, "team-a", "team-a owns the stable left column");
assert.equal(liveHud.teams[0].score, 4);
assert.equal(liveHud.teams[0].relation, "viewer");
assert.equal(liveHud.teams[0].players[1].health, null, "missing friendly health remains unknown");
assert.equal(liveHud.teams[1].relation, "opponent");
assert.equal(Object.hasOwn(liveHud.teams[1].players[0], "health"), false, "opponent view models cannot expose health");
assert.equal(resolveHudTeams(liveHud).left.teamId, "team-a");
assert.equal(resolveHudTeams(liveHud).right.teamId, "team-b");

const oldHudState = roundHudReducer(hudState, {
  type: "event",
  event: makeMatchEvent({ event_id: "old-match", sequence: 1, payload: makeMatchSnapshot({ round: 1 }) }),
  receivedAtMs: hudNow + 100,
});
assert.equal(oldHudState, hudState, "older sequences must not mutate HUD state");

const swappedEvent = makeMatchEvent({
  event_id: "match-swapped",
  sequence: 3,
  sent_at: "2026-08-26T08:00:10.000Z",
  payload: makeMatchSnapshot({
    teams: [
      { ...validSnapshot.teams[0], role: "ntf", score: 2 },
      { ...validSnapshot.teams[1], role: "scp", score: 4 },
    ],
  }),
});
hudState = roundHudReducer(hudState, { type: "event", event: swappedEvent, receivedAtMs: hudNow });
const swappedHud = selectRoundHud(hudState, hudNow);
assert.equal(resolveHudTeams(swappedHud).left.teamId, "team-a");
assert.equal(resolveHudTeams(swappedHud).left.role, "scp");
assert.equal(resolveHudTeams(swappedHud).left.score, 4, "side swaps must not move stable team scores");
assert.equal(resolveHudTeams(swappedHud).right.role, "ntf");

assert.equal(remainingMilliseconds(hudState.frame, hudNow + 2_500), 7_500);
const pausedFrame = {
  ...hudState.frame,
  snapshot: { ...hudState.frame.snapshot, phase_paused: true, phase_remaining_ms: 8_000 },
};
assert.equal(remainingMilliseconds(pausedFrame, hudNow + 60_000), 8_000, "paused clocks must freeze");
assert.equal(selectRoundHud(hudState, hudNow + HUD_STALE_AFTER_MS + 1).availability, "stale");
const skewedSentAtState = roundHudReducer(
  roundHudReducer(
    roundHudReducer(initialRoundHudState, { type: "connection", status: "live" }),
    { type: "event", event: baseline, receivedAtMs: hudNow },
  ),
  {
    type: "event",
    event: makeMatchEvent({ sent_at: "2026-08-26T07:59:59.000Z" }),
    receivedAtMs: hudNow,
  },
);
assert.equal(selectRoundHud(skewedSentAtState, hudNow).availability, "live", "an old sent_at (player clock ahead) does not make a fresh snapshot stale");
const disconnectedHud = selectRoundHud(roundHudReducer(hudState, { type: "connection", status: "offline" }), hudNow);
assert.equal(disconnectedHud.availability, "disconnected");
assert.equal(disconnectedHud.hasSnapshot, true, "disconnected data remains visible but explicitly marked non-live");

const switchedServerState = roundHudReducer(hudState, {
  type: "event",
  event: { ...baseline, server_id: "server-b", event_id: "baseline-server-b", sequence: 1 },
  receivedAtMs: hudNow + 1,
});
assert.equal(switchedServerState.frame, null, "a different server clears the previous snapshot even when the instance id matches");
assert.equal(switchedServerState.serverId, "server-b");
assert.equal(selectRoundHud(switchedServerState, hudNow + 1).availability, "restarted");

let restartedState = roundHudReducer(hudState, {
  type: "event",
  event: makeMatchEvent({ instance_id: "instance-b", event_id: "wrong-instance", sequence: 1 }),
  receivedAtMs: hudNow + 1,
});
assert.equal(restartedState.frame, null, "new instance data is cleared until a baseline arrives");
assert.equal(selectRoundHud(restartedState, hudNow + 1).availability, "restarted");
restartedState = roundHudReducer(restartedState, {
  type: "event",
  event: { ...baseline, instance_id: "instance-b", event_id: "baseline-b", sequence: 1 },
  receivedAtMs: hudNow + 2,
});
assert.equal(selectRoundHud(restartedState, hudNow + 2).hasSnapshot, false);
assert.equal(selectRoundHud(restartedState, hudNow + 2).availability, "restarted");
restartedState = roundHudReducer(restartedState, { type: "connection", status: "live" });
restartedState = roundHudReducer(restartedState, {
  type: "event",
  event: makeMatchEvent({ instance_id: "instance-b", event_id: "match-b", sequence: 2 }),
  receivedAtMs: hudNow + 3,
});
assert.equal(selectRoundHud(restartedState, hudNow + 3).availability, "live");

const guard = new EventSequenceGuard();
assert.equal(guard.accept(baseline).ok, true);
assert.equal(guard.accept({ ...baseline, event_id: "old", sequence: 1 }).ok, false);
assert.equal(guard.accept({ ...baseline, event_id: "wrong-instance", instance_id: "instance-b", sequence: 2, type: "match.snapshot" }).ok, false);
assert.equal(guard.accept({ ...baseline, event_id: "new-baseline", instance_id: "instance-b", sequence: 1 }).ok, true);

const route = parseRoute({
  protocol_version: 0,
  type: "control.route.resolved",
  identity_mode: "local-steamid",
  steam_id: "76561198000000001",
  server_id: "server-a",
  instance_id: "instance-a",
  sidecar_endpoint: "wss://sidecar.example.invalid",
  session_token: "token",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
});
assert.equal(route.ok, true);
assert.equal(parseRoute({
  protocol_version: 0,
  type: "control.route.resolved",
  identity_mode: "device-signature",
  steam_id: "76561198000000001",
  server_id: "server-a",
  instance_id: "instance-a",
  sidecar_endpoint: "wss://sidecar.example.invalid",
  session_token: "token",
  expires_at: new Date(Date.now() - 1).toISOString(),
}).ok, false);
assert.equal(canUsePlayerScopedFeatures({ kind: "unverified", identity: { steamId: "76561198000000001" } }), false);
assert.equal(canUsePlayerScopedFeatures({ kind: "claimed", identity: { steamId: "76561198000000001" }, mode: "local-steamid" }), true, "the sidecar authorizes claimed SteamIDs by IP binding");
assert.equal(canUsePlayerScopedFeatures({ kind: "verified", identity: { steamId: "76561198000000001" }, mode: "device-signature" }), true);
assert.equal(canUsePlayerScopedFeatures(null), false);

assert.equal(canOpenPlayerScopedStream({ identityMode: "local-steamid" }), true);
assert.equal(canOpenPlayerScopedStream({ identityMode: "device-signature" }), true);
assert.equal(canOpenPlayerScopedStream({ identityMode: "shared-secret" }), false, "unknown identity modes stay refused");
assert.equal(parseCommand({ kind: "command.shop.purchase", command_id: "buy-1", item_id: "armor", quantity: 1 }).ok, true);
assert.equal(parseCommand({ kind: "command.shop.purchase", command_id: "buy-2", item_id: "armor", quantity: -1 }).ok, false);
assert.equal(parseCommand({ kind: "command.chat.send", command_id: "chat-1", scope: "team", body: "" }).ok, false);

// client.features: full list of features the overlay takes over.
const clientFeaturesFixture = JSON.parse(readFileSync(new URL("../packages/protocol/v0/client-features.example.json", import.meta.url), "utf8"));
assert.deepEqual(parseClientFeatures(clientFeaturesFixture).value.features, ["chat-input"]);
assert.equal(parseClientFeatures({ type: "client.features", features: [] }).ok, true, "an empty list withdraws every feature");
assert.equal(parseClientFeatures({ type: "client.features", features: ["Chat-Input"] }).ok, false);
assert.equal(parseClientFeatures({ type: "client.features", features: ["chat-input", "chat-input"] }).ok, false);
assert.equal(parseClientFeatures({ type: "client.features", features: Array.from({ length: 17 }, (_, i) => `f${i}`) }).ok, false);
assert.equal(parseClientFeatures({ type: "client.features", features: ["chat-input"], extra: true }).ok, false);
assert.equal(parseClientFeatures({ type: "client.features" }).ok, false);
assert.equal(parseCommand(clientFeaturesFixture).ok, false, "a features frame is never a command");

// Chat history events.
const chatEnvelope = (type, payload) => ({ protocol_version: 0, schema_version: 1, event_id: "evt-chat", server_id: "s", instance_id: "i", sequence: 3, type, sent_at: "2026-09-29T08:00:00Z", payload });
const chatMessage = { message_id: "chat-1", scope: "team", sender_id: "76561198000000002", sender_name: "Vega", team_id: "team-a", role: "ntf", body: "B <site>", sent_at: "2026-09-29T08:00:00Z" };
assert.equal(parseEvent(chatEnvelope("chat.message", chatMessage)).ok, true, "command_id is optional");
assert.equal(parseEvent(chatEnvelope("chat.message", { ...chatMessage, command_id: null })).ok, true);
assert.equal(parseEvent(chatEnvelope("chat.message", { ...chatMessage, command_id: "chat-7f3a" })).value.payload.command_id, "chat-7f3a");
assert.equal(parseEvent(chatEnvelope("chat.message", { ...chatMessage, command_id: " " })).ok, false);
const notice = { notice_id: "notice-1", segments: [{ text: "击杀奖励 ", tone: "default" }, { text: "+300$", tone: "money" }], sent_at: "2026-09-29T08:00:00Z" };
assert.equal(parseEvent(chatEnvelope("chat.notice", notice)).value.type, "chat.notice");
assert.equal(parseEvent(chatEnvelope("chat.notice", { ...notice, segments: [] })).ok, false);
assert.equal(parseEvent(chatEnvelope("chat.notice", { ...notice, segments: Array.from({ length: 9 }, () => ({ text: "a", tone: "default" })) })).ok, false);
assert.equal(parseEvent(chatEnvelope("chat.notice", { ...notice, segments: [{ text: "", tone: "default" }] })).ok, false);
assert.equal(parseEvent(chatEnvelope("chat.notice", { ...notice, segments: [{ text: "a", tone: "gold" }] })).ok, false);
assert.equal(parseEvent(chatEnvelope("chat.notice", { ...notice, segments: [{ text: "a".repeat(300), tone: "default" }, { text: "a".repeat(213), tone: "muted" }] })).ok, false, "at most 512 characters");
assert.equal(parseEvent(chatEnvelope("chat.notice", { ...notice, notice_id: "" })).ok, false);
assert.equal(parseEvent(chatEnvelope("future.event", {})).error.code, "unsupported-event-type");

const minimapFrame = {
  minimap_schema_version: 5, map_id: "map-1", visibility_revision: 1,
  viewer: { player_id: "p1", team_id: "team-a", is_alive: true },
  viewpoint: null, scoreboard_visible: false,
  positions: [{ player_id: "p1", team_id: "team-a", role: "ntf", visibility: "self", status: "live", status_age_ms: 0, has_commander_keycard: false, x: 0, y: -100, z: 0, yaw_degrees: 0, zone: "HeavyContainment", room_id: null }],
  commander_keycard: null,
};
const minimap = parseMinimapPositions(minimapFrame);
assert.equal(minimap.ok, true);
assert.equal(parseMinimapPositions({ ...minimapFrame, positions: [{ ...minimapFrame.positions[0], visibility: "omniscient" }] }).ok, false);
assert.equal(parseMinimapPositions({ ...minimapFrame, positions: [{ ...minimapFrame.positions[0], x: Number.NaN }] }).ok, false);
assert.equal(parseShopSnapshot({ balance: 100, window_open: true, items: [{ item_id: "bad", name: "Bad", price: -1, quantity: 1, purchasable: true }] }).ok, false);
assert.equal(parseShopSnapshot({
  balance: 100,
  window_open: true,
  categories: [{ id: "equipment", label: "装备", order: 1 }],
  items: [{ item_id: "armor", name: "Armor", price: 50, quantity: null, category_id: "unknown", owned_quantity: 0, purchasable: true }],
}).ok, true, "unknown category assignment remains a valid plugin payload");
assert.equal(parseShopSnapshot({
  balance: 100,
  window_open: true,
  categories: [{ id: "equipment", label: "装备", order: 1 }, { id: "equipment", label: "重复", order: 2 }],
  items: [],
}).ok, false, "category ids must be unique");
assert.equal(parseShopSnapshot({
  balance: 100,
  window_open: true,
  categories: [{ id: "equipment", label: "装备", order: 1.5 }],
  items: [],
}).ok, false, "category order must be an integer");

const connection = new MockSidecarConnection();
const verifiedRoute = {
  protocolVersion: 0,
  identityMode: "device-signature",
  steamId: "76561198000000001",
  serverId: "server-a",
  instanceId: "instance-a",
  sidecarEndpoint: "wss://sidecar.example.invalid",
  sessionToken: "token",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
await connection.connect(verifiedRoute, { steamId: verifiedRoute.steamId });
assert.equal(connection.receive({ ...baseline, server_id: "server-b" }).ok, false);
assert.equal(connection.receive({ ...baseline, instance_id: "instance-b" }).ok, false);
assert.equal(connection.receive(baseline).ok, true);
await assert.rejects(
  connection.send({ kind: "command.shop.purchase", command_id: "invalid-buy", item_id: "armor", quantity: 0 }),
  /invalid-payload/,
);

const localConnection = new MockSidecarConnection();
await localConnection.connect({ ...verifiedRoute, identityMode: "local-steamid" }, { steamId: verifiedRoute.steamId });
assert.equal(localConnection.getStatus(), "baseline-required", "local-steamid routes open the sidecar stream");
await assert.rejects(localConnection.send({ kind: "command.chat.send", command_id: "early", scope: "team", body: "hi" }), /connection-not-live/);
assert.equal(localConnection.receive(baseline).ok, true);
await localConnection.send({ kind: "command.chat.send", command_id: "local-chat", scope: "team", body: "hi" });
const unknownModeConnection = new MockSidecarConnection();
await assert.rejects(
  unknownModeConnection.connect({ ...verifiedRoute, identityMode: "shared-secret" }, { steamId: verifiedRoute.steamId }),
  /unauthorized/,
);
assert.equal(unknownModeConnection.getStatus(), "unauthorized");
await assert.rejects(
  new MockSidecarConnection().connect(verifiedRoute, { steamId: "76561198000000002" }),
  /route-identity-mismatch/,
);

const discovery = clientSessionReducer(initialClientSessionState, { type: "discover", attempt: 2 });
assert.equal(discovery.status, "discovering");
const routePending = clientSessionReducer(discovery, {
  type: "identity-found",
  attempt: 2,
  identity: { steamId: "76561198000000001" },
});
assert.equal(routePending.status, "route-pending");
assert.equal(clientSessionReducer(routePending, { type: "signed-out", attempt: 1 }), routePending);
assert.equal(statusForRouteError("unsupported-schema"), "incompatible");
assert.equal(statusForRouteError("expired-route"), "stale");

const previewIdentity = { steamId: "76561198000000001", personaName: "Nova" };
const previewControlPlane = {
  async resolveActiveServer(identity, proof) {
    return parseRoute({
      protocol_version: 0,
      type: "control.route.resolved",
      identity_mode: proof.kind,
      steam_id: identity.steamId,
      server_id: "slgo-demo",
      instance_id: "instance-demo-1",
      sidecar_endpoint: "wss://mock.sidecar.invalid/slgo",
      session_token: "mock-session-token",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
  },
};
const localProofProvider = new LocalSteamProofProvider();
const localProof = await localProofProvider.getProof(previewIdentity);
assert.equal(getVerificationState(previewIdentity, localProof, localProofProvider)?.kind, "claimed");
assert.equal(getVerificationState(previewIdentity, { kind: "local-steamid", steamId: "76561198000000002" }, localProofProvider)?.kind, "unverified", "a claim for another account is not this player's");
assert.equal(getVerificationState(previewIdentity, null, localProofProvider)?.kind, "unverified");
const verifiedProofProvider = new DevelopmentMockVerifiedProofProvider();
const verifiedProof = await verifiedProofProvider.getProof(previewIdentity);
assert.equal(getVerificationState(previewIdentity, verifiedProof, verifiedProofProvider)?.kind, "verified");

const signedOutActions = [];
await runClientSessionAttempt({
  identity: { getCurrentUser: async () => null },
  proof: localProofProvider,
  controlPlane: previewControlPlane,
  connection: new MockSidecarConnection(),
}, 1, {
  dispatch: (action) => signedOutActions.push(action),
  onEvent: () => undefined,
  isCurrent: () => true,
});
assert.deepEqual(signedOutActions.map((action) => action.type), ["discover", "signed-out"]);

const localActions = [];
await runClientSessionAttempt({
  identity: { getCurrentUser: async () => previewIdentity },
  proof: localProofProvider,
  controlPlane: previewControlPlane,
  connection: new MockSidecarConnection(),
}, 1, {
  dispatch: (action) => localActions.push(action),
  onEvent: () => undefined,
  isCurrent: () => true,
});
assert.equal(localActions.at(-1)?.type, "connected", "a local-steamid session reaches the sidecar");
assert.equal(localActions.at(-1)?.status, "baseline-required");

const liveActions = [];
await runClientSessionAttempt({
  identity: { getCurrentUser: async () => previewIdentity },
  proof: verifiedProofProvider,
  controlPlane: previewControlPlane,
  connection: new MockSidecarConnection([{
    ...baseline,
    server_id: "slgo-demo",
    instance_id: "instance-demo-1",
  }]),
}, 1, {
  dispatch: (action) => liveActions.push(action),
  onEvent: () => undefined,
  isCurrent: () => true,
});
assert.deepEqual(liveActions.map((action) => action.type), ["discover", "identity-found", "route-resolved", "connection-status", "connection-status", "connection-status", "connected"]);
assert.deepEqual(liveActions.filter((action) => action.type === "connection-status").map((action) => action.status), ["connecting", "baseline-required", "live"]);
assert.equal(liveActions.at(-1)?.status, "live");

console.log("contract smoke: ok");
