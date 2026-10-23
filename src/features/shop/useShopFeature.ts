import { useCallback, useEffect, useReducer } from "react";
import type { CommandResult, ConnectionStatus, ShopCommand, SlgoEvent } from "../../contracts";
import { overlayClock } from "../../shared/clock";
import { hasTimedShopCommand, initialShopState, SHOP_EVENT_TYPES, shopReducer } from "./model";

/** React adapter for the pure shop reducer; App only composes these callbacks. */
export function useShopFeature() {
  const [state, dispatch] = useReducer(shopReducer, initialShopState);

  const setConnectionStatus = useCallback((status: ConnectionStatus) => {
    dispatch({ type: "connection", status });
  }, []);

  const receiveEvent = useCallback((event: SlgoEvent, receivedAtMs = Date.now()) => {
    if (SHOP_EVENT_TYPES.has(event.type)) dispatch({ type: "event", event, receivedAtMs });
  }, []);

  const beginCommand = useCallback((command: ShopCommand, sentAtMs = Date.now()) => {
    dispatch({ type: "command", command, sentAtMs });
  }, []);

  const resolveCommand = useCallback((result: CommandResult, receivedAtMs = Date.now()) => {
    dispatch({ type: "command-result", result, receivedAtMs });
  }, []);

  // Command timeouts: the clock ticks the reducer only while a command can still time out.
  const timed = hasTimedShopCommand(state);
  useEffect(() => timed ? overlayClock.subscribe((nowMs) => dispatch({ type: "tick", nowMs })) : undefined, [timed]);

  return { state, setConnectionStatus, receiveEvent, beginCommand, resolveCommand };
}
