import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { endsMatch, type ConnectionStatus, type ReplayCommand, type SlgoEvent } from "../../contracts";
import { overlayClock } from "../../shared/clock";
import type { HudTime } from "../../shared/hudTime";
import { anchorHudClock, hudClockRate, hudTimeAt, WALL_HUD_CLOCK, type HudClock } from "./clock";
import {
  hasTimedReplayState,
  initialReplayState,
  REPLAY_EVENT_TYPES,
  replayReducer,
  replayTransition,
  type ReplayAction,
  type ReplayCatalogFilters,
} from "./model";
import { replayCommandLabel } from "./commands";

/** What one incoming event means for the other features, decided before they see it. */
export type ReplayIntake = {
  /** The HUD time to stamp the event with (HUD reducers, chat lines). */
  hudMs: number;
  /** The recording changed: drop the previous one's match snapshot, scoreboard, killfeed and round result. */
  hudReset: boolean;
  /** The replay position jumped: clear the chat area. */
  jump: boolean;
  /** The HUD clock runs on a replay state (the event came from a replay server). */
  replay: boolean;
  /** Diagnostics: the replay command this `command.result` answers, with its round trip. */
  result: { label: string; status: string; reason: string | null; afterMs: number } | null;
};

/**
 * React adapter for the replay reducer and the HUD clock (design 11-07-demo-replay-slui §2, §6, §11.1). `intake` runs
 * first for every event, so the HUD clock is re-anchored on a `replay.state` before the snapshots the plugin sends
 * right after it are stamped. The reducer runs synchronously on a ref, like the shop's, so a transition is decided
 * against the previous state even within one render.
 */
export function useReplayFeature() {
  const stateRef = useRef(initialReplayState);
  const [state, setState] = useState(initialReplayState);
  const clockRef = useRef<HudClock>(WALL_HUD_CLOCK);
  const [clock, setClock] = useState<HudClock>(WALL_HUD_CLOCK);
  // Set by a baseline: the next event says whether this connection is a replay server (the sidecar replays
  // replay.state first) or not, in which case the HUD clock goes back to the wall clock.
  const awaitingModeRef = useRef(false);

  const apply = useCallback((action: ReplayAction) => {
    const previous = stateRef.current;
    const next = replayReducer(previous, action);
    if (next === previous) return;
    stateRef.current = next;
    setState(next);
  }, []);
  const setHudClock = useCallback((next: HudClock) => {
    if (next === clockRef.current) return;
    clockRef.current = next;
    setClock(next);
  }, []);

  const intake = useCallback((event: SlgoEvent, wallMs: number): ReplayIntake => {
    let hudReset = false;
    let jump = false;
    if (event.type === "sidecar.baseline") {
      awaitingModeRef.current = true;
    } else if (event.type === "replay.state") {
      awaitingModeRef.current = false;
      ({ hudReset, jump } = replayTransition(stateRef.current.current, event.payload, wallMs));
      setHudClock(anchorHudClock(clockRef.current, event.payload, wallMs));
    } else if (awaitingModeRef.current) {
      // A match server: HUD time is exactly the wall clock again (its frames were dropped with the old instance).
      awaitingModeRef.current = false;
      if (clockRef.current.replay !== null) setHudClock(WALL_HUD_CLOCK);
    }
    const pending = event.type === "command.result" ? stateRef.current.pending[event.payload.command_id] : undefined;
    const result = event.type === "command.result" && pending
      ? { label: pending.label, status: event.payload.status, reason: event.payload.reason ?? null, afterMs: wallMs - pending.sentAtMs } : null;
    if (REPLAY_EVENT_TYPES.has(event.type)) apply({ type: "event", event, receivedAtMs: wallMs });
    return { hudMs: hudTimeAt(clockRef.current, wallMs), hudReset, jump, replay: clockRef.current.replay !== null, result };
  }, [apply, setHudClock]);

  const setConnectionStatus = useCallback((status: ConnectionStatus) => {
    apply({ type: "connection", status });
    if (endsMatch(status)) {
      awaitingModeRef.current = false;
      setHudClock(WALL_HUD_CLOCK);
    }
  }, [apply, setHudClock]);

  /** Records a command about to be sent (busy state, timeout, the seek target the playhead shows). */
  const beginCommand = useCallback((command: ReplayCommand, seekMs: number | null = null, sentAtMs = Date.now()) => {
    apply({ type: "command", command, label: replayCommandLabel(command), sentAtMs, seekMs });
  }, [apply]);
  const sendFailed = useCallback((commandId: string, reason: string) => {
    apply({ type: "send-failed", commandId, reason, atMs: Date.now() });
  }, [apply]);
  const setFilters = useCallback((filters: ReplayCatalogFilters) => apply({ type: "filters", filters }), [apply]);

  // Command timeouts and the notice's fade: the clock ticks the reducer only while one is pending.
  const timed = hasTimedReplayState(state);
  useEffect(() => timed ? overlayClock.subscribe((nowMs) => apply({ type: "tick", nowMs })) : undefined, [apply, timed]);

  /** HUD time at a wall time (App converts the overlay clock's ticks for the HUD selectors). */
  const hudTimeAtWall = useCallback((wallMs: number) => hudTimeAt(clock, wallMs), [clock]);
  // The components' view of the HUD clock: a new value on every anchor (the rate may have changed); the anchor's wall
  // time is its epoch. On a match server it is the plain wall clock with a fixed epoch.
  const hudTime = useMemo<HudTime>(() => clock.replay === null ? { now: Date.now, rate: 1, epoch: 0 }
    : { now: () => hudTimeAt(clockRef.current, Date.now()), rate: hudClockRate(clock, Date.now()), epoch: clock.wallMs }, [clock]);

  return { state, clock, hudTime, hudTimeAtWall, intake, setConnectionStatus, beginCommand, sendFailed, setFilters };
}
