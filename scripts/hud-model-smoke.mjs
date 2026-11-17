import assert from "node:assert/strict";
import {
  clockRemainingMilliseconds,
  generatorPulseTier,
  HUD_GENERATOR_PULSE_FAST_AT_MS,
  HUD_GENERATOR_PULSE_MEDIUM_AT_MS,
  hudClockMode,
  initialRoundHudState,
  interpolateRemainingMs,
  roundHudReducer,
  selectRoundHud,
  selectRoundHudClock,
  sameRoundHudClock,
  sameRoundHudTime,
  HUD_STALE_AFTER_MS,
} from "../src/features/hud/model.ts";
import {
  HUD_GENERATOR_PULSE_SECONDS,
  hudAuxPower,
  hudHealthPercent,
  hudShieldPercent,
  hudVariantFor,
  loadoutToPlayerMeta,
  playerObserverNumbers,
  teammateColorRule,
  topHudPlayerMetaForHud,
} from "../src/features/hud/presentation.ts";

// Top-HUD timer modes and teammate equipment (slgo-backend protocol/ipc/README.md "match.snapshot top-HUD fields").

const sentAt = Date.parse("2026-10-01T08:00:09.000Z");
const receivedAt = sentAt + 1_000;
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

const ntfLoadout = {
  money: 4250,
  primary_item_id: "GunE11SR",
  utility_item_ids: ["GrenadeFlash", "Radio", "Medkit"],
  armor: "combat",
  has_commander_keycard: true,
  has_generator_upgrade: false,
};
const deadLoadout = { money: 1900, primary_item_id: null, utility_item_ids: [], armor: null, has_commander_keycard: false, has_generator_upgrade: false };

const makeSnapshot = (overrides = {}) => ({
  viewer_team_id: "team-a",
  state: "ActionPhase",
  round: 7,
  max_rounds: 15,
  phase_remaining_ms: 60_000,
  phase_paused: false,
  generator_remaining_ms: null,
  pause_remaining_ms: null,
  teams: [
    {
      team_id: "team-a",
      role: "ntf",
      display_name: "Team A",
      score: 3,
      players: [
        { player_id: "nova", display_name: "Nova", is_online: true, is_alive: true, health: 100, shield: 0, loadout: ntfLoadout },
        { player_id: "orion", display_name: "Orion", is_online: true, is_alive: false, health: 0, shield: 0, loadout: deadLoadout },
        { player_id: "vega", display_name: "Vega", is_online: false, is_alive: false, health: null, shield: null, loadout: null },
        { player_id: "legacy", display_name: "Legacy", is_online: true, is_alive: true, health: 80 },
      ],
    },
    {
      team_id: "team-b",
      role: "scp",
      display_name: "Team B",
      score: 2,
      players: [{ player_id: "kestrel", display_name: "Kestrel", is_online: true, is_alive: true }],
    },
  ],
  ...overrides,
});

function hudFor(snapshotOverrides, nowMs = receivedAt) {
  let state = roundHudReducer(initialRoundHudState, { type: "connection", status: "live" });
  state = roundHudReducer(state, { type: "event", event: baseline, receivedAtMs: receivedAt });
  state = roundHudReducer(state, {
    type: "event",
    event: {
      ...baseline,
      event_id: "match-2",
      sequence: 2,
      type: "match.snapshot",
      sent_at: new Date(sentAt).toISOString(),
      payload: makeSnapshot(snapshotOverrides),
    },
    receivedAtMs: receivedAt,
  });
  return { state, hud: selectRoundHud(state, nowMs), clock: selectRoundHudClock(state, nowMs) };
}

{
  // The instance ended (usually a restart): it takes its match with it, until a new baseline.
  const { state } = hudFor({});
  assert.equal(selectRoundHud(state, receivedAt).hasSnapshot, true);
  const ended = selectRoundHud(roundHudReducer(state, { type: "connection", status: "ended" }), receivedAt);
  assert.equal(ended.hasSnapshot, false);
  assert.equal(ended.availability, "disconnected");
  assert.equal(ended.statusLabel, "SERVER RESTARTING", "without a reason an end reads as a restart");
  for (const status of ["not-in-game", "game-not-running"]) {
    const over = selectRoundHud(roundHudReducer(state, { type: "connection", status }), receivedAt);
    assert.equal(over.hasSnapshot, false, `${status} ends the match`);
    assert.equal(over.availability, "disconnected");
  }
  const endedState = roundHudReducer(state, { type: "connection", status: "ended" });
  assert.equal(selectRoundHud(endedState, receivedAt, "server-shutdown").statusLabel, "SERVER CLOSED");
  assert.equal(selectRoundHud(endedState, receivedAt, "round-restart").statusLabel, "SERVER RESTARTING");
  assert.equal(selectRoundHud(endedState, receivedAt, "lost").statusLabel, "SERVER LOST");
  assert.equal(selectRoundHud(state, receivedAt, "server-shutdown").statusLabel, "LIVE", "the reason only labels an ended instance");
  assert.equal(selectRoundHud(roundHudReducer(state, { type: "connection", status: "stale" }), receivedAt).hasSnapshot, true, "stale keeps the match");
}

// Clock mode priority: hidden > generator > pause > round.
for (const state of ["Idle", "WaitingForPlayers", "RoundEnd"]) {
  assert.equal(hudClockMode(makeSnapshot({ state, generator_remaining_ms: 5_000, pause_remaining_ms: 5_000 })), "hidden", `${state} hides the timer`);
}
for (const state of ["PreRoundWait", "BuyPhase", "ActionPhase", "MatchEnd"]) {
  assert.equal(hudClockMode(makeSnapshot({ state })), "round", `${state} shows the phase clock`);
}
assert.equal(hudClockMode(makeSnapshot({ generator_remaining_ms: 5_000, pause_remaining_ms: 5_000 })), "generator", "the generator outranks a pause");
assert.equal(hudClockMode(makeSnapshot({ generator_remaining_ms: 0 })), "generator", "a zero generator clock is still running");
assert.equal(hudClockMode(makeSnapshot({ pause_remaining_ms: 5_000, phase_paused: true, phase_remaining_ms: 0 })), "pause");
const legacySnapshot = makeSnapshot();
delete legacySnapshot.generator_remaining_ms;
delete legacySnapshot.pause_remaining_ms;
assert.equal(hudClockMode(legacySnapshot), "round", "older plugins without the fields keep the phase clock");

// Interpolation deducts only local time since receipt; sent_at is on the server clock (here 1 s behind).
{
  const { state } = hudFor({});
  assert.equal(interpolateRemainingMs(state.frame, 31_000, receivedAt + 2_500), 28_500);
  assert.equal(interpolateRemainingMs(state.frame, 500, receivedAt + 2_500), 0, "never negative");
  assert.equal(clockRemainingMilliseconds(state.frame, "hidden", receivedAt), 0);
}

{
  // Generator: no digits; the interpolated generator_remaining_ms only drives the keycard blink tier.
  const { hud, clock } = hudFor({ generator_remaining_ms: 31_000, phase_remaining_ms: 70_000 }, receivedAt + 2_000);
  assert.equal(hud.clockMode, "generator");
  assert.equal(clock.clockSeconds, 29, "31 s - 2 s local");
  assert.equal(clock.generatorPulse, "slow");
  assert.equal(clock.phaseClockSeconds, 68, "the shop countdown keeps phase semantics");
}

// Blink tiers (CS2 BombPlantedPulse): > 20 s slow, 10-20 s medium, <= 10 s fast; both bounds inclusive downward.
assert.equal(HUD_GENERATOR_PULSE_MEDIUM_AT_MS, 20_000);
assert.equal(HUD_GENERATOR_PULSE_FAST_AT_MS, 10_000);
assert.equal(generatorPulseTier(40_000), "slow");
assert.equal(generatorPulseTier(20_001), "slow");
assert.equal(generatorPulseTier(20_000), "medium", "20 s is already medium");
assert.equal(generatorPulseTier(10_001), "medium");
assert.equal(generatorPulseTier(10_000), "fast", "10 s is already fast");
assert.equal(generatorPulseTier(0), "fast");
assert.deepEqual(HUD_GENERATOR_PULSE_SECONDS, { slow: 0.8, medium: 0.5, fast: 0.3 });
{
  // The tier follows the interpolated time, not the received value: 22 s - 2 s local = 20 s.
  const { hud, clock } = hudFor({ generator_remaining_ms: 22_000 }, receivedAt + 2_000);
  assert.equal(clock.generatorPulse, "medium");
}
{
  // Last second: the plugin reports 0 while the generator is still running.
  const { hud, clock } = hudFor({ generator_remaining_ms: 0 });
  assert.equal(hud.clockMode, "generator");
  assert.equal(clock.generatorPulse, "fast");
}
{
  // The generator outranks a pause in the view model too.
  const { hud, clock } = hudFor({ generator_remaining_ms: 15_000, pause_remaining_ms: 45_000, phase_paused: true, phase_remaining_ms: 0 }, receivedAt);
  assert.equal(hud.clockMode, "generator");
  assert.equal(clock.generatorPulse, "medium");
}

{
  // Pause: the timer shows the pause glyph, not the pause countdown (that one is in the alert slot).
  const { hud, clock } = hudFor({ pause_remaining_ms: 45_000, phase_paused: true, phase_remaining_ms: 0 }, receivedAt + 4_000);
  assert.equal(hud.clockMode, "pause");
  assert.equal(clock.clockSeconds, 0);
  assert.equal(clock.generatorPulse, null, "no blink tier outside the generator mode");
  assert.equal(hud.paused, true);
  assert.equal(clock.phaseClockSeconds, 0, "the paused phase clock stays frozen");
}

{
  const { hud, clock } = hudFor({ state: "RoundEnd", phase_remaining_ms: 7_000 }, receivedAt + 1_000);
  assert.equal(hud.clockMode, "hidden");
  assert.equal(clock.clockSeconds, 0);
  assert.equal(clock.phaseClockSeconds, 6);
}

{
  const { hud, clock } = hudFor({}, receivedAt + 1_000);
  assert.equal(hud.clockMode, "round");
  assert.equal(clock.clockSeconds, 59);
  assert.equal(clock.clockSeconds, clock.phaseClockSeconds);
}

{
  // App keeps the previous HUD view across ticks while sameRoundHudTime holds: nowMs may change availability only.
  const { state } = hudFor({});
  const early = selectRoundHud(state, receivedAt + 100);
  const later = selectRoundHud(state, receivedAt + 4_000);
  assert.equal(sameRoundHudTime(early, later), true);
  assert.deepEqual(later, early, "nothing else in the view depends on the time");
  const stale = selectRoundHud(state, receivedAt + HUD_STALE_AFTER_MS + 1);
  assert.equal(stale.availability, "stale");
  assert.equal(sameRoundHudTime(early, stale), false);
  const clockAt = (nowMs) => selectRoundHudClock(state, nowMs);
  assert.equal(sameRoundHudClock(clockAt(receivedAt + 100), clockAt(receivedAt + 900)), true, "same second");
  assert.equal(sameRoundHudClock(clockAt(receivedAt + 100), clockAt(receivedAt + 1_100)), false, "the next second");
  assert.equal(selectRoundHudClock(initialRoundHudState, receivedAt), null);
}

// Loadouts reach the viewer team only.
{
  const { hud } = hudFor({});
  const viewer = hud.teams.find((team) => team.relation === "viewer");
  const opponent = hud.teams.find((team) => team.relation === "opponent");
  assert.deepEqual(viewer.players.map((player) => player.loadout), [ntfLoadout, deadLoadout, null, null], "missing loadout becomes null");
  assert.equal(opponent.players.some((player) => Object.hasOwn(player, "loadout")), false);

  const meta = topHudPlayerMetaForHud(hud);
  assert.deepEqual(Object.keys(meta).sort(), ["nova", "orion"], "offline and legacy teammates carry no equipment");
  assert.deepEqual(meta.nova, {
    money: 4250,
    weapon: { label: "GunE11SR", src: "/assets/slui-svg/GunE11SR.svg" },
    utility: [
      { label: "GrenadeFlash", src: "/assets/slui-svg/GrenadeFlash.svg" },
      { label: "Medkit", src: "/assets/slui-svg/Medkit.svg" },
    ],
    armor: "combat",
    hasC4: true,
    hasDefuser: false,
  }, "ids without an icon (Radio) are skipped");
  assert.deepEqual(meta.orion, { money: 1900, utility: [], hasC4: false, hasDefuser: false }, "a dead teammate shows money only");
}

// Demo replay: an omniscient snapshot (no viewer team) shows both teams in full as `observer`, never `viewer`.
{
  const kestrelLoadout = { ...deadLoadout, money: 2700 };
  const omniscient = hudFor({
    viewer_team_id: null,
    omniscient: true,
    teams: makeSnapshot().teams.map((team) => team.team_id === "team-b"
      ? { ...team, players: [{ ...team.players[0], health: 900, shield: 120, max_health: 1800, max_shield: 300, loadout: kestrelLoadout }] }
      : team),
  }).hud;
  assert.deepEqual(omniscient.teams.map((team) => team.relation), ["observer", "observer"]);
  assert.equal(omniscient.teams[1].players[0].health, 900, "the other team's vitals reach the observer");
  assert.deepEqual(Object.keys(topHudPlayerMetaForHud(omniscient)).sort(), ["kestrel", "nova", "orion"], "both teams' equipment");
  assert.equal(hudVariantFor(omniscient, "nova"), "detailed", "no viewer team: the observer sees the detailed HUD");
  const plain = hudFor({}).hud;
  assert.deepEqual(hudFor({ omniscient: false }).hud, plain, "omniscient false is the match-server view");
}

assert.deepEqual(topHudPlayerMetaForHud({ hasSnapshot: false }), {});
assert.deepEqual(loadoutToPlayerMeta({ ...ntfLoadout, primary_item_id: "Jailbird", utility_item_ids: [] }).weapon, undefined, "an unknown primary id draws no weapon");
assert.deepEqual(loadoutToPlayerMeta({
  money: 3100,
  primary_item_id: "Scp079",
  utility_item_ids: ["HealthUpgrade2", "ShieldUpgrade1", "Scp079Level3"],
  armor: null,
  has_commander_keycard: false,
  has_generator_upgrade: true,
}), {
  money: 3100,
  weapon: { label: "Scp079", src: "/assets/slui-svg/Scp079.svg" },
  utility: [
    { label: "HealthUpgrade2", src: "/assets/slui-svg/HealthUpgrade.svg" },
    { label: "ShieldUpgrade1", src: "/assets/slui-svg/ShieldUpgrade.svg" },
    { label: "Scp079Level3", src: "/assets/slui-svg/Scp079Upgrade.svg" },
  ],
  hasC4: false,
  hasDefuser: true,
}, "SCP: role as weapon, upgrades as utility, generator upgrade as defuser");

// Player clock skew: neither staleness nor the countdown may depend on sent_at vs the local clock.
for (const skewMs of [60_000, -60_000]) {
  let skewState = roundHudReducer(initialRoundHudState, { type: "connection", status: "live" });
  skewState = roundHudReducer(skewState, { type: "event", event: baseline, receivedAtMs: receivedAt });
  skewState = roundHudReducer(skewState, {
    type: "event",
    event: { ...baseline, event_id: "match-skew", sequence: 2, type: "match.snapshot", sent_at: new Date(receivedAt - skewMs).toISOString(), payload: makeSnapshot({ phase_remaining_ms: 30_000 }) },
    receivedAtMs: receivedAt,
  });
  const hud = selectRoundHud(skewState, receivedAt + 2_000);
  assert.equal(hud.availability, "live", `skew ${skewMs} ms keeps the HUD live`);
  assert.equal(interpolateRemainingMs(skewState.frame, 30_000, receivedAt + 2_000), 28_000, `skew ${skewMs} ms leaves the countdown alone`);
}

// Detailed variant: buy phase, round end, spectator, or the local player (matched by SteamID64) dead.
for (const state of ["BuyPhase", "RoundEnd"]) {
  assert.equal(hudVariantFor(hudFor({ state }).hud, "nova"), "detailed", `${state} shows the detailed HUD`);
}
for (const state of ["PreRoundWait", "ActionPhase", "MatchEnd"]) {
  assert.equal(hudVariantFor(hudFor({ state }).hud, "nova"), "compact", `${state} keeps the compact HUD for a live player`);
}
assert.equal(hudVariantFor(hudFor({}).hud, "orion"), "detailed", "a dead local player sees the detailed HUD");
assert.equal(hudVariantFor(hudFor({}).hud, null), "compact", "no identity: no local death to detect");
assert.equal(hudVariantFor(hudFor({}).hud, "kestrel"), "compact", "only the viewer team identifies the local player");
assert.equal(hudVariantFor(hudFor({ viewer_team_id: null, teams: makeSnapshot().teams.map(({ players, ...team }) => ({
  ...team,
  players: players.map(({ health, shield, loadout, ...player }) => player),
})) }).hud, null), "detailed", "a spectator sees the detailed HUD");
assert.equal(hudVariantFor(selectRoundHud(initialRoundHudState, receivedAt), "nova"), "compact", "no snapshot stays compact");

// Vital caps: bars scale by the plugin's caps; older plugins (no caps) keep the 0-100 scale.
const scpVitals = (overrides) => hudFor({
  viewer_team_id: "team-b",
  teams: makeSnapshot().teams.map(({ players, ...team }) => ({
    ...team,
    players: team.team_id === "team-a"
      ? players.map(({ health, shield, loadout, ...player }) => player)
      : players.map((player) => ({ ...player, ...overrides })),
  })),
}).hud.teams[1].players[0];
const scp173 = scpVitals({ health: 1650, shield: 250, max_health: 3300, max_shield: 1000 });
assert.equal(hudHealthPercent(scp173), 50, "SCP health scales by max_health");
assert.equal(hudShieldPercent(scp173), 25, "SCP shield scales by max_shield");
assert.equal(hudAuxPower(scp173), null, "only SCP-079 reports aux power");
const legacyScp = scpVitals({ health: 1650, shield: 250 });
assert.equal(hudHealthPercent(legacyScp), 100, "no cap: the old 0-100 scale");
assert.equal(hudShieldPercent(scpVitals({ health: 100, shield: 0, max_health: 100, max_shield: 0 })), 0, "a zero cap draws an empty bar");
const scp079 = scpVitals({ health: null, shield: null, max_health: null, max_shield: null, aux_power: 50, max_aux_power: 200 });
assert.deepEqual(hudAuxPower(scp079), { percent: 25, value: 50 }, "SCP-079 shows aux power");
assert.equal(hudAuxPower({ ...scp079, is_alive: false }), null, "a dead SCP-079 has no aux bar");
assert.equal(hudAuxPower(scpVitals({ aux_power: 50 })), null, "aux power needs its cap");

// CS2 observer numbers (client.dll team-counter list): CT side (SLGO SCP) first, then T (NTF), contiguous, (i + 1) % 10;
// none at all for more than ten players (CS2: a server for more than ten).
{
  const roster = (prefix, count) => Array.from({ length: count }, (_, index) => ({ player_id: `${prefix}${index + 1}` }));
  const teams = (ntf, scp) => [{ role: "ntf", players: roster("n", ntf) }, { role: "scp", players: roster("s", scp) }];
  const numbersOf = (list) => playerObserverNumbers(list, teammateColorRule({ modeFamily: null, playerLimit: null, teams: list }).numbers);
  assert.deepEqual(numbersOf(teams(5, 5)), { s1: "1", s2: "2", s3: "3", s4: "4", s5: "5",
    n1: "6", n2: "7", n3: "8", n4: "9", n5: "0" }, "5v5: SCP (CT) 1-5, NTF (T) 6-9, 0, whatever the team order");
  assert.deepEqual(numbersOf(teams(4, 6)), { s1: "1", s2: "2", s3: "3", s4: "4", s5: "5", s6: "6",
    n1: "7", n2: "8", n3: "9", n4: "0" }, "a sixth SCP player takes 6 and NTF starts at 7");
  assert.deepEqual(numbersOf(teams(5, 6)), {}, "eleven players and no player_limit: no numbers at all");
  assert.deepEqual(numbersOf(teams(7, 7)), {}, "more than ten players: no numbers at all");
  assert.deepEqual(numbersOf(teams(2, 0)), { n1: "1", n2: "2" }, "an empty SCP side lets NTF start at 1");
  assert.deepEqual(numbersOf([]), {});
  assert.deepEqual(playerObserverNumbers(teams(2, 2), false), {}, "the rule turns numbers off");
}

{
  // CS2 teammate-colour rule (task research cs2-teammate-colour-rule.md): mode family x player limit.
  const roster = (count) => Array.from({ length: count }, (_, index) => ({ player_id: `p${index}` }));
  const teams = (count) => [{ role: "ntf", players: roster(count) }, { role: "scp", players: [] }];
  const rule = (modeFamily, playerLimit, players = 4) => teammateColorRule({ modeFamily, playerLimit, teams: teams(players) });
  assert.deepEqual(rule("competitive", 10), { slots: true, pips: true, numbers: true }, "competitive 5v5: everything on");
  assert.deepEqual(rule("casual", 20), { slots: false, pips: false, numbers: false }, "casual 10v10: everything off");
  assert.deepEqual(rule("casual", 10), { slots: false, pips: false, numbers: true }, "casual with a 10-player cap keeps numbers only");
  assert.deepEqual(rule("competitive", 12), { slots: false, pips: true, numbers: false }, "a custom profile over 10: pips keep slot colours");
  assert.deepEqual(rule("competitive", 2), { slots: true, pips: true, numbers: true }, "a 1v1 custom profile is competitive");
  assert.deepEqual(rule(null, null), { slots: true, pips: true, numbers: true }, "older plugin, small roster: as before");
  assert.deepEqual(rule(null, null, 11), { slots: true, pips: true, numbers: false }, "older plugin: numbers follow the roster");
  assert.deepEqual(rule("casual", null), { slots: true, pips: false, numbers: true }, "slots need both fields; pips only the mode");
  assert.deepEqual(rule(null, 20, 4), { slots: true, pips: true, numbers: false }, "numbers follow player_limit when it is known");

  const casual = hudFor({ mode_family: "casual", player_limit: 20 }).hud;
  assert.equal(casual.modeFamily, "casual");
  assert.equal(casual.playerLimit, 20);
  const legacy = hudFor({}).hud;
  assert.equal(legacy.modeFamily, null, "an older plugin's snapshot has no mode family");
  assert.equal(legacy.playerLimit, null);
}

console.log("hud model smoke: ok");
