import type { ConnectionStatus, Role, RoundResultOutcome, RoundResultPanel, SlgoEvent } from "../../contracts/index.ts";
import { winPanelColors, winPanelMvpAvatar, type WinPanelColors, type WinPanelRoster } from "./presentation.ts";

/** The sidecar instance the panel belongs to; another one clears it. */
export type WinPanelSource = { serverId: string; instanceId: string };

export type WinPanelFrame = {
  panel: RoundResultPanel;
  /** Local receive time of the latest copy; `visible_remaining_ms` counts down from here. */
  receivedAtMs: number;
  /** Local time this `result_id` first arrived. Replays keep it, so they never re-animate. */
  firstReceivedAtMs: number;
};

export type WinPanelState = {
  source: WinPanelSource | null;
  frame: WinPanelFrame | null;
  /** The last result that ended (`panel: null`, local expiry or replaced); a replay of it stays hidden. */
  endedResultId: string | null;
};

export const initialWinPanelState: WinPanelState = { source: null, frame: null, endedResultId: null };

export type WinPanelAction =
  | { type: "event"; event: SlgoEvent; receivedAtMs: number }
  | { type: "connection"; status: ConnectionStatus };

const sameSource = (a: WinPanelSource | null, serverId: string, instanceId: string) =>
  a !== null && a.serverId === serverId && a.instanceId === instanceId;

/** Local time at which the frame's hold time runs out. */
export function winPanelExitAtMs(frame: WinPanelFrame): number {
  return frame.receivedAtMs + frame.panel.visible_remaining_ms;
}

/**
 * Hold time left: the plugin's remaining time at `sent_at` minus the local time since receipt
 * (server and local clocks are never compared).
 */
export function winPanelRemainingMs(frame: WinPanelFrame, nowMs: number): number {
  return Math.max(0, frame.panel.visible_remaining_ms - Math.max(0, nowMs - frame.receivedAtMs));
}

export function winPanelReducer(state: WinPanelState, action: WinPanelAction): WinPanelState {
  // Only an ended instance clears the panel; other drops keep it for a reconnect to the same instance.
  if (action.type === "connection") return action.status === "ended" && state !== initialWinPanelState ? initialWinPanelState : state;
  const { event, receivedAtMs } = action;
  if (event.type === "sidecar.baseline") {
    // A reconnect to the same instance keeps the panel until the replayed snapshot arrives.
    if (sameSource(state.source, event.server_id, event.instance_id)) return state;
    return { source: { serverId: event.server_id, instanceId: event.instance_id }, frame: null, endedResultId: null };
  }
  if (event.type !== "round.result" || !sameSource(state.source, event.server_id, event.instance_id)) return state;

  const { panel } = event.payload;
  const current = state.frame;
  if (panel === null) {
    return current === null ? state : { ...state, frame: null, endedResultId: current.panel.result_id };
  }
  if (panel.result_id === state.endedResultId) return state;
  if (current !== null && current.panel.result_id === panel.result_id) {
    // A replay after the panel already ran out locally must not bring it back.
    if (receivedAtMs >= winPanelExitAtMs(current)) return { ...state, frame: null, endedResultId: panel.result_id };
    return { ...state, frame: { panel, receivedAtMs, firstReceivedAtMs: current.firstReceivedAtMs } };
  }
  // A new result ends the one it replaces, so a late copy of that one cannot bring it back.
  return {
    ...state,
    frame: { panel, receivedAtMs, firstReceivedAtMs: receivedAtMs },
    endedResultId: current === null ? state.endedResultId : current.panel.result_id,
  };
}

export type WinPanelMvpView = {
  playerId: string;
  name: string;
  /** Plugin-resolved award label, shown in the chip. */
  reason: string;
  musicKit: string | null;
  /** Steam avatar from the latest match.snapshot; null when unknown. */
  avatarUrl: string | null;
  /** Side default shown under (and instead of a failed) Steam avatar, as in the top HUD. */
  fallbackAvatarUrl: string;
};

export type WinPanelView = {
  /** React key: one mount (and one enter animation) per result. */
  resultId: string;
  outcome: RoundResultOutcome;
  winnerRole: Role | null;
  isMatchEnd: boolean;
  title: string;
  subtitle: string | null;
  colors: WinPanelColors;
  mvp: WinPanelMvpView | null;
  /** Local time the panel was first shown. */
  shownAtMs: number;
  /** Local time the hold runs out. */
  exitAtMs: number;
};

/** The panel to draw at `nowMs`, or null once it ended or ran out locally. */
export function selectWinPanel(state: WinPanelState, nowMs: number, roster: WinPanelRoster): WinPanelView | null {
  const frame = state.frame;
  if (frame === null || winPanelRemainingMs(frame, nowMs) <= 0) return null;
  const { panel } = frame;
  const mvp = panel.mvp;
  return {
    resultId: panel.result_id,
    outcome: panel.title.outcome,
    winnerRole: panel.winner_team,
    isMatchEnd: panel.is_match_end,
    title: panel.title.text,
    subtitle: panel.subtitle_text,
    colors: winPanelColors(panel.title.outcome, panel.winner_team),
    mvp: mvp === null ? null : {
      playerId: mvp.player_id,
      name: mvp.display_name,
      reason: mvp.reason_text,
      musicKit: mvp.music_kit_name,
      ...winPanelMvpAvatar(mvp.player_id, panel.winner_team, roster),
    },
    shownAtMs: frame.firstReceivedAtMs,
    exitAtMs: winPanelExitAtMs(frame),
  };
}
