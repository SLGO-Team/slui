import { useCallback, useEffect, useReducer } from "react";
import type { CommandResult, ConnectionStatus, SlgoEvent, TeamCommand } from "../../contracts";
import { overlayClock } from "../../shared/clock";
import { hasTimedTeamCommand, initialTeamSelectState, isTeamCommandKind, TEAM_SELECT_EVENT_TYPES, teamSelectReducer } from "./model";

/** React adapter for the pure team select reducer; App only composes these callbacks. */
export function useTeamSelectFeature() {
  const [state, dispatch] = useReducer(teamSelectReducer, initialTeamSelectState);

  const setConnectionStatus = useCallback((status: ConnectionStatus) => {
    dispatch({ type: "connection", status });
  }, []);

  // Only its own events and the results of team commands: every dispatch re-renders App.
  const receiveEvent = useCallback((event: SlgoEvent, receivedAtMs = Date.now()) => {
    if (TEAM_SELECT_EVENT_TYPES.has(event.type)) dispatch({ type: "event", event, receivedAtMs });
    else if (event.type === "command.result" && isTeamCommandKind(event.payload.command_kind)) dispatch({ type: "command-result", result: event.payload, receivedAtMs });
  }, []);

  const beginCommand = useCallback((command: TeamCommand, sentAtMs = Date.now()) => {
    dispatch({ type: "command", command, sentAtMs });
  }, []);

  const resolveCommand = useCallback((result: CommandResult, receivedAtMs = Date.now()) => {
    dispatch({ type: "command-result", result, receivedAtMs });
  }, []);

  const release = useCallback(() => dispatch({ type: "released" }), []);

  // Command timeouts: the clock ticks the reducer only while a command waits for its result.
  const timed = hasTimedTeamCommand(state);
  useEffect(() => timed ? overlayClock.subscribe((nowMs) => dispatch({ type: "tick", nowMs })) : undefined, [timed]);

  return { state, setConnectionStatus, receiveEvent, beginCommand, resolveCommand, release };
}
