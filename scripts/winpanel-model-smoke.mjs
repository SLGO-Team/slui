import assert from "node:assert/strict";
import { parseRoundResult } from "../packages/protocol/src/index.ts";
import { initialRoundHudState, roundHudReducer, selectRoundHud } from "../src/features/hud/model.ts";
import { DEFAULT_AVATAR_BY_SIDE } from "../src/features/hud/presentation.ts";
import { createHudSceneFrame, HUD_SCENES } from "../src/mocks/hudScenes.ts";
import { ROLE_COLORS } from "../src/shared/roleColors.ts";
import {
  initialWinPanelState,
  selectWinPanel,
  winPanelReducer,
  winPanelRemainingMs,
} from "../src/features/winpanel/model.ts";
import {
  CHECKER_HEIGHT,
  CHECKER_RUN_MS,
  CHECKER_SQUARE_SIZE,
  CHECKER_WIDTH,
  checkerAlpha,
  checkerEnvelope,
  checkerExitAlpha,
  checkerSeed,
  checkerSquares,
} from "../src/features/winpanel/checker.ts";
import {
  WIN_PANEL_LOSS_COLOR,
  WIN_PANEL_MVP_FILLS,
  WIN_PANEL_NEUTRAL_COLOR,
  WIN_PANEL_TITLE_FILLS,
  winPanelColors,
  winPanelMvpAvatar,
  winPanelRosterFromHud,
} from "../src/features/winpanel/presentation.ts";

// Win panel (`round.result`): lifetime, replay, local expiry, instance changes, colours and avatars.

let sequence = 0;
const envelope = (type, payload, instance = "instance-a") => ({
  protocol_version: 0,
  schema_version: 1,
  event_id: `${type}-${++sequence}`,
  server_id: "server-a",
  instance_id: instance,
  sequence,
  type,
  sent_at: "2026-10-05T12:00:00.000Z",
  payload,
});
const baseline = (instance = "instance-a") => envelope("sidecar.baseline", { baseline: true }, instance);
const mvp = { player_id: "76561198000000001", display_name: "Nova", reason_text: "最多击杀MVP（3杀）", music_kit_name: "收容失效" };
const panel = (overrides = {}) => ({
  result_id: "result-1",
  winner_team: "ntf",
  is_match_end: false,
  title: { text: "回合胜利", outcome: "won" },
  subtitle_text: "发电机已过载",
  mvp,
  visible_remaining_ms: 7_000,
  ...overrides,
});
const result = (value, instance) => envelope("round.result", { panel: value }, instance);
const reduce = (state, event, receivedAtMs) => winPanelReducer(state, { type: "event", event, receivedAtMs });
const roster = { "76561198000000001": { avatarUrl: "https://avatars.example/nova.jpg", role: "ntf" } };

// Every frame below is a valid protocol payload.
for (const value of [panel(), panel({ result_id: "result-2" }), null]) assert.equal(parseRoundResult({ panel: value }).ok, true);

// Nothing before a baseline, and nothing from another instance.
assert.equal(reduce(initialWinPanelState, result(panel()), 1_000), initialWinPanelState);
let state = reduce(initialWinPanelState, baseline(), 1_000);
assert.equal(reduce(state, result(panel(), "instance-b"), 1_000), state);

// Appear: a new result_id shows from its receive time.
state = reduce(state, result(panel()), 10_000);
let view = selectWinPanel(state, 10_000, roster);
assert.ok(view);
assert.equal(view.resultId, "result-1");
assert.equal(view.title, "回合胜利");
assert.equal(view.subtitle, "发电机已过载");
assert.equal(view.outcome, "won");
assert.equal(view.winnerRole, "ntf");
assert.equal(view.isMatchEnd, false);
assert.equal(view.shownAtMs, 10_000);
assert.equal(view.exitAtMs, 17_000);
assert.deepEqual(view.mvp, {
  playerId: "76561198000000001",
  name: "Nova",
  reason: "最多击杀MVP（3杀）",
  musicKit: "收容失效",
  avatarUrl: "https://avatars.example/nova.jpg",
  fallbackAvatarUrl: DEFAULT_AVATAR_BY_SIDE.t,
});
assert.equal(winPanelRemainingMs(state.frame, 12_500), 4_500);

// Replay of the same result (sidecar cache, reconnect): same mount, refreshed hold time.
state = reduce(state, result(panel({ visible_remaining_ms: 4_000 })), 13_000);
view = selectWinPanel(state, 13_000, roster);
assert.equal(view.resultId, "result-1");
assert.equal(view.shownAtMs, 10_000, "a replay never re-animates");
assert.equal(view.exitAtMs, 17_000);

// Local expiry: hidden once the interpolated hold time runs out, without a clearing frame.
assert.ok(selectWinPanel(state, 16_999, roster));
assert.equal(selectWinPanel(state, 17_000, roster), null);
// A replay arriving after the local expiry does not bring the panel back.
const expired = reduce(state, result(panel({ visible_remaining_ms: 500 })), 17_200);
assert.equal(selectWinPanel(expired, 17_200, roster), null);
assert.equal(expired.endedResultId, "result-1");
// ...but the next result does.
const next = reduce(expired, result(panel({ result_id: "result-2" })), 18_000);
assert.equal(selectWinPanel(next, 18_000, roster).resultId, "result-2");
assert.equal(selectWinPanel(next, 18_000, roster).shownAtMs, 18_000);

// panel: null hides at once; a late replay of the ended result stays hidden.
let cleared = reduce(state, result(null), 14_000);
assert.equal(selectWinPanel(cleared, 14_000, roster), null);
assert.equal(cleared.endedResultId, "result-1");
cleared = reduce(cleared, result(panel({ visible_remaining_ms: 2_000 })), 14_100);
assert.equal(selectWinPanel(cleared, 14_100, roster), null);
// A clearing frame with nothing shown changes nothing.
assert.equal(reduce(cleared, result(null), 14_200), cleared);

// A different result replaces the current one directly (new mount).
const replaced = reduce(state, result(panel({ result_id: "result-3", title: { text: "回合败北", outcome: "lost" }, winner_team: "scp", mvp: null })), 14_000);
assert.equal(selectWinPanel(replaced, 14_000, roster).resultId, "result-3");
assert.equal(selectWinPanel(replaced, 14_000, roster).shownAtMs, 14_000);
assert.equal(selectWinPanel(replaced, 14_000, roster).mvp, null);
// The replaced result has ended: a late copy of it does not take the panel back.
assert.equal(replaced.endedResultId, "result-1");
assert.equal(reduce(replaced, result(panel()), 14_100), replaced);

// A reconnect to the same instance keeps the panel; another server instance clears it.
assert.equal(reduce(state, baseline(), 14_000), state);
const restarted = reduce(state, baseline("instance-b"), 14_000);
assert.equal(restarted.frame, null);
assert.equal(selectWinPanel(restarted, 14_000, roster), null);
assert.equal(restarted.endedResultId, null);
assert.deepEqual(restarted.source, { serverId: "server-a", instanceId: "instance-b" });
// Results of the old instance no longer apply.
assert.equal(reduce(restarted, result(panel({ result_id: "result-9" })), 14_100), restarted);

// Colours (parent PRD R2): won / observer = winner colour + team-tinted fill; lost = loss red on a
// neutral fill; draw = neutral. The MVP strip always follows the winner.
assert.deepEqual(winPanelColors("won", "ntf"), { accent: ROLE_COLORS.ntf, fill: WIN_PANEL_TITLE_FILLS.ntf, mvpAccent: ROLE_COLORS.ntf, mvpFill: WIN_PANEL_MVP_FILLS.ntf });
assert.deepEqual(winPanelColors("won", "scp"), { accent: ROLE_COLORS.scp, fill: WIN_PANEL_TITLE_FILLS.scp, mvpAccent: ROLE_COLORS.scp, mvpFill: WIN_PANEL_MVP_FILLS.scp });
assert.deepEqual(winPanelColors("observer", "scp"), winPanelColors("won", "scp"));
assert.deepEqual(winPanelColors("observer", "ntf"), winPanelColors("won", "ntf"));
assert.deepEqual(winPanelColors("lost", "scp"), { accent: WIN_PANEL_LOSS_COLOR, fill: WIN_PANEL_TITLE_FILLS.neutral, mvpAccent: ROLE_COLORS.scp, mvpFill: WIN_PANEL_MVP_FILLS.scp });
assert.deepEqual(winPanelColors("lost", "ntf"), { accent: WIN_PANEL_LOSS_COLOR, fill: WIN_PANEL_TITLE_FILLS.neutral, mvpAccent: ROLE_COLORS.ntf, mvpFill: WIN_PANEL_MVP_FILLS.ntf });
assert.deepEqual(winPanelColors("draw", null), { accent: WIN_PANEL_NEUTRAL_COLOR, fill: WIN_PANEL_TITLE_FILLS.neutral, mvpAccent: WIN_PANEL_NEUTRAL_COLOR, mvpFill: WIN_PANEL_MVP_FILLS.neutral });
// SCP win and loss share the colour family and differ by fill (user decision 2026-10-05).
assert.notEqual(winPanelColors("won", "scp").fill, winPanelColors("lost", "ntf").fill);
assert.equal(selectWinPanel(replaced, 14_000, roster).colors.accent, WIN_PANEL_LOSS_COLOR);

// Avatars: Steam avatar from the roster, side default otherwise (NTF = T side, SCP = CT side).
assert.deepEqual(winPanelMvpAvatar("76561198000000001", "ntf", roster), { avatarUrl: "https://avatars.example/nova.jpg", fallbackAvatarUrl: DEFAULT_AVATAR_BY_SIDE.t });
assert.deepEqual(winPanelMvpAvatar("76561198000000006", "scp", { "76561198000000006": { avatarUrl: null, role: "scp" } }), { avatarUrl: null, fallbackAvatarUrl: DEFAULT_AVATAR_BY_SIDE.ct });
assert.deepEqual(winPanelMvpAvatar("76561198000000007", "scp", {}), { avatarUrl: null, fallbackAvatarUrl: DEFAULT_AVATAR_BY_SIDE.ct });
assert.deepEqual(winPanelMvpAvatar("76561198000000007", "ntf", {}), { avatarUrl: null, fallbackAvatarUrl: DEFAULT_AVATAR_BY_SIDE.t });
assert.deepEqual(winPanelMvpAvatar("76561198000000007", null, {}), { avatarUrl: null, fallbackAvatarUrl: DEFAULT_AVATAR_BY_SIDE.ct });

// The roster comes from the latest match.snapshot (blank avatar URLs count as missing).
const hudState = [
  baseline(),
  envelope("match.snapshot", {
    viewer_team_id: "team-a", state: "RoundEnd", round: 3, max_rounds: 15, phase_remaining_ms: 5_000, phase_paused: true,
    teams: [
      { team_id: "team-a", role: "ntf", display_name: "A", score: 2, players: [
        { player_id: "76561198000000001", display_name: "Nova", avatar_url: "https://avatars.example/nova.jpg", is_online: true, is_alive: true },
      ] },
      { team_id: "team-b", role: "scp", display_name: "B", score: 1, players: [
        { player_id: "76561198000000006", display_name: "Rook", avatar_url: "  ", is_online: true, is_alive: false },
      ] },
    ],
  }),
].reduce((current, event) => roundHudReducer(current, { type: "event", event, receivedAtMs: 1_000 }), { ...initialRoundHudState, connectionStatus: "live" });
assert.deepEqual(winPanelRosterFromHud(selectRoundHud(hudState, 1_000)), {
  "76561198000000001": { avatarUrl: "https://avatars.example/nova.jpg", role: "ntf" },
  "76561198000000006": { avatarUrl: null, role: "scp" },
});
assert.deepEqual(winPanelRosterFromHud(selectRoundHud(initialRoundHudState, 1_000)), {});

// Every mock scene is a valid round.result frame, and the win scenes show a panel.
const winScenes = ["win-mvp-kills", "win-mvp-ace", "win-no-mvp", "lost", "match-won", "match-draw", "observer"];
for (const scene of HUD_SCENES) {
  for (const viewerRole of ["ntf", "scp"]) {
    const frame = createHudSceneFrame(scene, viewerRole, 2_000);
    assert.equal(parseRoundResult(frame.result).ok, true, `${scene} (${viewerRole})`);
    assert.equal(frame.result.panel !== null, winScenes.includes(scene), `${scene} (${viewerRole}) panel`);
    if (frame.result.panel === null) continue;
    let sceneState = reduce(initialWinPanelState, baseline(), 0);
    sceneState = reduce(sceneState, result(frame.result.panel), 0);
    const sceneView = selectWinPanel(sceneState, 0, {});
    assert.equal(sceneView.title, frame.result.panel.title.text);
    // A pinned moment re-sent every second keeps the same result: no re-animation.
    const again = createHudSceneFrame(scene, viewerRole, 2_000);
    assert.equal(selectWinPanel(reduce(sceneState, result(again.result.panel), 1_000), 1_000, {}).shownAtMs, 0);
  }
}
assert.equal(createHudSceneFrame("lost", "ntf", 2_000).result.panel.title.outcome, "lost");
assert.deepEqual(winPanelColors("won", createHudSceneFrame("win-mvp-kills", "scp", 0).result.panel.winner_team).accent, ROLE_COLORS.scp);

// Checker (recording): 5 rows on a 19.32px pitch centred on the strip, a gap on the vertical centre line.
const squares = checkerSquares();
assert.deepEqual([...new Set(squares.map((square) => square.row))], [0, 1, 2, 3, 4]);
const middle = squares.filter((square) => square.row === 2);
assert.ok(Math.abs(middle[0].y + CHECKER_SQUARE_SIZE / 2 - CHECKER_HEIGHT / 2) < 1e-9);
assert.ok(middle.some((square) => Math.abs(square.x + CHECKER_SQUARE_SIZE + 1.16 - CHECKER_WIDTH / 2) < 1e-9));
assert.ok(squares.every((square) => square.x + CHECKER_SQUARE_SIZE > 0 && square.x < CHECKER_WIDTH));
// Envelope: 350ms rise, hold until 1s, linear fade until 1.95s.
assert.equal(checkerEnvelope(-1), 0);
assert.equal(checkerEnvelope(175), 0.5);
assert.equal(checkerEnvelope(700), 1);
assert.ok(Math.abs(checkerEnvelope(1_475) - 0.5) < 1e-9);
assert.equal(checkerEnvelope(1_950), 0);
// Deterministic per result; about 60 % of the squares light on a pass; nothing before the strip or after 9 s.
const seed = checkerSeed("win-mvp-kills-0");
assert.equal(seed, checkerSeed("win-mvp-kills-0"));
assert.notEqual(seed, checkerSeed("win-mvp-kills-1"));
assert.ok(squares.every((square) => checkerAlpha(seed, square, -1) === 0 && checkerAlpha(seed, square, CHECKER_RUN_MS) === 0));
const rowMean = (row, ms) => {
  const inRow = squares.filter((square) => square.row === row);
  return inRow.reduce((sum, square) => sum + checkerAlpha(seed, square, ms), 0) / inRow.length;
};
// The wave climbs one row every 468ms (2.34s per cycle): the one dark row moves up and wraps to the bottom.
const darkestRow = (ms) => [0, 1, 2, 3, 4].reduce((best, row) => (rowMean(row, ms) < rowMean(best, ms) ? row : best), 0);
assert.deepEqual([2_600, 3_068, 3_536, 4_004, 4_472].map(darkestRow), [2, 1, 0, 4, 3]);
assert.ok(rowMean(4, 2_600) > 0.08);
const lit = squares.filter((square) => checkerExitAlpha(seed, square) > 0).length / squares.length;
assert.ok(lit > 0.45 && lit < 0.75, `exit pattern lit share ${lit}`);
assert.ok(squares.every((square) => checkerExitAlpha(seed, square) <= 0.26 * 1.65 * 1.12 + 1e-9));

console.log("win panel model smoke passed");
