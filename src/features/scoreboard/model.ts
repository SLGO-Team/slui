import type { ConnectionStatus, ScoreboardSnapshot, SlgoEvent } from "../../contracts/index.ts";

/** The sidecar instance the scoreboard data belongs to; another one clears it. */
export type ScoreboardSource = { serverId: string; instanceId: string };

export type ScoreboardFrame = {
  snapshot: ScoreboardSnapshot;
  /** Local receive time: `elapsed_ms` counts on from here. */
  receivedAtMs: number;
};

export type ScoreboardState = {
  source: ScoreboardSource | null;
  frame: ScoreboardFrame | null;
};

export const initialScoreboardState: ScoreboardState = { source: null, frame: null };

export type ScoreboardAction =
  | { type: "event"; event: SlgoEvent; receivedAtMs: number }
  | { type: "connection"; status: ConnectionStatus };

const sameSource = (source: ScoreboardSource | null, serverId: string, instanceId: string) =>
  source !== null && source.serverId === serverId && source.instanceId === instanceId;

/** The events scoreboardReducer reads; App dispatches no others to it (each dispatch re-renders App). */
export const SCOREBOARD_EVENT_TYPES: ReadonlySet<SlgoEvent["type"]> = new Set<SlgoEvent["type"]>(["sidecar.baseline", "scoreboard.snapshot"]);

/**
 * Keeps the latest `scoreboard.snapshot` of the baseline's instance. A baseline of another server or instance clears
 * it (an old plugin then never sends one, so the panel stays off); a reconnect to the same instance keeps it, and the
 * replay refreshes it. Only an ended instance clears it on a connection change.
 */
export function scoreboardReducer(state: ScoreboardState, action: ScoreboardAction): ScoreboardState {
  if (action.type === "connection") return action.status === "ended" && state !== initialScoreboardState ? initialScoreboardState : state;
  const { event, receivedAtMs } = action;
  if (event.type === "sidecar.baseline") {
    if (sameSource(state.source, event.server_id, event.instance_id)) return state;
    return { source: { serverId: event.server_id, instanceId: event.instance_id }, frame: null };
  }
  if (event.type !== "scoreboard.snapshot" || !sameSource(state.source, event.server_id, event.instance_id)) return state;
  return { ...state, frame: { snapshot: event.payload, receivedAtMs } };
}

/** Match time at `nowMs`: the snapshot's `elapsed_ms` plus the time since it arrived. */
export function scoreboardElapsedMs(frame: ScoreboardFrame, nowMs: number): number {
  return frame.snapshot.elapsed_ms + Math.max(0, nowMs - frame.receivedAtMs);
}

/** CS2 `map-elapsed` time: `m:ss`, minutes unbounded. */
export function formatScoreboardElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Stats a column shows (CS2 `data-stat` names). */
export const SCOREBOARD_STATS = ["money", "kills", "deaths", "assists", "accuracy", "mvps", "utilitydamage", "enemiesflashed", "kdr", "adr", "damage"] as const;
export type ScoreboardStat = (typeof SCOREBOARD_STATS)[number];

/**
 * Local view state, kept for the SLUI session: the stats page and the side shown persist across closing and reopening
 * until the player clicks the button again (CS2 `_CycleStats`); the sort until another header is clicked.
 */
export type ScoreboardViewState = Readonly<{
  page: 1 | 2;
  /** `other` = the side each team played in the first half; falls back to `current` when unavailable. */
  side: "current" | "other";
  sortStat: ScoreboardStat;
}>;

export const initialScoreboardViewState: ScoreboardViewState = { page: 1, side: "current", sortStat: "damage" };

/**
 * How the scoreboard takes input (CS2 `.mouse-active`): `hidden`, `passive` while the key is held over the game
 * (right-click enters cursor mode), `cursor` once the overlay took the mouse and keyboard.
 */
export type ScoreboardMode = "hidden" | "passive" | "cursor";
