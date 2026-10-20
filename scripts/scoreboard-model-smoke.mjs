import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEvent } from "../packages/protocol/src/index.ts";
import { initialRoundHudState, roundHudReducer, selectRoundHud } from "../src/features/hud/model.ts";
import {
  formatScoreboardElapsed,
  initialScoreboardState,
  initialScoreboardViewState,
  scoreboardReducer,
} from "../src/features/scoreboard/model.ts";
import { SCOREBOARD_REASON_ICONS, SCOREBOARD_TOP_ROLE, selectScoreboard } from "../src/features/scoreboard/presentation.ts";

// Scoreboard (`scoreboard.snapshot` joined with `match.snapshot`): source rules, derived stats, blank cells, money
// visibility, the CS2 sort chain, the side switch and the timeline.

const SERVER = "slgo-local-7777";
const INSTANCE = "instance-1";
const envelope = (type, sequence, payload, extra = {}) => ({
  protocol_version: 0, schema_version: 1, event_id: `${type}-${sequence}`, server_id: SERVER, instance_id: INSTANCE,
  sequence, type, sent_at: "2026-10-19T12:00:00Z", payload, ...extra,
});
const parsed = (raw) => {
  const result = parseEvent(raw);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.value;
};
const baseline = parsed(envelope("sidecar.baseline", 1, { baseline: true }));

const human = (id, name, extra = {}) => ({ player_id: id, display_name: name, avatar_url: null, is_online: true, is_alive: true, kills: 0, ...extra });
const NOVA = "76561198000000001";
const KILO = "76561198000000002";
const LIMA = "76561198000000003";
const ECHO = "76561198000000101";
const BOT = "76561198000000102";
const GONE = "76561198000000103";

// Second half of a competitive match: team-a played SCP in the first half and plays NTF now; the viewer is on team-a.
const match = (state = "ActionPhase", round = 15, scores = [6, 8]) => parsed(envelope("match.snapshot", 2, {
  viewer_team_id: "team-a", state, round, max_rounds: 24, phase_remaining_ms: 60_000, phase_paused: false,
  teams: [
    {
      team_id: "team-a", role: "ntf", display_name: "Team A", score: scores[0],
      players: [
        human(NOVA, "Nova", { loadout: { money: 4250, primary_item_id: null, utility_item_ids: [], armor: null, has_commander_keycard: false, has_generator_upgrade: false } }),
        human(KILO, "Kilo", { is_alive: false, loadout: { money: 800, primary_item_id: null, utility_item_ids: [], armor: null, has_commander_keycard: false, has_generator_upgrade: false } }),
        human(LIMA, "Lima", { is_online: false, is_alive: false, loadout: null }),
      ],
    },
    {
      team_id: "team-b", role: "scp", display_name: "Team B", score: scores[1],
      players: [human(ECHO, "Echo"), human(BOT, "Bot"), human(GONE, "Gone", { is_online: false, is_alive: false })],
    },
  ],
}));

const stats = (patch = {}) => ({ rounds_played: 2, kills: 0, deaths: 0, assists: 0, damage: 0, headshot_kills: 0, mvps: 0, utility_damage: 0, enemies_flashed: 0, ...patch });
const rounds = [
  ...Array.from({ length: 12 }, (_, i) => ({ round: i + 1, winner_team_id: i % 3 === 0 ? "team-a" : "team-b", winner_role: i % 3 === 0 ? "scp" : "ntf", reason: "elimination" })),
  { round: 13, winner_team_id: "team-a", winner_role: "ntf", reason: "generator_activated" },
  { round: 14, winner_team_id: "team-b", winner_role: "scp", reason: "time_expired" },
];
const board = (patch = {}) => parsed(envelope("scoreboard.snapshot", 3, {
  mode_name: "竞技模式", mode_icon: "competitive", elapsed_ms: 591_000, max_rounds: 24, score_to_win: 13, halftime_after_round: 12,
  rounds, loss_bonus: { "team-a": 2, "team-b": 0 },
  players: [
    { player_id: NOVA, ping_ms: 42, is_bot: false, ntf: stats({ kills: 3, deaths: 1, assists: 1, damage: 312, headshot_kills: 2, mvps: 1, utility_damage: 48, enemies_flashed: 2 }), scp: stats({ rounds_played: 12, kills: 9, deaths: 6, damage: 1410, mvps: 2 }) },
    { player_id: KILO, ping_ms: 61, is_bot: false, ntf: stats({ kills: 3, deaths: 2, damage: 312, mvps: 1 }), scp: stats({ rounds_played: 12, kills: 4, damage: 500 }) },
    { player_id: LIMA, ping_ms: null, is_bot: false, ntf: stats({ kills: 5, damage: 900 }), scp: stats({ rounds_played: 12 }) },
    { player_id: ECHO, ping_ms: 35, is_bot: false, scp: stats({ kills: 1, damage: 100 }), ntf: stats({ rounds_played: 12, kills: 7, deaths: 3, damage: 1200, headshot_kills: 3, utility_damage: 90, enemies_flashed: 4 }) },
    { player_id: BOT, ping_ms: null, is_bot: true, scp: stats({ kills: 1, damage: 100, assists: 2 }), ntf: stats() },
  ],
  ...patch,
}));

const hudFor = (matchEvent) => {
  let state = roundHudReducer(initialRoundHudState, { type: "connection", status: "live" });
  state = roundHudReducer(state, { type: "event", event: baseline, receivedAtMs: 0 });
  state = roundHudReducer(state, { type: "event", event: matchEvent, receivedAtMs: 0 });
  return selectRoundHud(state, 0);
};
const frameFor = (event, receivedAtMs = 1_000) => {
  let state = scoreboardReducer(initialScoreboardState, { type: "event", event: baseline, receivedAtMs: 0 });
  state = scoreboardReducer(state, { type: "event", event, receivedAtMs });
  return state;
};
const select = ({ hud = hudFor(match()), frame = frameFor(board()).frame, view = initialScoreboardViewState, nowMs = 1_000 } = {}) =>
  selectScoreboard({ hud, frame, view, localPlayerId: NOVA, nowMs });
const cell = (row, stat) => row.cells.find((entry) => entry.stat === stat)?.text;
const ids = (team) => team.rows.map((row) => row.playerId);

{
  // Reducer: same-instance baseline keeps the data, another instance and an ended session clear it, other sources are ignored.
  const state = frameFor(board());
  assert.notEqual(state.frame, null);
  assert.equal(scoreboardReducer(state, { type: "event", event: baseline, receivedAtMs: 5 }), state, "a reconnect to the same instance keeps it");
  const other = parsed({ ...envelope("sidecar.baseline", 1, { baseline: true }), instance_id: "instance-2" });
  assert.equal(scoreboardReducer(state, { type: "event", event: other, receivedAtMs: 5 }).frame, null);
  assert.equal(scoreboardReducer(state, { type: "connection", status: "ended" }), initialScoreboardState);
  assert.equal(scoreboardReducer(state, { type: "connection", status: "offline" }), state);
  const stranger = parsed({ ...envelope("scoreboard.snapshot", 9, board().payload), instance_id: "instance-9" });
  assert.equal(scoreboardReducer(state, { type: "event", event: stranger, receivedAtMs: 5 }), state);
  assert.equal(frameFor(board()).frame.receivedAtMs, 1_000);
}

{
  // Visibility: no scoreboard data (old plugin), waiting states and missing snapshot draw nothing.
  assert.equal(select({ frame: null }), null);
  assert.equal(select({ hud: hudFor(match("WaitingForPlayers", 0)) }), null);
  assert.equal(select({ hud: selectRoundHud(initialRoundHudState, 0) }), null);
  assert.notEqual(select({ hud: hudFor(match("BuyPhase")) }), null);
}

{
  // Header, blocks and page 1: SCP (CS2's CT side) on top; sorted by damage with online players first.
  const view = select({ nowMs: 1_000 + 10_500 });
  assert.equal(SCOREBOARD_TOP_ROLE, "scp");
  assert.equal(view.modeName, "竞技模式");
  assert.equal(view.elapsed, "10:01", "elapsed counts on from the receive time");
  assert.equal(formatScoreboardElapsed(3_725_000), "62:05");
  assert.equal(view.top.role, "scp");
  assert.equal(view.top.side, "ct");
  assert.equal(view.bottom.sideName, "NTF");
  assert.equal(view.bottom.aliveLabel, "存活：1/3");
  assert.deepEqual(view.columns.map((column) => column.label), ["金钱", "杀敌数", "死亡数", "助攻数", "爆%", "伤害"]);

  // NTF (viewer) block: Nova and Kilo tie on damage 312 and kills 3 and MVPs 1; Nova has more assists. Lima is offline: last.
  assert.deepEqual(ids(view.bottom), [NOVA, KILO, LIMA]);
  const [nova, kilo, lima] = view.bottom.rows;
  assert.equal(nova.local, true);
  assert.equal(cell(nova, "money"), "$4250", "own team money");
  assert.equal(cell(nova, "hsp"), "67", "2 of 3 kills");
  assert.equal(cell(nova, "damage"), "312");
  assert.equal(nova.ping, "42");
  assert.equal(kilo.state, "dead");
  assert.equal(lima.state, "offline");
  assert.equal(cell(lima, "money"), "", "offline teammate: no loadout");

  // SCP block: SCP-side stats leave 爆% blank; enemy money is never shown; the bot has no ping.
  const echo = view.top.rows.find((row) => row.playerId === ECHO);
  const bot = view.top.rows.find((row) => row.playerId === BOT);
  assert.equal(cell(echo, "hsp"), "");
  assert.equal(cell(echo, "money"), "");
  assert.equal(bot.bot, true);
  assert.equal(bot.ping, "");
  assert.equal(ids(view.top).at(-1), GONE);
}

{
  // Page 2: MVPs, utility, flashed, KDR, ADR; blanks for SCP rows.
  const view = select({ view: { ...initialScoreboardViewState, page: 2 } });
  assert.deepEqual(view.columns.map((column) => column.stat), ["mvps", "utilitydamage", "enemiesflashed", "kdr", "adr", "damage"]);
  const nova = view.bottom.rows.find((row) => row.playerId === NOVA);
  assert.equal(cell(nova, "utilitydamage"), "48");
  assert.equal(cell(nova, "enemiesflashed"), "2");
  assert.equal(cell(nova, "kdr"), "3.00");
  assert.equal(cell(nova, "adr"), "156", "312 over 2 rounds");
  assert.equal(nova.mvps, 1);
  const echo = view.top.rows.find((row) => row.playerId === ECHO);
  assert.equal(cell(echo, "utilitydamage"), "");
  assert.equal(cell(echo, "kdr"), "1.00", "deaths floor at 1");
}

{
  // Header sort: the clicked stat first, then the chain; deaths ascending; blanks (NaN) sort last.
  const byKills = select({ view: { ...initialScoreboardViewState, sortStat: "kills" } });
  assert.deepEqual(ids(byKills.bottom), [NOVA, KILO, LIMA], "kills tie, then damage, MVPs, assists");
  const byDeaths = select({ view: { ...initialScoreboardViewState, sortStat: "deaths" } });
  assert.deepEqual(ids(byDeaths.bottom), [NOVA, KILO, LIMA], "fewest deaths first, offline last");
  assert.equal(byDeaths.sortStat, "deaths");
  const byAssists = select({ view: { ...initialScoreboardViewState, sortStat: "assists" } });
  assert.deepEqual(ids(byAssists.top), [BOT, ECHO, GONE]);
  const byHsp = select({ view: { ...initialScoreboardViewState, sortStat: "hsp" } });
  assert.deepEqual(ids(byHsp.top), [BOT, ECHO, GONE], "all blank: the chain decides (damage and kills tie, more assists first)");
}

{
  // Side switch: second half of a halftime mode only; the other view shows first-half buckets and no money.
  const other = select({ view: { ...initialScoreboardViewState, side: "other" } });
  assert.equal(other.sideSwitchAvailable, true);
  assert.equal(other.showingOtherSide, true);
  const nova = other.bottom.rows.find((row) => row.playerId === NOVA);
  assert.equal(cell(nova, "damage"), "1410", "Nova's SCP half");
  assert.equal(cell(nova, "money"), "", "no money in the other view");
  assert.equal(cell(nova, "hsp"), "", "SCP-side bucket");
  const echo = other.top.rows.find((row) => row.playerId === ECHO);
  assert.equal(cell(echo, "hsp"), "43", "Echo's NTF half: 3 of 7");
  assert.deepEqual(ids(other.bottom), [NOVA, KILO, LIMA]);

  const firstHalf = select({ hud: hudFor(match("ActionPhase", 5)), view: { ...initialScoreboardViewState, side: "other" } });
  assert.equal(firstHalf.sideSwitchAvailable, false);
  assert.equal(firstHalf.showingOtherSide, false, "falls back to the current side");
  const casual = select({ frame: frameFor(board({ mode_icon: "casual", mode_name: "休闲模式", max_rounds: 15, score_to_win: 8, halftime_after_round: null, rounds: [], loss_bonus: null })).frame, view: { ...initialScoreboardViewState, side: "other" } });
  assert.equal(casual.sideSwitchAvailable, false);
  assert.equal(casual.timeline, null, "CS2's casual template has no timeline");
}

{
  // Timeline: 24 slots split at halftime, winners by block and side colour, half scores, clinch, loss bonus.
  const view = select({ hud: hudFor(match("ActionPhase", 15, [6, 8])) });
  const { timeline } = view;
  assert.equal(timeline.firstHalf.length, 12);
  assert.equal(timeline.secondHalf.length, 12);
  const first = timeline.firstHalf[0];
  assert.deepEqual(first.result, { position: "bottom", role: "scp", icon: SCOREBOARD_REASON_ICONS.elimination }, "team-a (now NTF, bottom) won round 1 as SCP");
  assert.equal(timeline.firstHalf[4].label, "5");
  assert.equal(timeline.secondHalf[0].result.icon, SCOREBOARD_REASON_ICONS.generator_activated);
  assert.equal(timeline.secondHalf[1].result.position, "top");
  assert.equal(timeline.secondHalf[1].result.role, "scp");
  assert.equal(timeline.secondHalf[2].result, null, "round 15 is still being played");
  assert.equal(timeline.secondHalf[2].active, true, "the current round's tick is lit");
  assert.equal(timeline.secondHalf[3].active, false);
  // Half scores: team-a won rounds 1, 4, 7, 10 as SCP (4) and round 13 (1).
  assert.deepEqual(timeline.halfScores[0], { top: 8, bottom: 4, topRole: "ntf", bottomRole: "scp" });
  assert.deepEqual(timeline.halfScores[1], { top: 1, bottom: 1, topRole: "scp", bottomRole: "ntf" });
  // 14 finished; SCP (top) has 8 of 13 -> clinch at round 19; NTF needs 7 -> round 21. Only the earlier trophy shows.
  const clinches = timeline.secondHalf.filter((slot) => slot.clinch).map((slot) => [slot.round, slot.clinch]);
  assert.deepEqual(clinches, [[19, "top"]]);
  assert.equal(timeline.secondHalf.find((slot) => slot.round === 20).pastClinch, true);
  assert.equal(timeline.secondHalf.find((slot) => slot.round === 19).pastClinch, false);
  assert.deepEqual(timeline.lossBonus, { top: 0, bottom: 2 });

  const atRoundEnd = select({ hud: hudFor(match("RoundEnd", 14, [6, 8])) });
  assert.equal(atRoundEnd.timeline.secondHalf[1].result.position, "top", "the ended round shows its result");
}

{
  // The v0 example parses and joins (ids absent from the roster are ignored; roster players without stats are zeros).
  const example = parsed(JSON.parse(readFileSync(new URL("../packages/protocol/v0/scoreboard-snapshot.example.json", import.meta.url), "utf8")));
  const view = select({ frame: frameFor({ ...example, server_id: SERVER, instance_id: INSTANCE }).frame });
  assert.ok(view.bottom.rows.every((row) => row.cells.length === 6));
  assert.equal(cell(view.bottom.rows.find((row) => row.playerId === NOVA), "kills"), "0");
}

console.log("scoreboard model smoke: source rules, visibility, derived stats, blanks, money, sort chain, side switch and timeline ok");
