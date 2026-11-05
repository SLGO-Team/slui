import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandResult, ConnectionStatus, ShopCommand, SlgoEvent } from "../../contracts";
import { overlayClock } from "../../shared/clock";
import { availabilityForState, hasTimedShopCommand, initialShopState, SHOP_EVENT_TYPES, shopReducer, type ShopAction } from "./model";

/**
 * React adapter for the pure shop reducer; App only composes these callbacks. The reducer runs synchronously on the
 * latest state (a ref), so beginCommand can tell its caller whether the command was accepted before it is sent, even
 * for two clicks within one render.
 */
export function useShopFeature() {
  const stateRef = useRef(initialShopState);
  const [state, setState] = useState(initialShopState);

  const apply = useCallback((action: ShopAction) => {
    const previous = stateRef.current;
    const next = shopReducer(previous, action);
    if (next === previous) return false;
    stateRef.current = next;
    setState(next);
    return true;
  }, []);

  const setConnectionStatus = useCallback((status: ConnectionStatus) => {
    apply({ type: "connection", status });
  }, [apply]);

  const receiveEvent = useCallback((event: SlgoEvent, receivedAtMs = Date.now()) => {
    if (SHOP_EVENT_TYPES.has(event.type)) apply({ type: "event", event, receivedAtMs });
  }, [apply]);

  /** Records the command as in flight; false when the reducer refuses it (stale data, closed window...): do not send it. */
  const beginCommand = useCallback((command: ShopCommand, sentAtMs = Date.now()) => apply({ type: "command", command, sentAtMs }), [apply]);

  const resolveCommand = useCallback((result: CommandResult, receivedAtMs = Date.now()) => {
    apply({ type: "command-result", result, receivedAtMs });
  }, [apply]);

  /** Diagnostics: the availability the latest state has now (why beginCommand refused a command). */
  const availability = useCallback(() => availabilityForState(stateRef.current, Date.now()), []);

  // Command timeouts: the clock ticks the reducer only while a command can still time out.
  const timed = hasTimedShopCommand(state);
  useEffect(() => timed ? overlayClock.subscribe((nowMs) => apply({ type: "tick", nowMs })) : undefined, [timed, apply]);

  return { state, setConnectionStatus, receiveEvent, beginCommand, resolveCommand, availability };
}
