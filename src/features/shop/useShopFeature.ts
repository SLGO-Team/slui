import { useCallback, useReducer } from "react";
import type { CommandResult, ConnectionStatus, ShopCommand, SlgoEvent } from "../../contracts";
import { initialShopState, shopReducer } from "./model";

/** React adapter for the pure shop reducer; App only composes these callbacks. */
export function useShopFeature() {
  const [state, dispatch] = useReducer(shopReducer, initialShopState);

  const setConnectionStatus = useCallback((status: ConnectionStatus) => {
    dispatch({ type: "connection", status });
  }, []);

  const receiveEvent = useCallback((event: SlgoEvent, receivedAtMs = Date.now()) => {
    dispatch({ type: "event", event, receivedAtMs });
  }, []);

  const beginCommand = useCallback((command: ShopCommand, sentAtMs = Date.now()) => {
    dispatch({ type: "command", command, sentAtMs });
  }, []);

  const resolveCommand = useCallback((result: CommandResult, receivedAtMs = Date.now()) => {
    dispatch({ type: "command-result", result, receivedAtMs });
  }, []);

  const tick = useCallback((nowMs = Date.now()) => {
    dispatch({ type: "tick", nowMs });
  }, []);

  return { state, setConnectionStatus, receiveEvent, beginCommand, resolveCommand, tick };
}
