import { useCallback, useReducer } from "react";
import type { ChatSendCommand, ConnectionStatus, SlgoEvent } from "../../contracts";
import { chatInputReducer, initialChatInputState, type ChatCloseReason, type ChatInputScope } from "./model";

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
    const source = { serverId: event.server_id, instanceId: event.instance_id };
    switch (event.type) {
      case "sidecar.baseline": dispatch({ type: "baseline", source }); break;
      case "match.snapshot": dispatch({ type: "roster", source, snapshot: event.payload }); break;
      case "chat.message": dispatch({ type: "message", source, message: event.payload, nowMs }); break;
      case "chat.notice": dispatch({ type: "notice", source, notice: event.payload, nowMs }); break;
      case "command.result": dispatch({ type: "command-result", result: event.payload, nowMs }); break;
    }
  }, []);

  const failCommand = useCallback((command: ChatSendCommand, reason: string, nowMs = Date.now()) => {
    dispatch({ type: "command-result", result: { command_id: command.command_id, command_kind: command.kind, status: "failed", reason }, nowMs });
  }, []);

  const setConnectionStatus = useCallback((status: ConnectionStatus, nowMs = Date.now()) => {
    dispatch({ type: "connection", status, nowMs });
  }, []);

  const tick = useCallback((nowMs = Date.now()) => {
    dispatch({ type: "tick", nowMs });
  }, []);

  return { state, open, setDraft, toggleScope, submit, close, receiveEvent, failCommand, setConnectionStatus, tick };
}
