import type {
  ConnectionStatus,
  MatchPlayer,
  MatchPlayerLoadout,
  MatchSnapshotEvent,
  Role,
  RoundState,
  SlgoEvent,
  TeamId,
} from "../../contracts";

export const HUD_STALE_AFTER_MS = 5_000;

export type HudPhase = "LIVE" | "BUY" | "PAUSED";
export type HudAvailability =
  | "live"
  | "stale"
  | "disconnected"
  | "restarted"
  | "baseline-required"
  | "no-match";

export type HudPlayerView = Pick<
  MatchPlayer,
  "player_id" | "display_name" | "avatar_url" | "is_online" | "is_alive"
> & {
  kills: number;
};

export type HudViewerPlayerView = HudPlayerView & {
  health: number | null;
  shield: number | null;
  /** Caps of health / shield; null from older plugins (which scaled both to 100) and when not alive. */
  max_health: number | null;
  max_shield: number | null;
  /** An alive SCP-079's auxiliary power; null for every other player. */
  aux: { power: number; max: number } | null;
  /** Money and equipment; null when the snapshot carries none (offline teammate, older plugin). */
  loadout: MatchPlayerLoadout | null;
};

/**
 * What the top-HUD timer shows, in priority order: nothing outside a running phase
 * (matching the plugin HUD), the generator overload countdown, the tactical pause
 * glyph, else the phase clock.
 */
export type HudClockMode = "hidden" | "generator" | "pause" | "round";

/**
 * Blink speed of the generator-mode keycard icon, after CS2 BombPlantedPulse__Slow/Medium/Fast.
 * The generator clock draws no digits; the remaining time only drives this tier.
 */
export type HudGeneratorPulse = "slow" | "medium" | "fast";

/**
 * Tier thresholds on the interpolated generator_remaining_ms: above 20 s slow, 10-20 s medium
 * (20 s inclusive), at or below 10 s fast. CS2's native switch points live in client code and
 * were not verified; these values are our own choice.
 */
export const HUD_GENERATOR_PULSE_MEDIUM_AT_MS = 20_000;
export const HUD_GENERATOR_PULSE_FAST_AT_MS = 10_000;

type HudTeamCommon = {
  teamId: TeamId;
  role: Role;
  displayName: string;
  score: number;
  aliveCount: number;
};

export type HudTeamView =
  | (HudTeamCommon & { relation: "viewer"; players: HudViewerPlayerView[] })
  | (HudTeamCommon & { relation: "opponent"; players: HudPlayerView[] });

type RoundHudStatus = {
  availability: HudAvailability;
  connectionStatus: ConnectionStatus;
  statusLabel: string;
};

export type RoundHudViewModel = RoundHudStatus & ({
  hasSnapshot: false;
} | {
  hasSnapshot: true;
  state: RoundState;
  phase: HudPhase;
  phaseLabel: string;
  round: number;
  maxRounds: number;
  clockMode: HudClockMode;
  /** Seconds left on the timer that clockMode selects (0 when hidden or paused; the generator mode draws no digits). */
  clockSeconds: number;
  /** Keycard blink tier while clockMode is "generator", else null. */
  generatorPulse: HudGeneratorPulse | null;
  /** Phase clock (phase_remaining_ms), independent of clockMode; the shop countdown uses it. */
  phaseClockSeconds: number;
  paused: boolean;
  teams: [HudTeamView, HudTeamView];
});

export type HudSnapshotFrame = {
  serverId: string;
  instanceId: string;
  sequence: number;
  /** Server clock. Informational only: never compare it with the local clock. */
  sentAtMs: number;
  receivedAtMs: number;
  snapshot: MatchSnapshotEvent["payload"];
};

export type RoundHudState = {
  connectionStatus: ConnectionStatus;
  serverId: string | null;
  instanceId: string | null;
  sequence: number;
  baselineAccepted: boolean;
  restartPending: boolean;
  lastEventReceivedAtMs: number | null;
  frame: HudSnapshotFrame | null;
};

export const initialRoundHudState: RoundHudState = {
  connectionStatus: "signed-out",
  serverId: null,
  instanceId: null,
  sequence: -1,
  baselineAccepted: false,
  restartPending: false,
  lastEventReceivedAtMs: null,
  frame: null,
};

export type RoundHudAction =
  | { type: "connection"; status: ConnectionStatus }
  | { type: "event"; event: SlgoEvent; receivedAtMs: number };

export function roundHudReducer(state: RoundHudState, action: RoundHudAction): RoundHudState {
  if (action.type === "connection") {
    if (state.connectionStatus === action.status) return state;
    // An ended instance takes its match with it.
    if (action.status === "ended") return { ...initialRoundHudState, connectionStatus: "ended" };
    return { ...state, connectionStatus: action.status };
  }

  const { event, receivedAtMs } = action;
  if (event.type === "sidecar.baseline") {
    const sameSource = event.server_id === state.serverId && event.instance_id === state.instanceId;
    if (sameSource && event.sequence <= state.sequence) return state;
    const sourceChanged = state.serverId !== null && !sameSource;
    return {
      ...state,
      serverId: event.server_id,
      instanceId: event.instance_id,
      sequence: event.sequence,
      baselineAccepted: true,
      restartPending: state.restartPending || sourceChanged,
      lastEventReceivedAtMs: receivedAtMs,
      frame: null,
    };
  }

  if (event.type !== "match.snapshot") return state;
  if (event.server_id !== state.serverId || event.instance_id !== state.instanceId) {
    return {
      ...state,
      connectionStatus: "baseline-required",
      serverId: event.server_id,
      instanceId: event.instance_id,
      sequence: -1,
      baselineAccepted: false,
      restartPending: state.serverId !== null,
      lastEventReceivedAtMs: receivedAtMs,
      frame: null,
    };
  }
  if (!state.baselineAccepted || event.sequence <= state.sequence) return state;

  const parsedSentAt = Date.parse(event.sent_at);
  return {
    ...state,
    sequence: event.sequence,
    restartPending: false,
    lastEventReceivedAtMs: receivedAtMs,
    frame: {
      serverId: event.server_id,
      instanceId: event.instance_id,
      sequence: event.sequence,
      sentAtMs: Number.isFinite(parsedSentAt) ? parsedSentAt : receivedAtMs,
      receivedAtMs,
      snapshot: event.payload,
    },
  };
}

export function toHudPhase(state: RoundState): HudPhase {
  if (state === "BuyPhase") return "BUY";
  if (state === "Idle" || state === "MatchEnd") return "PAUSED";
  return "LIVE";
}

/**
 * A server-reported countdown minus the local time since receipt. Transit time is not
 * deducted: receivedAt - sent_at spans two clocks, so player clock skew would dwarf it.
 */
export function interpolateRemainingMs(frame: HudSnapshotFrame, remainingMs: number, nowMs: number): number {
  const localElapsed = Math.max(0, nowMs - frame.receivedAtMs);
  return Math.max(0, remainingMs - localElapsed);
}

/** Phase clock: frozen while the phase is paused. */
export function remainingMilliseconds(frame: HudSnapshotFrame, nowMs: number): number {
  if (frame.snapshot.phase_paused) return frame.snapshot.phase_remaining_ms;
  return interpolateRemainingMs(frame, frame.snapshot.phase_remaining_ms, nowMs);
}

export function secondsRemaining(frame: HudSnapshotFrame, nowMs: number): number {
  return Math.ceil(remainingMilliseconds(frame, nowMs) / 1_000);
}

const HIDDEN_CLOCK_STATES: ReadonlySet<RoundState> = new Set<RoundState>(["Idle", "WaitingForPlayers", "RoundEnd"]);

export function hudClockMode(snapshot: HudSnapshotFrame["snapshot"]): HudClockMode {
  if (HIDDEN_CLOCK_STATES.has(snapshot.state)) return "hidden";
  // Older plugins omit both fields: undefined behaves like null.
  if (snapshot.generator_remaining_ms != null) return "generator";
  if (snapshot.pause_remaining_ms != null) return "pause";
  return "round";
}

/**
 * Milliseconds left on the timer that clockMode shows. A pause shows no time: CS2 swaps the timer
 * for a red pause glyph and the timeout countdown lives in the alert slot.
 */
export function clockRemainingMilliseconds(frame: HudSnapshotFrame, mode: HudClockMode, nowMs: number): number {
  switch (mode) {
    case "hidden":
    case "pause": return 0;
    case "generator": return interpolateRemainingMs(frame, frame.snapshot.generator_remaining_ms ?? 0, nowMs);
    case "round": return remainingMilliseconds(frame, nowMs);
  }
}

export function generatorPulseTier(remainingMs: number): HudGeneratorPulse {
  if (remainingMs <= HUD_GENERATOR_PULSE_FAST_AT_MS) return "fast";
  if (remainingMs <= HUD_GENERATOR_PULSE_MEDIUM_AT_MS) return "medium";
  return "slow";
}

export function formatRoundClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)}:${(safeSeconds % 60).toString().padStart(2, "0")}`;
}

export function phaseLabel(state: RoundState): string {
  switch (state) {
    case "Idle": return "NO ACTIVE MATCH";
    case "WaitingForPlayers": return "WAITING FOR PLAYERS";
    case "PreRoundWait": return "PRE-ROUND WAIT";
    case "BuyPhase": return "BUY PHASE";
    case "ActionPhase": return "ROUND IN PROGRESS";
    case "RoundEnd": return "ROUND COMPLETE";
    case "MatchEnd": return "MATCH COMPLETE";
  }
}

function availabilityForState(state: RoundHudState, nowMs: number): HudAvailability {
  if (["signed-out", "offline", "not-in-game", "ended", "unauthorized", "incompatible"].includes(state.connectionStatus)) {
    return "disconnected";
  }
  if (state.connectionStatus === "stale") return "stale";
  if (state.restartPending && !state.frame) return "restarted";
  if (["discovering", "route-pending", "connecting", "baseline-required"].includes(state.connectionStatus) && !state.frame) {
    return "baseline-required";
  }
  if (!state.baselineAccepted) return "baseline-required";
  if (!state.frame) return "no-match";
  if (state.connectionStatus !== "live") return "stale";
  // Local clock only, as in the shop: sent_at is on the server clock.
  return nowMs - state.frame.receivedAtMs > HUD_STALE_AFTER_MS ? "stale" : "live";
}

function statusLabel(availability: HudAvailability, connectionStatus: ConnectionStatus): string {
  switch (availability) {
    case "live": return "LIVE";
    case "stale": return "STALE";
    case "disconnected":
      if (connectionStatus === "unauthorized") return "UNAUTHORIZED";
      if (connectionStatus === "incompatible") return "INCOMPATIBLE";
      if (connectionStatus === "signed-out") return "SIGNED OUT";
      if (connectionStatus === "not-in-game") return "NOT IN GAME";
      if (connectionStatus === "ended") return "SERVER CLOSED";
      return "OFFLINE";
    case "restarted": return "SERVER RESTARTED";
    case "baseline-required": return "SYNCING";
    case "no-match": return "NO MATCH DATA";
  }
}

function publicPlayer(player: MatchPlayer): HudPlayerView {
  return {
    player_id: player.player_id,
    display_name: player.display_name,
    avatar_url: player.avatar_url,
    is_online: player.is_online,
    is_alive: player.is_alive,
    kills: Math.max(0, Math.trunc(player.kills ?? 0)),
  };
}

export function selectRoundHud(state: RoundHudState, nowMs: number): RoundHudViewModel {
  const availability = availabilityForState(state, nowMs);
  const status = {
    availability,
    connectionStatus: state.connectionStatus,
    statusLabel: statusLabel(availability, state.connectionStatus),
  };
  if (!state.frame) return { ...status, hasSnapshot: false };

  const { snapshot } = state.frame;
  const clockMode = hudClockMode(snapshot);
  const clockMs = clockRemainingMilliseconds(state.frame, clockMode, nowMs);
  const teams = [...snapshot.teams]
    .sort((a, b) => a.team_id.localeCompare(b.team_id))
    .map((team): HudTeamView => {
      const common = {
        teamId: team.team_id,
        role: team.role,
        displayName: team.display_name,
        score: team.score,
        aliveCount: team.players.filter((player) => player.is_online && player.is_alive).length,
      };
      if (team.team_id === snapshot.viewer_team_id) {
        return {
          ...common,
          relation: "viewer",
          players: team.players.map((player) => ({
            ...publicPlayer(player),
            health: player.health ?? null,
            shield: player.shield ?? null,
            max_health: player.max_health ?? null,
            max_shield: player.max_shield ?? null,
            aux: player.aux_power != null && player.max_aux_power != null
              ? { power: player.aux_power, max: player.max_aux_power }
              : null,
            loadout: player.loadout ?? null,
          })),
        };
      }
      return { ...common, relation: "opponent", players: team.players.map(publicPlayer) };
    }) as [HudTeamView, HudTeamView];

  return {
    ...status,
    hasSnapshot: true,
    state: snapshot.state,
    phase: toHudPhase(snapshot.state),
    phaseLabel: phaseLabel(snapshot.state),
    round: snapshot.round,
    maxRounds: snapshot.max_rounds,
    clockMode,
    clockSeconds: Math.ceil(clockMs / 1_000),
    generatorPulse: clockMode === "generator" ? generatorPulseTier(clockMs) : null,
    phaseClockSeconds: secondsRemaining(state.frame, nowMs),
    paused: snapshot.phase_paused,
    teams,
  };
}
