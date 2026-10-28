import { createCommandId, endsMatch } from "../../contracts/index.ts";
import type {
  CommandResult,
  ConnectionStatus,
  SlgoEvent,
  TeamCloseCommand,
  TeamCommand,
  TeamMenuSession,
  TeamSelectChoice,
  TeamSelectCommand,
} from "../../contracts/index.ts";

/** A command still unanswered after this long frees the menu again (the sidecar answers `failed` itself after 5 s). */
export const TEAM_SELECT_COMMAND_TIMEOUT_MS = 6_000;
/** CS2 `_ShowError`: the join error stays 5 s. */
export const TEAM_SELECT_ERROR_MS = 5_000;
/** Shown when a refusal carries no text. */
export const TEAM_SELECT_FALLBACK_ERROR = "无法加入该阵营，请稍后重试";

/** The sidecar instance the menu belongs to; another one clears it. */
export type TeamSelectSource = { serverId: string; instanceId: string };

export type TeamSelectPending = Readonly<{
  commandId: string;
  kind: TeamCommand["kind"];
  sentAtMs: number;
}>;

export type TeamSelectError = Readonly<{ text: string; untilMs: number }>;

export type TeamSelectState = Readonly<{
  source: TeamSelectSource | null;
  connection: ConnectionStatus;
  /** The plugin's open session (`team.menu`), or null. */
  menu: TeamMenuSession | null;
  /**
   * The session the player closed or left with an accepted choice: hidden at once, without waiting for the
   * plugin's `menu: null`. A new session id shows again.
   */
  dismissedSessionId: string | null;
  /** One command at a time: the menu ignores clicks until its result. */
  pending: TeamSelectPending | null;
  /** The last refusal, shown in the error banner until `untilMs`. */
  error: TeamSelectError | null;
}>;

export const initialTeamSelectState: TeamSelectState = {
  source: null,
  connection: "signed-out",
  menu: null,
  dismissedSessionId: null,
  pending: null,
  error: null,
};

export type TeamSelectAction =
  | { type: "connection"; status: ConnectionStatus }
  | { type: "event"; event: SlgoEvent; receivedAtMs: number }
  | { type: "command"; command: TeamCommand; sentAtMs: number }
  | { type: "command-result"; result: CommandResult; receivedAtMs: number }
  | { type: "tick"; nowMs: number }
  /**
   * The overlay was disabled: the plugin draws the menu itself again (the player left its SLUI audience) and stops
   * publishing it here, so the session here is stale. Enabling declares team-select again and the current state
   * comes back (the sidecar's cached frame, then the plugin's).
   */
  | { type: "released" };

/** The events teamSelectReducer reads; App dispatches no others to it (each dispatch re-renders App). */
export const TEAM_SELECT_EVENT_TYPES: ReadonlySet<SlgoEvent["type"]> = new Set<SlgoEvent["type"]>(["sidecar.baseline", "team.menu"]);

export const isTeamCommandKind = (kind: string): kind is TeamCommand["kind"] => kind === "command.team.select" || kind === "command.team.close";

export function createTeamSelectCommand(team: TeamSelectChoice): TeamSelectCommand {
  return { kind: "command.team.select", command_id: createCommandId("team"), team };
}

export function createTeamCloseCommand(sessionId: string): TeamCloseCommand {
  return { kind: "command.team.close", command_id: createCommandId("team-close"), session_id: sessionId };
}

const sameSource = (source: TeamSelectSource | null, serverId: string, instanceId: string) =>
  source !== null && source.serverId === serverId && source.instanceId === instanceId;

/** The open session the panel draws: the plugin's, unless the player already closed it here. */
export function visibleTeamMenu(state: TeamSelectState): TeamMenuSession | null {
  const menu = state.menu;
  if (menu === null || state.connection !== "live" || menu.session_id === state.dismissedSessionId) return null;
  return menu;
}

/** Whether the panel takes a command now: a session is on screen and no command is waiting for its result. */
export function canSendTeamCommand(state: TeamSelectState): boolean {
  return visibleTeamMenu(state) !== null && state.pending === null;
}

export function hasTimedTeamCommand(state: TeamSelectState): boolean {
  return state.pending !== null;
}

/**
 * The plugin owns the session (team.menu); this keeps the latest one of the baseline's instance and what the player
 * did with it here: a close or an accepted choice hides it at once, a refusal shows CS2's error banner for 5 s.
 */
export function teamSelectReducer(state: TeamSelectState, action: TeamSelectAction): TeamSelectState {
  switch (action.type) {
    case "connection": {
      if (endsMatch(action.status)) return { ...initialTeamSelectState, connection: action.status };
      // A lost connection keeps the session for a reconnect to the same instance (the replay corrects it), but no
      // command can still be answered.
      return action.status === state.connection && state.pending === null
        ? state
        : { ...state, connection: action.status, pending: action.status === "live" ? state.pending : null };
    }
    case "event": {
      const { event } = action;
      if (event.type === "sidecar.baseline") {
        if (sameSource(state.source, event.server_id, event.instance_id)) return state;
        return { ...initialTeamSelectState, connection: state.connection, source: { serverId: event.server_id, instanceId: event.instance_id } };
      }
      if (event.type !== "team.menu" || !sameSource(state.source, event.server_id, event.instance_id)) return state;
      const menu = event.payload.menu;
      if (menu === null) return { ...state, menu: null, dismissedSessionId: null, error: null };
      const fresh = state.menu?.session_id !== menu.session_id;
      return { ...state, menu, error: fresh ? null : state.error };
    }
    case "command": {
      if (!canSendTeamCommand(state)) return state;
      const pending: TeamSelectPending = { commandId: action.command.command_id, kind: action.command.kind, sentAtMs: action.sentAtMs };
      // Cancel / Escape hide the menu at once; the plugin's menu: null follows.
      if (action.command.kind === "command.team.close") return { ...state, pending, error: null, dismissedSessionId: action.command.session_id };
      return { ...state, pending, error: null };
    }
    case "command-result": {
      const { result } = action;
      if (state.pending === null || state.pending.commandId !== result.command_id) return state;
      if (result.status === "accepted" || result.status === "duplicate") {
        // The plugin closes the session on success; hide it now rather than after the round trip.
        const dismissed = result.command_kind === "command.team.select" ? state.menu?.session_id ?? state.dismissedSessionId : state.dismissedSessionId;
        return { ...state, pending: null, dismissedSessionId: dismissed };
      }
      const text = result.reason?.trim() || TEAM_SELECT_FALLBACK_ERROR;
      // A refused close (a forced session) brings the menu back.
      const dismissedSessionId = result.command_kind === "command.team.close" ? null : state.dismissedSessionId;
      return { ...state, pending: null, dismissedSessionId, error: { text, untilMs: action.receivedAtMs + TEAM_SELECT_ERROR_MS } };
    }
    case "tick":
      return state.pending !== null && action.nowMs - state.pending.sentAtMs > TEAM_SELECT_COMMAND_TIMEOUT_MS ? { ...state, pending: null } : state;
    case "released":
      return state.menu === null && state.pending === null && state.error === null
        ? state
        : { ...state, menu: null, dismissedSessionId: null, pending: null, error: null };
  }
}
