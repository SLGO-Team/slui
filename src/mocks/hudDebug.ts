import type {
  ConnectionStatus,
  MatchPlayer,
  MatchSnapshot,
  MatchSnapshotEvent,
  RoundState,
  SlgoEvent,
  TeamId,
} from "../contracts";
import {
  initialRoundHudState,
  roundHudReducer,
  type RoundHudState,
} from "../features/hud/model";
import type { HudPresentationVariant } from "../features/hud/presentation";
import { mockMatchSnapshot, projectMockLoadout, scpMockVitals } from "./provider";

export const HUD_DEBUG_ROUND_STATES = [
  "Idle",
  "WaitingForPlayers",
  "PreRoundWait",
  "BuyPhase",
  "ActionPhase",
  "RoundEnd",
  "MatchEnd",
] as const satisfies readonly RoundState[];

export const HUD_DEBUG_PRESETS = [
  "standard",
  "all-alive",
  "critical-unknown",
  "casualties",
  "large-roster",
] as const;

export const HUD_DEBUG_AVAILABILITIES = [
  "live",
  "stale",
  "offline",
  "restarted",
  "baseline-required",
  "no-match",
] as const;

export const HUD_DEBUG_BACKGROUNDS = [
  "1",
  "2",
] as const;

/** Extra clocks the plugin may report on top of the phase clock. */
export const HUD_DEBUG_CLOCKS = [
  "phase",
  "generator",
  "pause",
] as const;

export type HudDebugPreset = typeof HUD_DEBUG_PRESETS[number];
export type HudDebugAvailability = typeof HUD_DEBUG_AVAILABILITIES[number];
export type HudDebugBackground = typeof HUD_DEBUG_BACKGROUNDS[number];
export type HudDebugClock = typeof HUD_DEBUG_CLOCKS[number];
export type HudDebugViewerTeam = TeamId | "spectator";

export type HudDebugOptions = {
  variant: HudPresentationVariant;
  viewerTeam: HudDebugViewerTeam;
  roundState: RoundState;
  clock: HudDebugClock;
  preset: HudDebugPreset;
  availability: HudDebugAvailability;
  background: HudDebugBackground;
};

export const DEFAULT_HUD_DEBUG_OPTIONS: HudDebugOptions = {
  variant: "detailed",
  viewerTeam: "team-a",
  roundState: "ActionPhase",
  clock: "phase",
  preset: "standard",
  availability: "live",
  background: "1",
};

const ROUND_TIMING: Readonly<Record<RoundState, { remainingMs: number; paused: boolean }>> = {
  Idle: { remainingMs: 0, paused: true },
  WaitingForPlayers: { remainingMs: 45_000, paused: true },
  PreRoundWait: { remainingMs: 10_000, paused: false },
  BuyPhase: { remainingMs: 20_000, paused: false },
  ActionPhase: { remainingMs: 93_000, paused: false },
  RoundEnd: { remainingMs: 7_000, paused: true },
  MatchEnd: { remainingMs: 0, paused: true },
};

const LARGE_ROSTER_NAMES: Readonly<Record<TeamId, readonly string[]>> = {
  "team-a": ["Nova", "Atlas", "Cipher", "Vanguard", "Echo", "Relay", "Breach", "Sable", "Morrow", "Quill"],
  "team-b": ["Rook", "Striker", "Specter", "Phantom", "Warden", "Wisp", "Null", "Rift", "Gloom", "Aegis"],
};

type PlayerPresence = Pick<MatchPlayer, "is_online" | "is_alive">;

function includesValue<T extends string>(values: readonly T[], value: string | null): value is T {
  return value !== null && values.includes(value as T);
}

function playersForPreset(team: MatchSnapshot["teams"][number], preset: HudDebugPreset): MatchPlayer[] {
  if (preset !== "large-roster") return team.players;

  return Array.from({ length: 10 }, (_, index) => team.players[index] ?? {
    player_id: `hud-large-${team.team_id}-${String(index + 1).padStart(2, "0")}`,
    display_name: LARGE_ROSTER_NAMES[team.team_id][index] ?? `${team.team_id}-${index + 1}`,
    avatar_url: null,
    is_online: true,
    is_alive: true,
  });
}

export function readHudDebugOptions(search: string = window.location.search): HudDebugOptions {
  const params = new URLSearchParams(search);
  const variant = params.get("hudVariant");
  const viewerTeam = params.get("viewerTeam");
  const roundState = params.get("hudRoundState");
  const clock = params.get("hudClock");
  const preset = params.get("hudPreset");
  const availability = params.get("hudAvailability");
  const background = params.get("previewBackground");

  return {
    variant: variant === "compact" || variant === "detailed"
      ? variant
      : DEFAULT_HUD_DEBUG_OPTIONS.variant,
    viewerTeam: viewerTeam === "team-a" || viewerTeam === "team-b" || viewerTeam === "spectator"
      ? viewerTeam
      : DEFAULT_HUD_DEBUG_OPTIONS.viewerTeam,
    roundState: includesValue(HUD_DEBUG_ROUND_STATES, roundState)
      ? roundState
      : DEFAULT_HUD_DEBUG_OPTIONS.roundState,
    clock: includesValue(HUD_DEBUG_CLOCKS, clock)
      ? clock
      : DEFAULT_HUD_DEBUG_OPTIONS.clock,
    preset: includesValue(HUD_DEBUG_PRESETS, preset)
      ? preset
      : DEFAULT_HUD_DEBUG_OPTIONS.preset,
    availability: includesValue(HUD_DEBUG_AVAILABILITIES, availability)
      ? availability
      : DEFAULT_HUD_DEBUG_OPTIONS.availability,
    background: includesValue(HUD_DEBUG_BACKGROUNDS, background)
      ? background
      : DEFAULT_HUD_DEBUG_OPTIONS.background,
  };
}

export function replaceHudDebugUrl(options: HudDebugOptions) {
  const url = new URL(window.location.href);
  url.searchParams.set("hudVariant", options.variant);
  url.searchParams.set("viewerTeam", options.viewerTeam);
  url.searchParams.set("hudRoundState", options.roundState);
  url.searchParams.set("hudClock", options.clock);
  url.searchParams.set("hudPreset", options.preset);
  url.searchParams.set("hudAvailability", options.availability);
  url.searchParams.set("previewBackground", options.background);
  window.history.replaceState(window.history.state, "", url);
}

function presenceForPreset(
  preset: HudDebugPreset,
  teamId: TeamId,
  index: number,
  fallback: PlayerPresence,
): PlayerPresence {
  if (preset === "standard") return fallback;
  if (preset === "all-alive" || preset === "critical-unknown" || preset === "large-roster") {
    return { is_online: true, is_alive: true };
  }

  const teamA: readonly PlayerPresence[] = [
    { is_online: true, is_alive: true },
    { is_online: true, is_alive: false },
    { is_online: false, is_alive: false },
    { is_online: true, is_alive: false },
    { is_online: true, is_alive: true },
  ];
  const teamB: readonly PlayerPresence[] = [
    { is_online: true, is_alive: false },
    { is_online: false, is_alive: false },
    { is_online: true, is_alive: true },
    { is_online: true, is_alive: false },
    { is_online: false, is_alive: false },
  ];
  return (teamId === "team-a" ? teamA : teamB)[index] ?? fallback;
}

function vitalsForPreset(
  preset: HudDebugPreset,
  index: number,
  presence: PlayerPresence,
): Pick<MatchPlayer, "health" | "shield"> {
  if (!presence.is_online) return { health: null, shield: null };
  if (!presence.is_alive) return { health: 0, shield: 0 };
  if (preset === "all-alive") return { health: 100, shield: 100 };
  if (preset === "critical-unknown") {
    const health = [18, null, 3, 41, null] as const;
    const shield = [0, null, 14, 60, null] as const;
    return { health: health[index] ?? null, shield: shield[index] ?? null };
  }
  if (preset === "casualties") {
    const health = [64, 0, null, 0, 22] as const;
    const shield = [35, 0, null, 0, 5] as const;
    return { health: health[index] ?? null, shield: shield[index] ?? null };
  }
  if (preset === "large-roster") {
    const health = [100, 92, 84, 76, 68, 60, 52, 44, 36, 28] as const;
    const shield = [70, 60, 50, 40, 30, 20, 10, 0, 0, 0] as const;
    return { health: health[index] ?? 100, shield: shield[index] ?? 0 };
  }

  const health = [100, 72, 45, 88, 60] as const;
  const shield = [70, 35, 100, null, 0] as const;
  return { health: health[index] ?? null, shield: shield[index] ?? null };
}

function publicMockPlayer(player: MatchPlayer, presence: PlayerPresence): MatchPlayer {
  return {
    player_id: player.player_id,
    display_name: player.display_name,
    avatar_url: player.avatar_url,
    kills: player.kills,
    ...presence,
  };
}

export function createHudDebugSnapshot(options: HudDebugOptions): MatchSnapshot {
  const viewerTeamId = options.viewerTeam === "spectator" ? null : options.viewerTeam;
  const timing = ROUND_TIMING[options.roundState];
  const teams = mockMatchSnapshot.teams.map((team) => ({
    ...team,
    players: playersForPreset(team, options.preset).map((player, index) => {
      const presence = presenceForPreset(options.preset, team.team_id, index, player);
      const publicPlayer = publicMockPlayer(player, presence);
      return team.team_id === viewerTeamId
        ? {
          ...publicPlayer,
          ...(team.role === "scp"
            ? scpMockVitals(publicPlayer.player_id, vitalsForPreset(options.preset, index, presence), presence.is_online && presence.is_alive)
            : vitalsForPreset(options.preset, index, presence)),
          loadout: projectMockLoadout(publicPlayer.player_id, presence),
        }
        : publicPlayer;
    }),
  })) as MatchSnapshot["teams"];

  return {
    ...mockMatchSnapshot,
    viewer_team_id: viewerTeamId,
    state: options.roundState,
    // A tactical pause reports the phase as paused at 0, like the plugin.
    phase_remaining_ms: options.clock === "pause" ? 0 : timing.remainingMs,
    phase_paused: options.clock === "pause" ? true : timing.paused,
    generator_remaining_ms: options.clock === "generator" ? 31_000 : null,
    pause_remaining_ms: options.clock === "pause" ? 45_000 : null,
    teams,
  };
}

function baselineEvent(instanceId: string, sequence: number, nowMs: number): SlgoEvent {
  return {
    protocol_version: 0,
    schema_version: 1,
    event_id: `hud-debug-baseline-${instanceId}-${sequence}`,
    server_id: "slgo-hud-debug",
    instance_id: instanceId,
    round_id: "round-hud-debug-7",
    sequence,
    type: "sidecar.baseline",
    sent_at: new Date(nowMs).toISOString(),
    payload: { baseline: true },
  };
}

function snapshotEvent(snapshot: MatchSnapshot, instanceId: string, nowMs: number): MatchSnapshotEvent {
  return {
    protocol_version: 0,
    schema_version: 1,
    event_id: `hud-debug-snapshot-${instanceId}`,
    server_id: "slgo-hud-debug",
    instance_id: instanceId,
    round_id: "round-hud-debug-7",
    sequence: 2,
    type: "match.snapshot",
    sent_at: new Date(nowMs).toISOString(),
    payload: snapshot,
  };
}

function withConnection(state: RoundHudState, status: ConnectionStatus): RoundHudState {
  return roundHudReducer(state, { type: "connection", status });
}

export function createHudDebugState(options: HudDebugOptions, nowMs: number): RoundHudState {
  if (options.availability === "baseline-required") {
    return withConnection(initialRoundHudState, "baseline-required");
  }

  const instanceId = "hud-debug-instance-1";
  let state = roundHudReducer(initialRoundHudState, {
    type: "event",
    event: baselineEvent(instanceId, 1, nowMs),
    receivedAtMs: nowMs,
  });

  if (options.availability === "no-match") return withConnection(state, "live");

  state = roundHudReducer(state, {
    type: "event",
    event: snapshotEvent(createHudDebugSnapshot(options), instanceId, nowMs),
    receivedAtMs: nowMs,
  });

  if (options.availability === "restarted") {
    state = roundHudReducer(state, {
      type: "event",
      event: baselineEvent("hud-debug-instance-2", 1, nowMs),
      receivedAtMs: nowMs,
    });
    return withConnection(state, "live");
  }
  if (options.availability === "stale") return withConnection(state, "stale");
  if (options.availability === "offline") return withConnection(state, "offline");
  return withConnection(state, "live");
}
