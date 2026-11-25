import { useCallback, useEffect, useReducer } from "react";
import type { ChatSendCommand, ConnectionStatus, SlgoEvent } from "../../contracts";
import { overlayClock } from "../../shared/clock";
import { chatActionForEvent, chatInputReducer, hasPendingChat, initialChatInputState, type ChatCloseReason, type ChatInputScope } from "./model";

/** React adapter for the pure chat input reducer; App only composes these callbacks. */
export function useChatFeature() {
  const [state, dispatch] = useReducer(chatInputReducer, initialChatInputState);

  const open = useCallback((scope: ChatInputScope) => {
    dispatch({ type: "open", scope });
  }, []);

  const setDraft = useCallback((text: string) => {
    dispatch({ type: "draft", text });
  }, []);

  const toggleScope = useCallback(() => {
    dispatch({ type: "toggle-scope" });
  }, []);

  const submit = useCallback((command: ChatSendCommand, nowMs = Date.now()) => {
    dispatch({ type: "submit", command, nowMs });
  }, []);

  const close = useCallback((reason: ChatCloseReason) => {
    dispatch({ type: "close", reason });
  }, []);

  const receiveEvent = useCallback((event: SlgoEvent, nowMs = Date.now()) => {
    const action = chatActionForEvent(event, nowMs);
    if (action) dispatch(action);
  }, []);

  const failCommand = useCallback((command: ChatSendCommand, reason: string, nowMs = Date.now()) => {
    dispatch({ type: "command-result", result: { command_id: command.command_id, command_kind: command.kind, status: "failed", reason }, nowMs });
  }, []);

  const clearLines = useCallback(() => {
    dispatch({ type: "clear-lines" });
  }, []);

  const setConnectionStatus = useCallback((status: ConnectionStatus, nowMs = Date.now()) => {
    dispatch({ type: "connection", status, nowMs });
  }, []);

  // Send timeouts: the clock ticks the reducer only while a message waits for its result.
  const timed = hasPendingChat(state);
  useEffect(() => timed ? overlayClock.subscribe((nowMs) => dispatch({ type: "tick", nowMs })) : undefined, [timed]);

  return { state, open, setDraft, toggleScope, submit, close, receiveEvent, failCommand, setConnectionStatus, clearLines };
}
