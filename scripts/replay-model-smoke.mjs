import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCommand, parseEvent } from "../packages/protocol/src/index.ts";
import { initialRoundHudState, roundHudReducer, selectRoundHud } from "../src/features/hud/model.ts";
import { chatInputReducer, initialChatInputState } from "../src/features/chat/model.ts";
import { initialKillfeedState, killfeedReducer } from "../src/features/killfeed/model.ts";
import { initialScoreboardState, scoreboardReducer } from "../src/features/scoreboard/model.ts";
import { initialWinPanelState, selectWinPanel, winPanelReducer } from "../src/features/winpanel/model.ts";
import { anchorHudClock, hudClockRate, hudTimeAt, WALL_HUD_CLOCK } from "../src/features/replay/clock.ts";
import {
  catalogQuery,
  createCommandBudget,
  createSeekPacer,
  REPLAY_COMMAND_BUDGET,
  SIDECAR_COMMAND_RATE_LIMIT,
  killSeekPositionMs,
  localDateBound,
  nextReplaySpeed,
  replayCatalog,
  replayCommandLabel,
  replayControl,
  replayLoad,
  replayPin,
  replayPov,
  replayUnload,
  replayUnpin,
  validatePinReason,
} from "../src/features/replay/commands.ts";
import {
  currentRoundAt,
  EMPTY_CATALOG_FILTERS,
  highlightIntervalAt,
  REPLAY_TOO_FAST_TEXT,
  replayFailureText,
  replayHighlightIntervals,
  replayHighlightStep,
  runReplayHighlightStep,
  REPLAY_HIGHLIGHT_RETRY_MIN_MS,
  replayIntervalIndexAt,
  replayPlaybackOf,
  replayTimelineEvents,
  inWarmupAt,
  initialReplayState,
  REPLAY_COMMAND_TIMEOUT_MS,
  REPLAY_EVENT_TYPES,
  replayPlayerRows,
  replayLineAgeMs,
  replayPositionAt,
  replayReducer,
  replaySlotTeams,
  replayTransition,
  selectReplayMode,
  timelineGeometry,
} from "../src/features/replay/model.ts";
import { formatCatalogPage, formatReplaySpeed, formatReplayTime } from "../src/features/replay/presentation.ts";

// Demo replay client logic (design 11-07-demo-replay-slui §2, §3, §11): reducer, position, timeline, player list,
// commands, the seek pacer, catalog queries and the HUD clock.

const fixture = (name) => {
  const result = parseEvent(JSON.parse(readFileSync(new URL(`../packages/protocol/v0/${name}`, import.meta.url), "utf8")));
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.error)}`);
  return result.value;
};
const stateEvent = fixture("replay-state.example.json");
const warmupEvent = fixture("replay-state-warmup.example.json");
const idleEvent = fixture("replay-state-idle.example.json");
const catalogEvent = fixture("replay-catalog.example.json");
const omniscientEvent = fixture("match-snapshot-omniscient.example.json");
const baseline = { ...stateEvent, event_id: "baseline", sequence: 1, type: "sidecar.baseline", payload: { baseline: true } };
const withPayload = (event, patch) => ({ ...event, payload: { ...event.payload, ...patch } });
const withPlayback = (event, playback) => withPayload(event, { playback: { ...event.payload.playback, ...playback } });
const demo = stateEvent.payload.demo;

const T0 = 1_000_000;
const live = replayReducer(initialReplayState, { type: "connection", status: "live" });
const enter = (event = stateEvent, at = T0) => replayReducer(replayReducer(live, { type: "event", event: baseline, receivedAtMs: at - 10 }), { type: "event", event, receivedAtMs: at });

{
  // Replay mode: on with a replay.state, off at a baseline (the sidecar replays replay.state right after it) and when
  // the session's match ends; a lost connection keeps it.
  assert.equal(selectReplayMode(live), false);
  const state = enter();
  assert.equal(selectReplayMode(state), true);
  const rebased = replayReducer(state, { type: "event", event: baseline, receivedAtMs: T0 + 5 });
  assert.equal(selectReplayMode(rebased), false, "a baseline leaves replay mode");
  assert.equal(selectReplayMode(replayReducer(rebased, { type: "event", event: stateEvent, receivedAtMs: T0 + 6 })), true, "the replayed state re-enters");
  for (const status of ["ended", "not-in-game", "game-not-running"]) {
    assert.equal(selectReplayMode(replayReducer(state, { type: "connection", status })), false, `${status} leaves replay mode`);
  }
  assert.equal(selectReplayMode(replayReducer(state, { type: "connection", status: "offline" })), true, "offline keeps it until the next baseline");
  assert.equal(selectReplayMode(enter(idleEvent)), true, "an idle replay server (nothing loaded) is still replay mode");
}

{
  // Match servers: every event a match server sends leaves the replay state empty.
  let state = live;
  for (const name of ["match-snapshot.example.json", "hud-killfeed.example.json", "hud-messages.example.json", "round-result.example.json", "scoreboard-snapshot.example.json", "command-result.example.json"]) {
    const event = fixture(name);
    if (REPLAY_EVENT_TYPES.has(event.type)) state = replayReducer(state, { type: "event", event, receivedAtMs: T0 });
  }
  assert.equal(selectReplayMode(state), false, "a match server never enters replay mode");
  assert.equal(state.current, null);
}

{
  // Position: interpolated from the receive time (pause stays, speed scales, skips are jumped, the end stops);
  // a pending seek wins until the next replay.state.
  const playing = enter();
  assert.equal(replayPositionAt(playing, T0 + 2_000).positionMs, 63_000);
  const fast = enter(withPlayback(stateEvent, { speed: 4 }));
  assert.equal(replayPositionAt(fast, T0 + 2_000).positionMs, 69_000);
  const paused = enter(withPlayback(stateEvent, { playing: false }));
  assert.equal(replayPositionAt(paused, T0 + 60_000).positionMs, 61_000);
  const start = enter(withPlayback(stateEvent, { position_ms: 0 }));
  assert.equal(replayPositionAt(start, T0 + 1_000).positionMs, 13_000, "the intro skip 0-12 s is jumped");
  const nearEnd = enter(withPlayback(stateEvent, { position_ms: demo.duration_ms - 500 }));
  const end = replayPositionAt(nearEnd, T0 + 5_000);
  assert.deepEqual([end.positionMs, end.playing, end.atEnd], [demo.duration_ms, false, true], "playback stops at the end");
  const seeking = replayReducer(playing, { type: "command", command: replayControl({ action: "seek", position_ms: 500_000 }), label: "跳转", sentAtMs: T0 + 100, seekMs: 500_000 });
  assert.equal(replayPositionAt(seeking, T0 + 2_000).positionMs, 500_000, "the playhead shows the seek target");
  const answered = replayReducer(seeking, { type: "event", event: withPlayback(stateEvent, { position_ms: 500_000 }), receivedAtMs: T0 + 300 });
  assert.equal(answered.pendingSeekMs, null, "the new state replaces it");
  assert.equal(replayPositionAt(enter(idleEvent), T0), null, "nothing loaded: no position");
}

{
  // Rounds and warmup.
  assert.equal(currentRoundAt(demo.timeline, 5_000), null, "before the first round mark");
  assert.equal(currentRoundAt(demo.timeline, 42_000), 1);
  assert.equal(currentRoundAt(demo.timeline, 170_000), 2);
  const warmupTimeline = warmupEvent.payload.demo.timeline;
  assert.notEqual(warmupTimeline.warmup, null);
  assert.equal(inWarmupAt(warmupTimeline, warmupTimeline.warmup.start_ms), true);
  assert.equal(inWarmupAt(warmupTimeline, (warmupTimeline.warmup.end_ms ?? warmupTimeline.rounds[0].at_ms) + 1), false);
  assert.equal(inWarmupAt(demo.timeline, 0), false, "a recording without warmup");
  const open = { warmup: { start_ms: 0, end_ms: null }, rounds: [] };
  assert.equal(inWarmupAt(open, 999_999), true, "a recording that ended in warmup is warmup to the end");
}

{
  // Timeline geometry: fractions, alternating round bands, killer team colours, open pauses.
  const geometry = timelineGeometry(demo, new Map([[2, "team-b"]]));
  const d = demo.duration_ms;
  assert.equal(geometry.warmup, null);
  assert.deepEqual(geometry.rounds.map((band) => [band.round, band.odd]), [[1, true], [2, false]]);
  assert.equal(geometry.rounds[0].start, 12_000 / d);
  assert.equal(geometry.rounds[0].end, 168_000 / d, "a band runs to the next round's first mark");
  assert.equal(geometry.rounds[1].end, 1, "the last band runs to the end");
  assert.deepEqual(geometry.kills.map((kill) => kill.team), ["team-b", null], "killer slot 2 is team-b; no killer is neutral");
  assert.deepEqual(geometry.generators.map((generator) => generator.state), ["activated", "completed"]);
  const open = timelineGeometry({ ...demo, timeline: { ...demo.timeline, pauses: [{ start_ms: 300_000, end_ms: null }] } });
  assert.equal(open.pauses[0].end, 1, "an unended pause runs to the end");
  const warmup = timelineGeometry(warmupEvent.payload.demo);
  assert.notEqual(warmup.warmup, null);
  assert.ok(warmup.warmup.end <= (warmup.rounds[0]?.start ?? 1));
  const all = [geometry.warmup, ...geometry.rounds, ...geometry.pauses, ...geometry.skips].filter(Boolean);
  assert.ok(all.every((span) => span.start >= 0 && span.end <= 1 && span.start <= span.end), "every span within 0-1");
  assert.equal(timelineGeometry({ duration_ms: 0, timeline: { ...demo.timeline, rounds: [], kills: [{ at_ms: 0, killer_slot: null, victim_slot: 0 }], generators: [], pauses: [], skips: [] } }).kills[0].at, 0, "a zero duration does not divide by zero");
}

{
  // Player list: slots joined to the omniscient snapshot by player_id; the dead are not selectable; unmatched slots
  // are absent; no snapshot (v1.0 recording) lists every recorded player.
  let hudState = roundHudReducer(initialRoundHudState, { type: "connection", status: "live" });
  hudState = roundHudReducer(hudState, { type: "event", event: { ...omniscientEvent, type: "sidecar.baseline", sequence: 1, payload: { baseline: true } }, receivedAtMs: 0 });
  hudState = roundHudReducer(hudState, { type: "event", event: omniscientEvent, receivedAtMs: 0 });
  const hud = selectRoundHud(hudState, 0);
  const snapshotIds = new Set(hud.teams.flatMap((team) => team.players.map((player) => player.player_id)));
  const recorded = {
    players: [
      ...hud.teams.flatMap((team) => team.players).map((player, slot) => ({ slot, player_id: player.player_id, display_name: player.display_name })),
      { slot: 40, player_id: "76561198000000999", display_name: "Ghost" },
    ],
  };
  const groups = replayPlayerRows(recorded, hud, 1);
  assert.deepEqual(groups.map((group) => group.key), [...hud.teams.map((team) => team.teamId), "absent"]);
  const rows = groups.flatMap((group) => group.rows);
  assert.equal(rows.filter((row) => row.isPov).length, 1);
  assert.equal(rows.find((row) => row.slot === 1).isPov, true);
  for (const row of rows) {
    if (!snapshotIds.has(row.playerId)) continue;
    const player = hud.teams.flatMap((team) => team.players).find((candidate) => candidate.player_id === row.playerId);
    assert.equal(row.selectable, player.is_online && player.is_alive, `${row.name}: selectable only when online and alive`);
  }
  assert.deepEqual(groups.at(-1).rows.map((row) => [row.name, row.selectable]), [["Ghost", false]]);
  assert.equal(replaySlotTeams(recorded, hud).get(0), hud.teams.find((team) => team.players.some((player) => player.player_id === recorded.players[0].player_id)).teamId);
  const v10 = replayPlayerRows(demo, selectRoundHud(initialRoundHudState, 0), null);
  assert.deepEqual(v10.map((group) => group.key), ["recorded"]);
  assert.equal(v10[0].rows.every((row) => row.selectable), true);
}

{
  // Commands: every constructor is a valid wire command; labels name each.
  const commands = [
    replayControl({ action: "play" }), replayControl({ action: "pause" }), replayControl({ action: "toggle" }), replayControl({ action: "step" }),
    replayControl({ action: "speed", speed: 0.25 }), replayControl({ action: "seek", position_ms: 0 }), replayControl({ action: "seek", delta_ms: -10_000 }),
    replayControl({ action: "round", round: "next" }), replayControl({ action: "round", round: "prev" }), replayControl({ action: "round", round: 7 }),
    replayLoad(demo.match_id), replayUnload(), replayPov(3), replayPov(null), replayPin(demo.match_id, "clutch"), replayUnpin(demo.match_id),
    replayCatalog({ page: 1 }),
  ];
  for (const command of commands) {
    const parsed = parseCommand(command);
    assert.equal(parsed.ok, true, `${command.kind}: ${JSON.stringify(parsed.error)}`);
    assert.ok(replayCommandLabel(command).length > 0);
  }
  assert.equal(new Set(commands.map((command) => command.command_id)).size, commands.length, "unique command ids");
  assert.equal(killSeekPositionMs(61_234), 59_234);
  assert.equal(killSeekPositionMs(1_000), 0);
  assert.equal(nextReplaySpeed(1, 1), 2);
  assert.equal(nextReplaySpeed(1, -1), 0.5);
  assert.equal(nextReplaySpeed(4, 1), null);
  assert.equal(nextReplaySpeed(0.25, -1), null);
  assert.equal(nextReplaySpeed(1.5, 1), 2, "an off-menu speed steps to the next menu entry");
  assert.equal(formatReplaySpeed(0.25), "0.25×");
  assert.equal(formatReplayTime(61_250), "1:01");
  assert.equal(formatReplayTime(61_250, true), "1:01.2");
  assert.equal(formatReplayTime(3_725_000), "62:05");
  assert.equal(formatCatalogPage(2, 4, 38), "第 2 / 4 页，共 38 条");
}

{
  // Seek pacer: the first seek goes at once, later ones within 500 ms merge; relative steps add up, a zero sum
  // sends nothing; an absolute target replaces what is queued; never more than 2 per second (the sidecar's rate).
  let now = 0;
  const timers = [];
  const sent = [];
  const pacer = createSeekPacer({
    now: () => now,
    schedule(callback, ms) {
      const timer = { at: now + ms, callback, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    send: (seek) => sent.push({ at: now, ...seek }),
  });
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      const next = timers.filter((timer) => !timer.cancelled && timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.cancelled = true;
      next.callback();
    }
    now = until;
  };
  pacer.seekBy(10_000);
  assert.deepEqual(sent, [{ at: 0, delta_ms: 10_000 }], "the first step goes at once");
  advance(50); pacer.seekBy(10_000);
  advance(50); pacer.seekBy(10_000);
  advance(50); pacer.seekBy(-10_000);
  assert.equal(sent.length, 1, "steps within the window wait");
  advance(350);
  assert.deepEqual(sent.at(-1), { at: 500, delta_ms: 10_000 }, "merged into one relative seek at the window's end");
  advance(600); pacer.seekBy(10_000);
  const before = sent.length;
  advance(10); pacer.seekBy(-10_000); advance(10); pacer.seekBy(10_000); advance(10); pacer.seekBy(-10_000); advance(10); pacer.seekBy(10_000);
  advance(500);
  assert.equal(sent.length, before, "a zero sum sends nothing");
  advance(1_000); pacer.seekBy(10_000); advance(10); pacer.seekTo(90_000); advance(10); pacer.seekBy(5_000);
  advance(1_000);
  assert.deepEqual(sent.slice(-2).map(({ at, ...seek }) => seek), [{ delta_ms: 10_000 }, { position_ms: 95_000 }], "absolute replaces, a later step adds to it");
  pacer.seekTo(1_000); advance(10); pacer.seekTo(2_000); pacer.cancel(); advance(1_000);
  assert.deepEqual(sent.at(-1).position_ms, 1_000, "cancel drops the queued seek");
  // Hammering for 3 seconds (auto-repeat every 30 ms) stays at <= 2 per second.
  const start = sent.length;
  const t0 = now;
  for (let i = 0; i < 100; i += 1) { pacer.seekBy(10_000); advance(30); }
  advance(1_000);
  const burst = sent.slice(start);
  for (const seek of burst) assert.ok(burst.filter((other) => other.at >= seek.at && other.at < seek.at + 1_000).length <= 2, "at most 2 seeks in any second");
  assert.equal(burst.reduce((sum, seek) => sum + seek.delta_ms, 0), 1_000_000, "no step is lost");
  assert.ok(burst.every((seek) => seek.at >= t0));
}

{
  // Pin reasons and catalog queries.
  assert.deepEqual(validatePinReason("  clutch 1v4 "), { ok: true, reason: "clutch 1v4" });
  assert.equal(validatePinReason("   ").ok, false);
  assert.equal(validatePinReason("a\nb").ok, false);
  assert.equal(validatePinReason("x".repeat(128)).ok, true);
  assert.equal(validatePinReason("x".repeat(129)).ok, false);
  assert.deepEqual(catalogQuery(EMPTY_CATALOG_FILTERS, 1), { ok: true, query: { page: 1 } }, "empty fields are left out");
  assert.deepEqual(catalogQuery({ ...EMPTY_CATALOG_FILTERS, serverId: " competitive ", player: " Orion ", test: "exclude", pinnedOnly: true }, 3).query,
    { page: 3, server_id: "competitive", player: "Orion", test: false, pinned: true });
  assert.equal(catalogQuery({ ...EMPTY_CATALOG_FILTERS, test: "only" }, 1).query.test, true);
  const since = localDateBound("2026-11-12", "start");
  const until = localDateBound("2026-11-12", "end");
  assert.equal(new Date(since).getHours(), 0, "the local day starts at local midnight");
  assert.equal(Date.parse(until) - Date.parse(since), 86_400_000 - 1, "a local day (no DST change on that date) spans 24 h minus 1 ms");
  assert.equal(localDateBound("2026-02-31", "start"), null, "an impossible date");
  assert.deepEqual(catalogQuery({ ...EMPTY_CATALOG_FILTERS, since: "2026-11-12", until: "2026-11-12" }, 1).query, { page: 1, since, until });
  assert.equal(catalogQuery({ ...EMPTY_CATALOG_FILTERS, since: "2026-11-13", until: "2026-11-12" }, 1).ok, false, "end before start is refused");
  assert.equal(parseCommand(replayCatalog(catalogQuery({ ...EMPTY_CATALOG_FILTERS, since: "2026-11-12", until: "2026-11-14", player: "76561198000000004" }, 2).query)).ok, true);
}

{
  // Catalog flow: only the latest query's page; page before or after its result; a refused query; pin refreshes.
  const state = enter();
  const first = replayCatalog({ page: 1 });
  const second = { ...replayCatalog({ page: 2 }), command_id: catalogEvent.payload.command_id };
  let next = replayReducer(state, { type: "command", command: first, label: "录像列表", sentAtMs: T0 });
  next = replayReducer(next, { type: "command", command: second, label: "录像列表", sentAtMs: T0 + 1 });
  const stalePage = withPayload(catalogEvent, { command_id: first.command_id });
  assert.equal(replayReducer(next, { type: "event", event: stalePage, receivedAtMs: T0 + 2 }).catalog.page, null, "a late page of an older query is dropped");
  const accepted = (command, status = "accepted", reason) => ({ ...stateEvent, type: "command.result", payload: { command_id: command.command_id, command_kind: command.kind, status, ...(reason ? { reason } : {}) } });
  const pageFirst = replayReducer(next, { type: "event", event: catalogEvent, receivedAtMs: T0 + 3 });
  assert.equal(pageFirst.catalog.page.total, catalogEvent.payload.total, "the page before its result");
  const resultAfter = replayReducer(pageFirst, { type: "event", event: accepted(second), receivedAtMs: T0 + 4 });
  assert.equal(resultAfter.catalog.page.total, catalogEvent.payload.total);
  assert.equal(resultAfter.pending[second.command_id], undefined);
  const resultFirst = replayReducer(replayReducer(next, { type: "event", event: accepted(second), receivedAtMs: T0 + 3 }), { type: "event", event: catalogEvent, receivedAtMs: T0 + 4 });
  assert.equal(resultFirst.catalog.page.total, catalogEvent.payload.total, "the page after its result");
  const refused = replayReducer(next, { type: "event", event: accepted(second, "rejected", "目录扫描失败"), receivedAtMs: T0 + 3 });
  assert.match(refused.catalog.rejected, /目录扫描失败/);
  assert.match(refused.notice.text, /目录扫描失败/);
  const pin = replayPin(demo.match_id, "clutch");
  const pinned = replayReducer(replayReducer(resultAfter, { type: "command", command: pin, label: "Pin", sentAtMs: T0 }), { type: "event", event: accepted(pin), receivedAtMs: T0 + 5 });
  assert.equal(pinned.catalog.revision, resultAfter.catalog.revision + 1, "an accepted pin marks the page out of date");
  assert.equal(pinned.pending[pin.command_id], undefined);
}

{
  // Results: other features' results are ignored; unsupported reads as "not a replay server"; a send failure and a
  // missing result resolve locally; the notice fades.
  const state = enter();
  const play = replayControl({ action: "play" });
  const sent = replayReducer(state, { type: "command", command: play, label: "播放", sentAtMs: T0 });
  const shopResult = fixture("command-result.example.json");
  assert.equal(replayReducer(sent, { type: "event", event: shopResult, receivedAtMs: T0 + 1 }), sent, "another feature's result");
  const unsupported = replayReducer(sent, { type: "event", event: { ...shopResult, payload: { command_id: play.command_id, command_kind: play.kind, status: "rejected", reason: "unsupported" } }, receivedAtMs: T0 + 1 });
  assert.equal(unsupported.notice.text, "当前服务器不支持回放");
  const atEnd = replayReducer(sent, { type: "event", event: { ...shopResult, payload: { command_id: play.command_id, command_kind: play.kind, status: "rejected", reason: "已在终点" } }, receivedAtMs: T0 + 1 });
  assert.equal(atEnd.notice.text, "播放被拒绝：已在终点", "the plugin's reason as is");
  const failed = replayReducer(sent, { type: "send-failed", commandId: play.command_id, reason: "not live", atMs: T0 + 1 });
  assert.deepEqual([failed.pending[play.command_id], failed.notice.text], [undefined, "播放未送达：not live"]);
  assert.equal(replayReducer(sent, { type: "tick", nowMs: T0 + REPLAY_COMMAND_TIMEOUT_MS - 1 }), sent, "no change before the timeout");
  const timedOut = replayReducer(sent, { type: "tick", nowMs: T0 + REPLAY_COMMAND_TIMEOUT_MS });
  assert.deepEqual([timedOut.pending[play.command_id], timedOut.notice.text], [undefined, "播放：命令无响应"]);
  assert.equal(replayReducer(timedOut, { type: "tick", nowMs: T0 + REPLAY_COMMAND_TIMEOUT_MS + 6_000 }).notice, null, "the notice fades");
  const pov = replayPov(2);
  assert.equal(replayReducer(state, { type: "command", command: pov, label: "第一视角", sentAtMs: T0 }).pending[pov.command_id].target, 2, "the busy slot");
  assert.deepEqual(replayReducer(sent, { type: "event", event: baseline, receivedAtMs: T0 + 2 }).pending, {}, "a baseline drops pending commands");
}

{
  // Transitions: another recording or an unload resets the HUD; a seek is a jump, playback is not.
  const previous = { state: stateEvent.payload, receivedAtMs: T0 };
  const played = withPlayback(stateEvent, { position_ms: 63_000 }).payload;
  assert.deepEqual(replayTransition(previous, played, T0 + 2_000), { hudReset: false, jump: false }, "playing on");
  assert.deepEqual(replayTransition(previous, withPlayback(stateEvent, { position_ms: 500_000 }).payload, T0 + 100), { hudReset: false, jump: true }, "a seek");
  assert.deepEqual(replayTransition(previous, idleEvent.payload, T0 + 100), { hudReset: true, jump: true }, "unloaded");
  const other = withPayload(stateEvent, { demo: { ...demo, match_id: "0193f1c2-0000-7000-8000-000000000000" } }).payload;
  assert.deepEqual(replayTransition(previous, other, T0 + 100), { hudReset: true, jump: true }, "another recording");
  assert.deepEqual(replayTransition({ state: idleEvent.payload, receivedAtMs: T0 }, stateEvent.payload, T0 + 100), { hudReset: false, jump: true }, "a load from nothing: no stale HUD, a jump");
  assert.deepEqual(replayTransition(null, stateEvent.payload, T0), { hudReset: false, jump: false }, "the first state of a connection");
}

{
  // HUD clock: wall time on a match server; on a replay server frozen while paused, scaled by the speed, continuous
  // and monotonic across anchors, frozen with nothing loaded, back on the wall rate after leaving.
  assert.equal(hudTimeAt(WALL_HUD_CLOCK, 123_456), 123_456);
  assert.equal(hudClockRate(WALL_HUD_CLOCK, 0), 1);
  let clock = anchorHudClock(WALL_HUD_CLOCK, stateEvent.payload, T0);
  assert.equal(hudTimeAt(clock, T0), T0, "entering replay mode continues the wall time");
  assert.equal(hudTimeAt(clock, T0 + 1_000), T0 + 1_000, "1x");
  clock = anchorHudClock(clock, withPlayback(stateEvent, { speed: 4, position_ms: 62_000 }).payload, T0 + 1_000);
  assert.equal(hudTimeAt(clock, T0 + 2_000), T0 + 5_000, "4x runs 4 s per second");
  assert.equal(hudClockRate(clock, T0 + 2_000), 4);
  clock = anchorHudClock(clock, withPlayback(stateEvent, { playing: false, position_ms: 66_000 }).payload, T0 + 2_000);
  assert.equal(hudTimeAt(clock, T0 + 60_000), T0 + 5_000, "paused: frozen");
  assert.equal(hudClockRate(clock, T0 + 60_000), 0);
  clock = anchorHudClock(clock, withPlayback(stateEvent, { position_ms: 2_000_000 }).payload, T0 + 60_000);
  assert.equal(hudTimeAt(clock, T0 + 61_000), T0 + 6_000, "a seek does not move the clock; playing resumes it");
  clock = anchorHudClock(clock, withPlayback(stateEvent, { position_ms: demo.duration_ms - 1_000 }).payload, T0 + 61_000);
  assert.equal(hudTimeAt(clock, T0 + 70_000), T0 + 7_000, "nothing past the end");
  assert.equal(hudClockRate(clock, T0 + 70_000), 0, "stopped at the end");
  clock = anchorHudClock(clock, withPlayback(stateEvent, { position_ms: 0 }).payload, T0 + 70_000);
  assert.equal(hudTimeAt(clock, T0 + 71_000), T0 + 7_000 + 13_000, "the intro skip counts as recording time passed");
  clock = anchorHudClock(clock, idleEvent.payload, T0 + 71_000);
  assert.equal(hudTimeAt(clock, T0 + 99_000), T0 + 20_000, "nothing loaded: frozen");
  clock = anchorHudClock(clock, null, T0 + 99_000);
  assert.equal(hudTimeAt(clock, T0 + 100_000), T0 + 21_000, "back on the wall rate from where it stood");
  assert.equal(anchorHudClock(WALL_HUD_CLOCK, null, T0), WALL_HUD_CLOCK, "leaving a mode never entered changes nothing");
}

{
  // The previous recording's HUD goes on replay-reset (a v1.0 recording sends none of its own); the baseline, sequence
  // and source stay, so the next recording's snapshots are taken; a late copy of the dropped panel stays hidden.
  const feed = (reducer, initial, event) => [
    { type: "connection", status: "live" },
    { type: "event", event: { ...event, type: "sidecar.baseline", sequence: 1, payload: { baseline: true } }, receivedAtMs: 0 },
    { type: "event", event, receivedAtMs: 1 },
  ].reduce(reducer, initial);
  const hud = feed(roundHudReducer, initialRoundHudState, omniscientEvent);
  assert.notEqual(hud.frame, null);
  const hudReset = roundHudReducer(hud, { type: "replay-reset" });
  assert.deepEqual([hudReset.frame, hudReset.sequence, hudReset.baselineAccepted], [null, hud.sequence, true]);
  const next = roundHudReducer(hudReset, { type: "event", event: { ...omniscientEvent, sequence: omniscientEvent.sequence + 1 }, receivedAtMs: 2 });
  assert.notEqual(next.frame, null, "the next recording's snapshot is taken");
  assert.equal(roundHudReducer(hudReset, { type: "replay-reset" }), hudReset, "nothing to drop: same state");

  const killfeed = feed(killfeedReducer, initialKillfeedState, fixture("hud-killfeed.example.json"));
  assert.ok(killfeed.items.length > 0);
  assert.deepEqual(killfeedReducer(killfeed, { type: "replay-reset" }).items, []);
  const scoreboardEvent = fixture("scoreboard-snapshot.example.json");
  const board = feed(scoreboardReducer, initialScoreboardState, scoreboardEvent);
  assert.equal(scoreboardReducer(board, { type: "replay-reset" }).frame, null);
  assert.deepEqual(scoreboardReducer(board, { type: "replay-reset" }).source, board.source);
  const resultEvent = fixture("round-result.example.json");
  const panel = feed(winPanelReducer, initialWinPanelState, resultEvent);
  assert.notEqual(panel.frame, null);
  const panelReset = winPanelReducer(panel, { type: "replay-reset" });
  assert.equal(selectWinPanel(panelReset, 1, { players: [] }), null);
  assert.equal(winPanelReducer(panelReset, { type: "event", event: { ...resultEvent, sequence: resultEvent.sequence + 1 }, receivedAtMs: 2 }).frame, null,
    "a late copy of the dropped panel stays hidden");
}

{
  // Chat: a jump clears the area and forgets the seen ids, so the plugin's resent lines show again; a replayed line's
  // recording age comes from its two sent_at stamps.
  const message = {
    ...stateEvent, event_id: "chat-1", type: "chat.message", sent_at: "2026-11-15T10:00:00.000Z",
    payload: { message_id: "m-1", scope: "team", sender_id: "76561198000000004", sender_name: "Orion", team_id: "team-a", role: "ntf", body: "push A", sent_at: "2026-11-15T10:00:00.000Z" },
  };
  assert.equal(parseEvent(message).ok, true, JSON.stringify(parseEvent(message).error));
  const source = { serverId: message.server_id, instanceId: message.instance_id };
  let chat = chatInputReducer(initialChatInputState, { type: "baseline", source });
  chat = chatInputReducer(chat, { type: "message", source, message: message.payload, nowMs: 1 });
  assert.equal(chat.lines.length, 1);
  const cleared = chatInputReducer(chat, { type: "clear-lines" });
  assert.deepEqual([cleared.lines, cleared.seen], [[], []]);
  assert.equal(chatInputReducer(cleared, { type: "message", source, message: message.payload, nowMs: 2 }).lines.length, 1, "a resent line shows again");
  const aged = { ...message, sent_at: "2026-11-15T10:00:05.000Z", payload: { ...message.payload, sent_at: "2026-11-15T10:00:01.500Z" } };
  assert.equal(replayLineAgeMs(aged), 3_500);
  assert.equal(replayLineAgeMs({ ...aged, sent_at: "2026-11-15T10:00:00.000Z" }), 0, "never negative");
  assert.equal(replayLineAgeMs(omniscientEvent), 0, "only chat lines");
}


{
  // Command budget (design 11-17 §2): a token bucket inside the sidecar's (burst 10, 120 a minute, shared by every
  // command); over it nothing is sent, and the seek pacer waits for a token instead of dropping a seek.
  assert.ok(REPLAY_COMMAND_BUDGET.burst < SIDECAR_COMMAND_RATE_LIMIT.burst && REPLAY_COMMAND_BUDGET.perMinute < SIDECAR_COMMAND_RATE_LIMIT.perMinute);
  let now = 0;
  const budget = createCommandBudget({ burst: 3, perMinute: 60 }, () => now);
  assert.deepEqual([budget.take(), budget.take(), budget.take(), budget.take()], [true, true, true, false], "the burst, then refused");
  assert.equal(budget.waitMs(), 1_000, "one token a second");
  now = 1_000;
  assert.deepEqual([budget.waitMs(), budget.take(), budget.take()], [0, true, false]);
  now = 100_000;
  assert.deepEqual([budget.take(), budget.take(), budget.take(), budget.take()], [true, true, true, false], "refills to the burst, no more");
  // Fifty presses of "." in five seconds: the sidecar's own bucket never refuses what the budget lets through.
  now = 0;
  const mirror = createCommandBudget(REPLAY_COMMAND_BUDGET, () => now);
  const sidecar = createCommandBudget(SIDECAR_COMMAND_RATE_LIMIT, () => now);
  let passed = 0;
  for (let i = 0; i < 50; i += 1, now += 100) if (mirror.take()) { passed += 1; assert.equal(sidecar.take(), true, "never rate-limited"); }
  assert.ok(passed >= 8 && passed < 50);
  // The pacer holds a seek until the budget has a token, merging what comes meanwhile.
  now = 0;
  const timers = [];
  const sent = [];
  const tight = createCommandBudget({ burst: 1, perMinute: 60 }, () => now);
  const pacer = createSeekPacer({
    now: () => now,
    schedule(callback, ms) { const timer = { at: now + ms, callback, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    send: (seek) => { assert.equal(tight.take(), true, "sent only with a token"); sent.push({ at: now, ...seek }); },
    waitMs: () => tight.waitMs(),
  });
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      const next = timers.filter((timer) => !timer.cancelled && timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at; next.cancelled = true; next.callback();
    }
    now = until;
  };
  pacer.seekBy(10_000); advance(100); pacer.seekBy(10_000); advance(100); pacer.seekBy(10_000);
  advance(2_000);
  assert.deepEqual(sent.map(({ at, delta_ms }) => [at, delta_ms]), [[0, 10_000], [1_000, 20_000]], "waits for the token, nothing lost");
  assert.equal(replayFailureText("单步", "rejected", "rate-limited"), REPLAY_TOO_FAST_TEXT, "the sidecar's refusal in Chinese");
  const noticed = replayReducer(enter(), { type: "notice", text: REPLAY_TOO_FAST_TEXT, atMs: T0 });
  assert.equal(noticed.notice.text, REPLAY_TOO_FAST_TEXT, "a local notice");
}

{
  // Optimistic playback (design 11-17 §1, CS2 SetPlaybackSpeedStop): the bar shows a speed / pause / play at once and
  // keeps it until the server shows it; a refusal or a timeout goes back to the server's.
  const state = enter();
  const result = (command, status = "accepted") => ({ ...fixture("command-result.example.json"),
    payload: { command_id: command.command_id, command_kind: command.kind, status, ...(status === "accepted" ? {} : { reason: "no" }) } });
  const send = (from, command, at = T0 + 100) => replayReducer(from, { type: "command", command, label: "x", sentAtMs: at });
  const speed = replayControl({ action: "speed", speed: 4 });
  const sped = send(state, speed);
  assert.deepEqual(replayPlaybackOf(sped), { playing: true, speed: 4 }, "the new speed at once");
  assert.equal(replayPositionAt(sped, T0 + 1_100).positionMs, 61_100 + 4_000, "advancing at it from the send");
  // Result first (state not yet updated): kept, settled; the next replay.state ends it.
  const accepted = replayReducer(sped, { type: "event", event: result(speed), receivedAtMs: T0 + 150 });
  assert.equal(accepted.pendingPlayback.settled, true);
  assert.deepEqual(replayPlaybackOf(accepted), { playing: true, speed: 4 }, "no snap back while the state is on its way");
  const shown = replayReducer(accepted, { type: "event", event: withPlayback(stateEvent, { speed: 4, position_ms: 61_150 }), receivedAtMs: T0 + 160 });
  assert.equal(shown.pendingPlayback, null);
  assert.deepEqual(replayPlaybackOf(shown), { playing: true, speed: 4 });
  // State first: kept (re-anchored) until the result, which then finds it shown.
  const stateFirst = replayReducer(sped, { type: "event", event: withPlayback(stateEvent, { speed: 4, position_ms: 61_150 }), receivedAtMs: T0 + 150 });
  assert.deepEqual([stateFirst.pendingPlayback.fromMs, stateFirst.pendingPlayback.atMs], [61_150, T0 + 150]);
  assert.equal(replayReducer(stateFirst, { type: "event", event: result(speed), receivedAtMs: T0 + 160 }).pendingPlayback, null);
  // An older state arriving before the result does not undo it.
  const stale = replayReducer(sped, { type: "event", event: stateEvent, receivedAtMs: T0 + 120 });
  assert.deepEqual(replayPlaybackOf(stale), { playing: true, speed: 4 });
  // Refused or timed out: back to the server's.
  assert.deepEqual(replayPlaybackOf(replayReducer(sped, { type: "event", event: result(speed, "rejected"), receivedAtMs: T0 + 150 })), { playing: true, speed: 1 });
  assert.equal(replayReducer(sped, { type: "tick", nowMs: T0 + 100 + REPLAY_COMMAND_TIMEOUT_MS }).pendingPlayback, null);
  // Pause freezes the playhead; step pauses; speed + play from a pause (the slider leaving the pause stop) both show.
  const pausedAt = send(state, replayControl({ action: "pause" }));
  assert.deepEqual([replayPlaybackOf(pausedAt).playing, replayPositionAt(pausedAt, T0 + 5_000).positionMs], [false, 61_100]);
  assert.equal(replayPlaybackOf(send(state, replayControl({ action: "step" }))).playing, false);
  const resumed = send(send(pausedAt, replayControl({ action: "speed", speed: 2 }), T0 + 200), replayControl({ action: "play" }), T0 + 200);
  assert.deepEqual(replayPlaybackOf(resumed), { playing: true, speed: 2 });
  assert.equal(resumed.pendingPlayback.ids.length, 3);
  assert.deepEqual(replayPlaybackOf(send(state, replayControl({ action: "toggle" }))), { playing: false, speed: 1 });
  // A seek keeps the optimistic playback, from its target.
  const seekWhile = replayReducer(pausedAt, { type: "command", command: replayControl({ action: "seek", position_ms: 300_000 }), label: "跳转", sentAtMs: T0 + 300, seekMs: 300_000 });
  assert.equal(seekWhile.pendingPlayback.fromMs, 300_000);
  assert.equal(replayReducer(sped, { type: "event", event: baseline, receivedAtMs: T0 + 200 }).pendingPlayback, null, "a baseline drops it");
}

{
  // Timeline icons follow the watched player; the free camera has none (CS2: no observer target in roaming).
  assert.deepEqual(replayTimelineEvents(demo, null), []);
  assert.deepEqual(replayTimelineEvents(demo, 2).map((event) => [event.atMs, event.kind]), [[61_234, "kill"]]);
  assert.deepEqual(replayTimelineEvents(demo, 3).map((event) => [event.atMs, event.kind]), [[75_000, "death"]]);
}

{
  // Highlight intervals (CS2 client.dll): 6 s before to 2 s after each kill / death of the player; an event starting
  // at or before the current end extends it; clamped to 0 and the duration.
  const kills = (list) => ({ duration_ms: 40_000, timeline: { ...demo.timeline, kills: list.map(([at_ms, killer_slot, victim_slot]) => ({ at_ms, killer_slot, victim_slot })) } });
  // Slot 5: 3 s (from 0), 10 s and 14 s merge (to 16 s); 22 s starts at 16 s, touching, so merges (to 24 s);
  // 30 s starts at 24 s, touching again (to 32 s); 39 s starts at 33 s, past 32 s: a new interval, clamped to 40 s.
  const recording = kills([[3_000, 5, 1], [14_000, 2, 5], [10_000, 5, 2], [22_000, null, 5], [30_000, 5, 3], [31_000, 1, 2], [39_000, 5, 4]]);
  assert.deepEqual(replayHighlightIntervals(recording, 5).map(({ startMs, endMs }) => [startMs, endMs]), [[0, 32_000], [33_000, 40_000]],
    "time order; touching merges; clamped to 0 and the duration");
  assert.deepEqual(replayHighlightIntervals(kills([[20_000, 5, 1], [29_000, 5, 2]]), 5).map(({ startMs, endMs }) => [startMs, endMs]),
    [[14_000, 22_000], [23_000, 31_000]], "a gap splits");
  assert.deepEqual(replayHighlightIntervals(recording, 9), [], "no events, no intervals");
  assert.deepEqual(replayHighlightIntervals(demo, 2), [{ startMs: 55_234, endMs: 63_234 }]);
  const list = [{ startMs: 10_000, endMs: 20_000 }, { startMs: 30_000, endMs: 40_000 }];
  assert.deepEqual([5_000, 10_000, 19_999, 20_000, 35_000].map((at) => highlightIntervalAt(list, at)), [-1, 0, 0, -1, 1]);
  assert.deepEqual([5_000, 10_000, 25_000, 50_000].map((at) => replayIntervalIndexAt(list, at)), [-1, 0, 0, 1], "CS2 GetIntervalIndexAtTick");
  // The driver: wait to the end then jump; jump at once from a gap; pause after the last; nothing while paused.
  assert.deepEqual(replayHighlightStep(list, { positionMs: 15_000, playing: true, speed: 2 }), { waitMs: 2_500, jump: 1 });
  assert.deepEqual(replayHighlightStep(list, { positionMs: 25_000, playing: true, speed: 1 }), { waitMs: 0, jump: 1 });
  assert.deepEqual(replayHighlightStep(list, { positionMs: 5_000, playing: true, speed: 1 }), { waitMs: 0, jump: 0 });
  assert.deepEqual(replayHighlightStep(list, { positionMs: 35_000, playing: true, speed: 1 }), { waitMs: 5_000, jump: -1 });
  assert.deepEqual(replayHighlightStep(list, { positionMs: 45_000, playing: true, speed: 1 }), { waitMs: 0, jump: -1 });
  assert.equal(replayHighlightStep(list, { positionMs: 15_000, playing: false, speed: 1 }), null);
  assert.equal(replayHighlightStep([], { positionMs: 15_000, playing: true, speed: 1 }), null);

  // Running a step: a jump the command budget held back is retried once a token is back, never dropped.
  const timers = [];
  const schedule = (callback, ms) => {
    const timer = { callback, ms, cancelled: false };
    timers.push(timer);
    return () => { timer.cancelled = true; };
  };
  const fire = () => {
    const timer = timers.shift();
    if (!timer.cancelled) timer.callback();
    return timer;
  };
  let sent = 0;
  let retried = 0;
  const run = (waitMs, results, budgetWaitMs = 600) => runReplayHighlightStep({ waitMs }, () => {
    sent += 1;
    return results.shift();
  }, () => budgetWaitMs, schedule, () => { retried += 1; });
  run(0, [true]);
  assert.deepEqual([sent, retried, timers.length], [1, 0, 0], "sent at once, nothing scheduled");
  run(0, [false]);
  assert.deepEqual([sent, timers.length, timers[0].ms], [2, 1, 600], "held back: retry when the budget has a token");
  fire();
  assert.equal(retried, 1, "the retry re-runs the driver");
  run(0, [false], 0);
  assert.equal(timers[0].ms, REPLAY_HIGHLIGHT_RETRY_MIN_MS, "a budget that says now still waits the minimum");
  fire();
  const cancel = run(2_500, [false]);
  assert.deepEqual([timers.length, timers[0].ms, sent], [1, 2_500, 3], "waits for the interval's end first");
  fire();
  assert.deepEqual([sent, timers.length, timers[0].ms], [4, 1, 600], "then jumps, held back, retry scheduled");
  cancel();
  fire();
  assert.equal(retried, 2, "cancelling (a new position, highlights off) drops the pending retry");
  const cancelEarly = run(1_000, [true]);
  cancelEarly();
  fire();
  assert.equal(sent, 4, "cancelled before the interval's end: nothing sent");
}
console.log("replay model smoke: mode, position, timeline, players, commands, seek pacer, command budget, optimistic playback, catalog, results, transitions, HUD clock, HUD reset, chat jump and highlights ok");
