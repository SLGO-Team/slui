import {
  advanceReplayPosition,
  MAX_REPLAY_PIN_REASON_LENGTH,
  type CommandResult,
  type HudKillKind,
  type HudSpectatingSnapshot,
  type MatchSnapshot,
  type ReplayCatalog,
  type ReplayCatalogEntry,
  type ReplayCatalogQuery,
  type ReplayCommand,
  type ReplayDemo,
  type ReplayPlayback,
  type ReplayRoundMark,
  type ReplayState,
  type RoundState,
} from "../contracts/index.ts";

// An in-memory demo replay server for `npm run dev:mock` (`?replay=playing|paused|idle|loading|error`), after
// slgo-backend's fake-replay: one recording built from the 10-player mock match, a catalog of 27 entries (three pages;
// one still recording, one test match, one pinned, one unreadable, one that fails to load), every replay command
// answered like the plugin (state first, then the HUD at the new position, then the result). A preview starts in first
// person on slot 0 (the plugin sends that target's `hud.spectating`, so the bottom HUD shows); a freshly loaded
// recording starts in free view.

export type MockReplayScenario = "playing" | "paused" | "idle" | "loading" | "error";
const SCENARIOS: readonly MockReplayScenario[] = ["playing", "paused", "idle", "loading", "error"];

/** The `?replay=` scenario, or null outside replay previews. */
export function readReplayMockScenario(search = window.location.search): MockReplayScenario | null {
  const value = new URLSearchParams(search).get("replay");
  return SCENARIOS.includes(value as MockReplayScenario) ? value as MockReplayScenario : null;
}

const WARMUP_MS = 60_000;
const INTRO_MS = 8_000;
const BUY_MS = 20_000;
const ACTION_MS = 115_000;
const ROUND_END_MS = 7_000;
const ROUND_MS = BUY_MS + ACTION_MS + ROUND_END_MS;
const ROUNDS = 15;
const FIRST_ROUND_MS = WARMUP_MS + INTRO_MS;
const MATCH_END_MS = FIRST_ROUND_MS + ROUNDS * ROUND_MS;
const DURATION_MS = MATCH_END_MS + 20_000;
const STEP_MS = 16;
const PAGE_SIZE = 10;
const ERROR_MATCH_ID = "0193f1c2-0000-7000-8000-00000000000a";
const PLAYED_MATCH_ID = "0193f1c2-0000-7000-8000-000000000002";
/** First-person slot of a preview scenario (Nova, team-a). */
const PREVIEW_POV_SLOT = 0;

/** Index of the last item matching `test`, or -1 (Array.prototype.findLastIndex is ES2023). */
function lastIndex<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (test(items[index])) return index;
  return -1;
}

const roundStart = (round: number) => FIRST_ROUND_MS + (round - 1) * ROUND_MS;
/** Team-a wins these rounds (a deterministic 8:7-ish match); every third team-a win is a generator overload. */
const teamAWins = (round: number) => [1, 2, 4, 7, 8, 10, 12, 14].includes(round);

function buildDemo(matchId: string, snapshot: MatchSnapshot, profileId: string | null, recording: boolean): ReplayDemo {
  const players = snapshot.teams.flatMap((team) => team.players).map((player, slot) => ({ slot, player_id: player.player_id, display_name: player.display_name }));
  const rounds: ReplayRoundMark[] = [];
  const kills: ReplayDemo["timeline"]["kills"] = [];
  const generators: ReplayDemo["timeline"]["generators"] = [];
  for (let round = 1; round <= ROUNDS; round += 1) {
    const start = roundStart(round);
    rounds.push({ at_ms: start, round, phase: "buy" }, { at_ms: start + BUY_MS, round, phase: "action" }, { at_ms: start + BUY_MS + ACTION_MS, round, phase: "round_end" });
    const winnerA = teamAWins(round);
    const count = 3 + (round % 3);
    for (let index = 0; index < count; index += 1) {
      const killerA = index % 2 === 0 ? winnerA : !winnerA;
      const killer = (killerA ? 0 : 5) + ((round + index) % 5);
      const victim = (killerA ? 5 : 0) + ((round * 2 + index) % 5);
      kills.push({ at_ms: start + BUY_MS + 12_000 + index * 17_000, killer_slot: (round + index) % 11 === 0 ? null : killer, victim_slot: victim });
    }
    if (winnerA && round % 3 === 1) {
      generators.push({ at_ms: start + BUY_MS + 60_000, label: round % 2 === 0 ? "B" : "A", state: "activated" }, { at_ms: start + BUY_MS + 100_000, label: round % 2 === 0 ? "B" : "A", state: "completed" });
    }
  }
  rounds.push({ at_ms: MATCH_END_MS, round: ROUNDS, phase: "match_end" });
  const pauseStart = roundStart(6) + 5_000;
  return {
    match_id: matchId,
    server_id: "competitive",
    profile_id: profileId,
    started_at: "2026-11-15T13:05:00.000Z",
    duration_ms: DURATION_MS,
    is_test: false,
    recording,
    players,
    timeline: {
      warmup: { start_ms: 0, end_ms: WARMUP_MS },
      rounds,
      kills,
      generators,
      pauses: [{ start_ms: pauseStart, end_ms: pauseStart + 30_000 }],
      skips: [{ start_ms: WARMUP_MS, end_ms: FIRST_ROUND_MS }],
    },
  };
}

const MOCK_SERVERS = ["competitive", "casual", "competitive-2"];
const MOCK_NAMES = ["Nova", "Atlas", "Rook", "Specter", "Orion"];

function buildCatalog(): ReplayCatalogEntry[] {
  return Array.from({ length: 27 }, (_, index): ReplayCatalogEntry => {
    const matchId = `0193f1c2-0000-7000-8000-${(index + 1).toString(16).padStart(12, "0")}`;
    const recording = index === 0;
    const readable = index !== 7;
    return {
      match_id: matchId,
      server_id: MOCK_SERVERS[index % MOCK_SERVERS.length],
      profile_id: index % 3 === 1 ? "casual" : "competitive",
      started_at: new Date(Date.UTC(2026, 10, 15, 21, 0) - index * 7 * 3_600_000).toISOString(),
      duration_ms: recording || !readable ? null : 1_800_000 + (index % 5) * 210_000,
      score: recording || !readable ? null : { "team-a": 13 - (index % 4), "team-b": 5 + (index % 7) },
      player_count: recording || !readable ? null : 10 - (index % 3),
      recording,
      is_test: index === 3 || index === 18,
      pinned: index === 5 || index === 12,
      readable,
    };
  });
}

/** The players each catalog entry "has" (for the player filter): two of the mock names plus a SteamID. */
const entryPlayers = (index: number) => [MOCK_NAMES[index % MOCK_NAMES.length], MOCK_NAMES[(index + 2) % MOCK_NAMES.length], `7656119800000000${index % 10}`];

type Emit = (type: "replay.state" | "replay.catalog" | "match.snapshot" | "hud.spectating" | "command.result", payload: unknown) => void;
type Clock = { now(): number; later(callback: () => void, ms: number): void };

export class MockReplayServer {
  private demo: ReplayDemo | null = null;
  private playback: ReplayPlayback | null = null;
  /** Wall time `playback` was taken at. */
  private anchoredAt = 0;
  private povSlot: number | null = null;
  private loading: { match_id: string } | null = null;
  private loadError: { match_id: string; reason: string } | null = null;
  private readonly catalog = buildCatalog();
  private readonly snapshot: MatchSnapshot;
  private readonly clock: Clock;

  constructor(scenario: MockReplayScenario, snapshot: MatchSnapshot, clock: Clock = { now: Date.now, later: (callback, ms) => setTimeout(callback, ms) }) {
    this.snapshot = snapshot;
    this.clock = clock;
    if (scenario !== "idle") {
      this.demo = buildDemo(PLAYED_MATCH_ID, snapshot, "competitive", false);
      this.playback = { playing: scenario === "playing", speed: 1, position_ms: roundStart(3) + BUY_MS + 40_000 };
      this.anchoredAt = clock.now();
      this.povSlot = PREVIEW_POV_SLOT;
    }
    if (scenario === "loading") this.loading = { match_id: this.catalog[2].match_id };
    if (scenario === "error") this.loadError = { match_id: ERROR_MATCH_ID, reason: "录像文件损坏：FOOTER 校验失败" };
  }

  /** The playback as it stands now (the server's own clock). */
  private current(): ReplayPlayback | null {
    if (this.demo === null || this.playback === null) return null;
    return advanceReplayPosition(this.playback, this.demo.timeline.skips, this.demo.duration_ms, this.clock.now() - this.anchoredAt);
  }

  private setPlayback(playback: ReplayPlayback | null) {
    this.playback = playback;
    this.anchoredAt = this.clock.now();
  }

  state(): ReplayState {
    return { demo: this.demo, loading: this.loading, load_error: this.loadError, playback: this.current(), pov_slot: this.demo === null ? null : this.povSlot };
  }

  playing(): boolean {
    return this.current()?.playing ?? false;
  }

  /** The omniscient snapshot at the current position (round, phase, score and clock follow the timeline). */
  matchSnapshot(): MatchSnapshot | null {
    const playback = this.current();
    if (this.demo === null || playback === null) return null;
    const position = playback.position_ms;
    const marks = this.demo.timeline.rounds;
    const index = lastIndex(marks, (mark) => mark.at_ms <= position);
    const mark = index >= 0 ? marks[index] : null;
    const nextAt = marks[index + 1]?.at_ms ?? this.demo.duration_ms;
    const state: RoundState = mark === null ? "WaitingForPlayers"
      : ({ buy: "BuyPhase", action: "ActionPhase", round_end: "RoundEnd", match_end: "MatchEnd" } as const)[mark.phase];
    const round = mark?.round ?? 0;
    const finished = (r: number) => r < round || (r === round && mark !== null && mark.phase !== "buy" && mark.phase !== "action");
    const scoreA = Array.from({ length: ROUNDS }, (_, i) => i + 1).filter((r) => finished(r) && teamAWins(r)).length;
    const scoreB = Array.from({ length: ROUNDS }, (_, i) => i + 1).filter((r) => finished(r) && !teamAWins(r)).length;
    // Demo replay sends neither mode_family nor player_limit (protocol README "Match snapshot top-HUD fields").
    const live: MatchSnapshot = { ...this.snapshot };
    delete live.mode_family;
    delete live.player_limit;
    return {
      ...live,
      viewer_team_id: null,
      omniscient: true,
      state,
      round: Math.max(1, round),
      phase_remaining_ms: Math.max(0, nextAt - position),
      phase_paused: false,
      teams: [
        { ...this.snapshot.teams[0], score: scoreA },
        { ...this.snapshot.teams[1], score: scoreB },
      ],
    };
  }

  /**
   * `hud.spectating` of the first-person target at the current position: an NTF carries the mock E-11 SR, an SCP its
   * role name; `round_kills` are the target's timeline kills since the round's buy phase. Free view watches nobody.
   */
  spectating(): HudSpectatingSnapshot {
    const playback = this.current();
    if (this.demo === null || playback === null || this.povSlot === null) return { target: null };
    const player = this.demo.players.find((candidate) => candidate.slot === this.povSlot);
    const team = this.snapshot.teams.find((candidate) => candidate.players.some((live) => live.player_id === player?.player_id));
    const live = team?.players.find((candidate) => candidate.player_id === player?.player_id);
    if (!player || !team || !live?.is_alive) return { target: null };
    const position = playback.position_ms;
    const marks = this.demo.timeline.rounds;
    const roundStartAt = marks[lastIndex(marks, (mark) => mark.phase === "buy" && mark.at_ms <= position)]?.at_ms ?? 0;
    const roundKills = this.demo.timeline.kills
      .filter((kill) => kill.killer_slot === player.slot && kill.at_ms >= roundStartAt && kill.at_ms <= position)
      .map((): HudKillKind => "default");
    const scp = team.role === "scp";
    return { target: {
      player_id: player.player_id,
      money: live.loadout?.money ?? 0,
      item_name: scp ? "SCP-939" : "E-11-SR",
      ammo: scp ? null : { clip: 40 - (Math.floor(position / 1_000) % 30), clip_max: 40, reserve: 120, reserve_icon: "bullet" },
      round_kills: roundKills,
    } };
  }

  /** Replays the current state (connect, and every 5 s while playing like the plugin) followed by the HUD. */
  publish(emit: Emit) {
    emit("replay.state", this.state());
    const snapshot = this.matchSnapshot();
    if (snapshot) emit("match.snapshot", snapshot);
    emit("hud.spectating", this.spectating());
  }

  /** Answers one replay command. */
  answer(command: ReplayCommand, emit: Emit): void {
    const result = (status: CommandResult["status"], reason?: string) =>
      emit("command.result", { command_id: command.command_id, command_kind: command.kind, status, ...(reason ? { reason } : {}) });
    const changed = (status: CommandResult["status"] = "accepted", reason?: string) => {
      this.publish(emit);
      result(status, reason);
    };
    switch (command.kind) {
      case "command.replay.catalog":
        result("accepted");
        this.clock.later(() => emit("replay.catalog", this.page(command.command_id, command.query)), 300);
        return;
      case "command.replay.load": {
        const entry = this.catalog.find((candidate) => candidate.match_id === command.match_id);
        if (!entry) return result("rejected", "找不到录像");
        this.loading = { match_id: command.match_id };
        changed();
        this.clock.later(() => {
          this.loading = null;
          if (!entry.readable || command.match_id === ERROR_MATCH_ID) {
            this.loadError = { match_id: command.match_id, reason: entry.readable ? "录像文件损坏：FOOTER 校验失败" : "无法读取录像摘要" };
          } else {
            this.loadError = null;
            this.demo = buildDemo(command.match_id, this.snapshot, entry.profile_id, entry.recording);
            this.povSlot = null;
            this.setPlayback({ playing: false, speed: 1, position_ms: 0 });
          }
          this.publish(emit);
        }, 1_000);
        return;
      }
      case "command.replay.unload":
        if (this.demo === null) return result("rejected", "当前没有加载录像");
        this.demo = null;
        this.povSlot = null;
        this.setPlayback(null);
        return changed();
      case "command.replay.pov": {
        if (this.demo === null) return result("rejected", "当前没有加载录像");
        if (command.slot !== null) {
          const player = this.demo.players.find((candidate) => candidate.slot === command.slot);
          const live = this.snapshot.teams.flatMap((team) => team.players).find((candidate) => candidate.player_id === player?.player_id);
          if (!player || !live?.is_online || !live.is_alive) return result("rejected", "该玩家此刻无法观战");
        }
        this.povSlot = command.slot;
        return changed();
      }
      case "command.replay.pin": {
        const entry = this.catalog.find((candidate) => candidate.match_id === command.match_id);
        if (!entry) return result("rejected", "找不到录像");
        if (command.reason.length > MAX_REPLAY_PIN_REASON_LENGTH) return result("rejected", "原因过长");
        entry.pinned = true;
        return result("accepted");
      }
      case "command.replay.unpin": {
        const entry = this.catalog.find((candidate) => candidate.match_id === command.match_id);
        if (entry) entry.pinned = false;
        return result("accepted");
      }
      case "command.replay.control":
        return this.control(command, changed, result);
    }
  }

  private control(command: Extract<ReplayCommand, { kind: "command.replay.control" }>,
    changed: (status?: CommandResult["status"], reason?: string) => void, result: (status: CommandResult["status"], reason?: string) => void) {
    const playback = this.current();
    if (this.demo === null || playback === null) return result("rejected", "当前没有加载录像");
    const end = this.demo.duration_ms;
    const at = (position: number, playing = playback.playing) => this.setPlayback({ ...playback, playing: playing && position < end, position_ms: Math.min(end, Math.max(0, Math.round(position))) });
    switch (command.action) {
      case "play":
      case "toggle":
        if (command.action === "toggle" && playback.playing) {
          at(playback.position_ms, false);
          return changed();
        }
        if (playback.position_ms >= end) return result("rejected", "已播放到录像结尾");
        at(playback.position_ms, true);
        return changed();
      case "pause":
        at(playback.position_ms, false);
        return changed();
      case "step":
        at(playback.position_ms + STEP_MS, false);
        return changed();
      case "speed":
        this.setPlayback({ ...playback, speed: command.speed });
        return changed();
      case "seek":
        at("position_ms" in command ? command.position_ms : playback.position_ms + command.delta_ms);
        return changed();
      case "round": {
        const starts = this.demo.timeline.rounds.filter((mark) => mark.phase === "buy");
        const currentIndex = lastIndex(starts, (mark) => mark.at_ms <= playback.position_ms);
        let target: ReplayRoundMark | undefined;
        if (command.round === "next") target = starts[currentIndex + 1];
        else if (command.round === "prev") {
          // prev restarts the current round unless it just started (2 s), like the plugin.
          const current = starts[currentIndex];
          target = current && playback.position_ms - current.at_ms > 2_000 ? current : starts[Math.max(0, currentIndex - 1)];
        } else target = starts.find((mark) => mark.round === command.round);
        if (!target) return result("rejected", `找不到回合：${command.round}`);
        at(target.at_ms);
        return changed();
      }
    }
  }

  private page(commandId: string, query: ReplayCatalogQuery): ReplayCatalog {
    const player = query.player?.toLowerCase();
    const since = query.since ? Date.parse(query.since) : null;
    const until = query.until ? Date.parse(query.until) : null;
    const matching = this.catalog.filter((entry, index) => {
      if (query.server_id !== undefined && entry.server_id !== query.server_id) return false;
      if (query.test !== undefined && entry.is_test !== query.test) return false;
      if (query.pinned && !entry.pinned) return false;
      const started = Date.parse(entry.started_at);
      if ((since !== null && started < since) || (until !== null && started > until)) return false;
      if (player !== undefined) {
        const names = entryPlayers(index);
        if (/^\d{17}$/.test(player) ? !names.includes(player) : !names.some((name) => name.toLowerCase().includes(player))) return false;
      }
      return true;
    });
    const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    const page = Math.min(pageCount, Math.max(1, query.page));
    return {
      command_id: commandId,
      query: { ...query, page },
      page,
      page_count: pageCount,
      page_size: PAGE_SIZE,
      total: matching.length,
      entries: matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((entry) => ({ ...entry })),
      error: null,
    };
  }
}
