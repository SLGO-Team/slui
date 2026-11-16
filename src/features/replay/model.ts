import {
  advanceReplayPosition,
  endsMatch,
  isReplayJump,
  type CommandResult,
  type ConnectionStatus,
  type ReplayCatalog,
  type ReplayCommand,
  type ReplayDemo,
  type ReplayState,
  type ReplayTimeline,
  type Role,
  type SlgoEvent,
  type TeamId,
} from "../../contracts/index.ts";
import type { RoundHudViewModel } from "../hud/model.ts";

/** The events replayReducer reads; App dispatches no others to it (each dispatch re-renders App). */
export const REPLAY_EVENT_TYPES: ReadonlySet<SlgoEvent["type"]> = new Set<SlgoEvent["type"]>([
  "sidecar.baseline", "replay.state", "replay.catalog", "command.result",
]);

/** A replay command without a result after this long is dropped with a notice (the sidecar answers within 5 s). */
export const REPLAY_COMMAND_TIMEOUT_MS = 8_000;
/** How long a failure notice stays in the console status line. */
export const REPLAY_NOTICE_MS = 6_000;

export type ReplayTestFilter = "all" | "only" | "exclude";
/** The catalog panel's filters as typed; `since` / `until` are local dates (`YYYY-MM-DD`) or "". */
export type ReplayCatalogFilters = {
  serverId: string;
  player: string;
  test: ReplayTestFilter;
  pinnedOnly: boolean;
  since: string;
  until: string;
};
export const EMPTY_CATALOG_FILTERS: ReplayCatalogFilters = { serverId: "", player: "", test: "all", pinnedOnly: false, since: "", until: "" };

export type PendingReplayCommand = {
  kind: ReplayCommand["kind"];
  /** Chinese label for the status line ("播放", "加载录像"...). */
  label: string;
  sentAtMs: number;
  /** The pov slot (`command.replay.pov`), the match id (load / pin / unpin), else null: the buttons' busy state. */
  target: number | string | null;
};

export type ReplayCurrent = { state: ReplayState; receivedAtMs: number };

export type ReplayFeatureState = {
  connectionStatus: ConnectionStatus;
  /** The latest `replay.state` of this connection and its local receive time (wall clock); null = not in replay mode. */
  current: ReplayCurrent | null;
  catalog: {
    /** The catalog command whose page is awaited or shown; pages of older queries are dropped. */
    commandId: string | null;
    page: ReplayCatalog | null;
    /** Why the latest catalog command was refused (sidecar or plugin text), else null. */
    rejected: string | null;
    filters: ReplayCatalogFilters;
    /** Bumped when a pin or unpin was accepted: the shown page is out of date (the protocol says to query again). */
    revision: number;
  };
  pending: Readonly<Record<string, PendingReplayCommand>>;
  /** The latest failure for the status line (wall clock). */
  notice: { text: string; atMs: number } | null;
  /** A seek sent and not yet answered by a new `replay.state`: the playhead shows this instead of jumping back. */
  pendingSeekMs: number | null;
};

export const initialReplayState: ReplayFeatureState = {
  connectionStatus: "signed-out",
  current: null,
  catalog: { commandId: null, page: null, rejected: null, filters: EMPTY_CATALOG_FILTERS, revision: 0 },
  pending: {},
  notice: null,
  pendingSeekMs: null,
};

export type ReplayAction =
  | { type: "connection"; status: ConnectionStatus }
  | { type: "event"; event: SlgoEvent; receivedAtMs: number }
  /** A command about to be sent; `seekMs` is the position a seek aims at (the playhead shows it until answered). */
  | { type: "command"; command: ReplayCommand; label: string; sentAtMs: number; seekMs?: number | null }
  /** The send itself failed (no session): resolves the pending command locally. */
  | { type: "send-failed"; commandId: string; reason: string; atMs: number }
  | { type: "tick"; nowMs: number }
  | { type: "filters"; filters: ReplayCatalogFilters };

const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
  const next = { ...record };
  delete next[key];
  return next;
};

/** Status-line text for a refused or failed command; `unsupported` is the sidecar's answer on a match server. */
export function replayFailureText(label: string, status: CommandResult["status"], reason: string | undefined): string {
  if (reason === "unsupported") return "当前服务器不支持回放";
  if (status === "failed") return `${label}未送达${reason ? `：${reason}` : ""}`;
  return `${label}被拒绝${reason ? `：${reason}` : ""}`;
}

function commandTarget(command: ReplayCommand): PendingReplayCommand["target"] {
  switch (command.kind) {
    case "command.replay.pov": return command.slot;
    case "command.replay.load":
    case "command.replay.pin":
    case "command.replay.unpin": return command.match_id;
    default: return null;
  }
}

function resolve(state: ReplayFeatureState, result: CommandResult, atMs: number): ReplayFeatureState {
  const pending = state.pending[result.command_id];
  if (!pending) return state;
  const next: ReplayFeatureState = { ...state, pending: without(state.pending, result.command_id) };
  const ok = result.status === "accepted" || result.status === "duplicate";
  if (pending.kind === "command.replay.control" && !ok) next.pendingSeekMs = null;
  if (pending.kind === "command.replay.catalog" && result.command_id === state.catalog.commandId) {
    next.catalog = ok ? state.catalog : { ...state.catalog, commandId: null, rejected: replayFailureText(pending.label, result.status, result.reason) };
  }
  if (ok && (pending.kind === "command.replay.pin" || pending.kind === "command.replay.unpin")) {
    next.catalog = { ...next.catalog, revision: next.catalog.revision + 1 };
  }
  if (!ok) next.notice = { text: replayFailureText(pending.label, result.status, result.reason), atMs };
  return next;
}

export function replayReducer(state: ReplayFeatureState, action: ReplayAction): ReplayFeatureState {
  switch (action.type) {
    case "connection":
      if (state.connectionStatus === action.status) return state;
      // The session's match is over: no replay server any more. A lost connection keeps the state until the next
      // baseline decides (a reconnect replays the cached replay.state first).
      if (endsMatch(action.status)) return { ...initialReplayState, connectionStatus: action.status, catalog: { ...initialReplayState.catalog, filters: state.catalog.filters } };
      return { ...state, connectionStatus: action.status };
    case "filters":
      return { ...state, catalog: { ...state.catalog, filters: action.filters } };
    case "command": {
      const { command, label, sentAtMs } = action;
      const next: ReplayFeatureState = {
        ...state,
        pending: { ...state.pending, [command.command_id]: { kind: command.kind, label, sentAtMs, target: commandTarget(command) } },
      };
      if (command.kind === "command.replay.catalog") next.catalog = { ...state.catalog, commandId: command.command_id, rejected: null };
      if (action.seekMs != null) next.pendingSeekMs = action.seekMs;
      return next;
    }
    case "send-failed":
      return resolve(state, { command_id: action.commandId, command_kind: state.pending[action.commandId]?.kind ?? "command.replay.control", status: "failed", reason: action.reason }, action.atMs);
    case "tick": {
      const expired = Object.entries(state.pending).filter(([, pending]) => action.nowMs - pending.sentAtMs >= REPLAY_COMMAND_TIMEOUT_MS);
      const noticeOver = state.notice !== null && action.nowMs - state.notice.atMs >= REPLAY_NOTICE_MS;
      if (expired.length === 0 && !noticeOver) return state;
      let next: ReplayFeatureState = noticeOver ? { ...state, notice: null } : state;
      for (const [id, pending] of expired) {
        next = { ...next, pending: without(next.pending, id), notice: { text: `${pending.label}：命令无响应`, atMs: action.nowMs } };
        if (pending.kind === "command.replay.control") next.pendingSeekMs = null;
        if (id === next.catalog.commandId && next.catalog.page?.command_id !== id) {
          next.catalog = { ...next.catalog, commandId: null, rejected: "录像列表：命令无响应" };
        }
      }
      return next;
    }
    case "event": {
      const { event, receivedAtMs } = action;
      switch (event.type) {
        // Every connection starts outside replay mode; the sidecar replays replay.state right after the baseline.
        case "sidecar.baseline":
          return { ...state, current: null, pending: {}, pendingSeekMs: null, notice: null, catalog: { ...state.catalog, commandId: null, page: null, rejected: null } };
        case "replay.state":
          return { ...state, current: { state: event.payload, receivedAtMs }, pendingSeekMs: null };
        case "replay.catalog":
          // Only the page of the latest query; it may come before or after the command's result.
          if (event.payload.command_id !== state.catalog.commandId) return state;
          return { ...state, catalog: { ...state.catalog, page: event.payload, rejected: null } };
        case "command.result":
          return resolve(state, event.payload, receivedAtMs);
        default:
          return state;
      }
    }
  }
}

/** Whether a replay command still waits for its result (the reducer then needs the clock for timeouts). */
export function hasTimedReplayState(state: ReplayFeatureState): boolean {
  return state.notice !== null || Object.keys(state.pending).length > 0;
}

/**
 * A replayed chat line's recording age at its publish (README "Replay HUD"): the envelope `sent_at` minus the payload
 * `sent_at`, both on the plugin's clock; 0 for anything else or unparseable times.
 */
export function replayLineAgeMs(event: SlgoEvent): number {
  if (event.type !== "chat.message" && event.type !== "chat.notice") return 0;
  const age = Date.parse(event.sent_at ?? "") - Date.parse(event.payload.sent_at);
  return Number.isFinite(age) ? Math.max(0, age) : 0;
}

/** R18's one switch: the overlay is in replay mode exactly while this connection has received a `replay.state`. */
export function selectReplayMode(state: ReplayFeatureState): boolean {
  return state.current !== null;
}

/**
 * What a new `replay.state` means for the rest of the HUD, against the previous one of this connection:
 * - `hudReset`: the recording changed (another one, or unloaded). A v1.0 recording sends only world payloads, so the
 *   previous recording's match.snapshot / scoreboard / killfeed / round.result must go (design §11.6).
 * - `jump`: the position is not what the replay clock explains (`isReplayJump`): the chat area is cleared and the plugin
 *   republishes the lines still visible there (README "Replay HUD").
 */
export function replayTransition(previous: ReplayCurrent | null, next: ReplayState, receivedAtMs: number): { hudReset: boolean; jump: boolean } {
  if (previous === null) return { hudReset: false, jump: false };
  const before = previous.state.demo;
  const hudReset = before !== null && (next.demo === null || next.demo.match_id !== before.match_id);
  return { hudReset, jump: isReplayJump(previous.state, Math.max(0, receivedAtMs - previous.receivedAtMs), next) };
}

export type ReplayPosition = {
  positionMs: number;
  durationMs: number;
  playing: boolean;
  speed: number;
  /** At the end: the play button restarts from 0. */
  atEnd: boolean;
};

/** The playback position at `nowMs` (wall clock), interpolated from the receive time; a pending seek wins. */
export function replayPositionAt(state: ReplayFeatureState, nowMs: number): ReplayPosition | null {
  const current = state.current;
  if (current === null || current.state.demo === null || current.state.playback === null) return null;
  const { demo, playback } = current.state;
  const advanced = advanceReplayPosition(playback, demo.timeline.skips, demo.duration_ms, nowMs - current.receivedAtMs);
  const positionMs = state.pendingSeekMs !== null ? Math.min(demo.duration_ms, Math.max(0, state.pendingSeekMs)) : advanced.position_ms;
  return {
    positionMs,
    durationMs: demo.duration_ms,
    playing: advanced.playing,
    speed: playback.speed,
    atEnd: !advanced.playing && positionMs >= demo.duration_ms,
  };
}

/** The recorded round at a position (CS2 TicksToRound): the last round mark at or before it; null before any (warmup). */
export function currentRoundAt(timeline: Pick<ReplayTimeline, "rounds">, positionMs: number): number | null {
  let round: number | null = null;
  for (const mark of timeline.rounds) {
    if (mark.at_ms > positionMs) break;
    round = mark.round;
  }
  return round;
}

/** Whether a position lies in the recorded warmup (before the first round mark). */
export function inWarmupAt(timeline: Pick<ReplayTimeline, "warmup" | "rounds">, positionMs: number): boolean {
  const warmup = timeline.warmup;
  if (warmup === null || positionMs < warmup.start_ms) return false;
  const end = warmup.end_ms ?? timeline.rounds[0]?.at_ms ?? Number.POSITIVE_INFINITY;
  return positionMs < end;
}

/** A span of the timeline as fractions of the duration (0-1). */
export type TimelineSpan = { start: number; end: number };
export type TimelineGeometry = {
  warmup: TimelineSpan | null;
  /** One band per recorded round, from its first mark to the next round's (CS2 alternates the shading). */
  rounds: (TimelineSpan & { round: number; odd: boolean; atMs: number })[];
  /** `team`: the killer's match team (from `slotTeams`), null for a death without a killer or an unknown side. */
  kills: { at: number; atMs: number; killerSlot: number | null; victimSlot: number; team: TeamId | null }[];
  generators: { at: number; atMs: number; label: string | null; state: "activated" | "completed" }[];
  pauses: TimelineSpan[];
  skips: TimelineSpan[];
};

/** The timeline's marks as fractions of the duration; the component only multiplies by its width. */
export function timelineGeometry(demo: Pick<ReplayDemo, "duration_ms" | "timeline">, slotTeams: ReadonlyMap<number, TeamId> = new Map()): TimelineGeometry {
  const duration = Math.max(1, demo.duration_ms);
  const at = (ms: number) => Math.min(1, Math.max(0, ms / duration));
  const { timeline } = demo;
  const firstRoundMs = timeline.rounds[0]?.at_ms ?? null;
  // One band per round number: from the round's first mark to the first mark of the next round (or the end).
  const starts: { round: number; atMs: number }[] = [];
  for (const mark of timeline.rounds) {
    if (starts.length === 0 || starts[starts.length - 1].round !== mark.round) starts.push({ round: mark.round, atMs: mark.at_ms });
  }
  return {
    warmup: timeline.warmup === null ? null
      : { start: at(timeline.warmup.start_ms), end: at(timeline.warmup.end_ms ?? firstRoundMs ?? duration) },
    rounds: starts.map((start, index) => ({
      start: at(start.atMs),
      end: at(starts[index + 1]?.atMs ?? duration),
      round: start.round,
      odd: index % 2 === 0,
      atMs: start.atMs,
    })),
    kills: timeline.kills.map((kill) => ({
      at: at(kill.at_ms),
      atMs: kill.at_ms,
      killerSlot: kill.killer_slot,
      victimSlot: kill.victim_slot,
      team: kill.killer_slot === null ? null : slotTeams.get(kill.killer_slot) ?? null,
    })),
    generators: timeline.generators.map((generator) => ({ at: at(generator.at_ms), atMs: generator.at_ms, label: generator.label, state: generator.state })),
    pauses: timeline.pauses.map((pause) => ({ start: at(pause.start_ms), end: at(pause.end_ms ?? duration) })),
    skips: timeline.skips.map((skip) => ({ start: at(skip.start_ms), end: at(skip.end_ms) })),
  };
}

/** Recorded slot -> match team, joined by `player_id` with the replay's match.snapshot. */
export function replaySlotTeams(demo: Pick<ReplayDemo, "players">, hud: RoundHudViewModel): Map<number, TeamId> {
  const teams = new Map<number, TeamId>();
  if (!hud.hasSnapshot) return teams;
  const teamOf = new Map<string, TeamId>();
  for (const team of hud.teams) for (const player of team.players) teamOf.set(player.player_id, team.teamId);
  for (const player of demo.players) {
    const team = teamOf.get(player.player_id);
    if (team !== undefined) teams.set(player.slot, team);
  }
  return teams;
}

export type ReplayPlayerRow = {
  slot: number;
  playerId: string;
  name: string;
  alive: boolean;
  /** 0-100, null without vitals (no snapshot, SCP-079, dead). */
  healthPercent: number | null;
  isPov: boolean;
  /** Online and alive in the snapshot: the plugin refuses a first-person target it cannot spectate. */
  selectable: boolean;
};
export type ReplayPlayerGroup = {
  /** A match team, `absent` (recorded but not in the snapshot) or `recorded` (no snapshot at all, e.g. a v1.0 recording). */
  key: TeamId | "absent" | "recorded";
  title: string;
  role: Role | null;
  rows: ReplayPlayerRow[];
};

/** The player list: one column per match team (snapshot order), recorded slots missing from it in an `absent` group. */
export function replayPlayerRows(demo: Pick<ReplayDemo, "players">, hud: RoundHudViewModel, povSlot: number | null): ReplayPlayerGroup[] {
  const slotOf = new Map(demo.players.map((player) => [player.player_id, player]));
  if (!hud.hasSnapshot) {
    const rows = demo.players.map((player): ReplayPlayerRow => ({
      slot: player.slot, playerId: player.player_id, name: player.display_name, alive: true, healthPercent: null, isPov: player.slot === povSlot, selectable: true,
    }));
    return rows.length > 0 ? [{ key: "recorded", title: "录像玩家", role: null, rows }] : [];
  }
  const placed = new Set<string>();
  const groups: ReplayPlayerGroup[] = hud.teams.map((team) => ({
    key: team.teamId,
    title: team.displayName,
    role: team.role,
    rows: team.players.flatMap((player): ReplayPlayerRow[] => {
      const recorded = slotOf.get(player.player_id);
      if (!recorded) return [];
      placed.add(player.player_id);
      const health = "health" in player && player.health !== null && player.is_alive
        ? Math.round(Math.min(100, Math.max(0, (player.health / Math.max(1, player.max_health ?? 100)) * 100))) : null;
      return [{
        slot: recorded.slot,
        playerId: player.player_id,
        name: player.display_name,
        alive: player.is_alive,
        healthPercent: health,
        isPov: recorded.slot === povSlot,
        selectable: player.is_online && player.is_alive,
      }];
    }),
  }));
  const absent = demo.players.filter((player) => !placed.has(player.player_id)).map((player): ReplayPlayerRow => ({
    slot: player.slot, playerId: player.player_id, name: player.display_name, alive: false, healthPercent: null, isPov: player.slot === povSlot, selectable: false,
  }));
  if (absent.length > 0) groups.push({ key: "absent", title: "不在场", role: null, rows: absent });
  return groups;
}
