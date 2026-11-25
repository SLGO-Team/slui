import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplayCommand } from "../../contracts";
import { replayControl } from "./commands";
import {
  highlightIntervalAt,
  replayHighlightIntervals,
  replayHighlightStep,
  replayPositionAt,
  runReplayHighlightStep,
  type ReplayFeatureState,
  type ReplayHighlightInterval,
} from "./model";

/**
 * CS2's highlights mode (`SetHighlightsModeEnabled`, design 11-17-demo-replay-bar-fixes §3) on a shared replay server:
 * SLUI plays only the watched player's highlight intervals by seeking from each interval's end to the next one's start
 * itself, one command per interval. The playback is everyone's: other viewers see the jumps without the highlights
 * bar. App owns the hook, so it keeps driving while the bar is hidden.
 */
export type ReplayHighlights = {
  active: boolean;
  /** The watched player's intervals while active, else empty. */
  intervals: readonly ReplayHighlightInterval[];
  /** CS2 `IsHighlightsToggleDisabled`: the free camera has no player to follow (only while off). */
  disabled: boolean;
  toggle(): void;
};

/** Sends a replay command (App's budgeted path); false = held back. */
export type ReplaySend = (command: ReplayCommand, seekMs?: number | null) => boolean;

/** `budgetWaitMs`: how long until the command budget has a token again (App's `replayCommandWaitMs`). */
export function useReplayHighlights(replay: ReplayFeatureState, send: ReplaySend, budgetWaitMs: () => number): ReplayHighlights {
  const demo = replay.current?.state.demo ?? null;
  const povSlot = replay.current?.state.pov_slot ?? null;
  const [enabledFor, setEnabledFor] = useState<string | null>(null);
  // Off with another recording, an unload, the free camera or leaving replay mode.
  const active = enabledFor !== null && demo !== null && demo.match_id === enabledFor && povSlot !== null;
  useEffect(() => {
    if (enabledFor !== null && !active) setEnabledFor(null);
  }, [active, enabledFor]);
  // CS2 rebuilds the intervals when the spectated player changes; so does this.
  const intervals = useMemo(() => active && demo && povSlot !== null ? replayHighlightIntervals(demo, povSlot) : [], [active, demo, povSlot]);

  const sendRef = useRef(send);
  sendRef.current = send;
  const budgetWaitRef = useRef(budgetWaitMs);
  budgetWaitRef.current = budgetWaitMs;
  // Bumped to run the driver again after a jump the command budget held back.
  const [retries, setRetries] = useState(0);
  const replayRef = useRef(replay);
  replayRef.current = replay;
  /** Seek to an interval's start; past the last one, pause (the highlights are over). False = held back by the budget. */
  const jumpTo = useCallback((list: readonly ReplayHighlightInterval[], index: number): boolean => {
    const next = index >= 0 ? list[index] : undefined;
    if (next) return sendRef.current(replayControl({ action: "seek", position_ms: next.startMs }), next.startMs);
    return sendRef.current(replayControl({ action: "pause" }));
  }, []);

  const toggle = useCallback(() => {
    if (enabledFor !== null) {
      setEnabledFor(null);
      return;
    }
    const state = replayRef.current;
    const loaded = state.current?.state.demo ?? null;
    const slot = state.current?.state.pov_slot ?? null;
    if (loaded === null || slot === null) return;
    setEnabledFor(loaded.match_id);
    // Into a highlight right away: the next one ahead, else the first.
    const list = replayHighlightIntervals(loaded, slot);
    const position = replayPositionAt(state, Date.now());
    if (list.length === 0 || position === null || highlightIntervalAt(list, position.positionMs) >= 0) return;
    const ahead = list.findIndex((interval) => interval.startMs > position.positionMs);
    // Held back by the budget, the driver below jumps (and retries) once highlights mode is on.
    jumpTo(list, ahead >= 0 ? ahead : 0);
  }, [enabledFor, jumpTo]);

  // The driver: while playing, at an interval's end jump to the next start; in a gap (another viewer moved the
  // playback, a step overshot) jump to the next one at once. Nothing while a seek is on its way or while paused. A jump
  // the command budget held back runs the driver again once a token is back (`retries`), from the position then.
  const { current, pendingSeekMs, pendingPlayback } = replay;
  useEffect(() => {
    if (!active || intervals.length === 0 || pendingSeekMs !== null) return undefined;
    const position = replayPositionAt(replayRef.current, Date.now());
    const step = position === null ? null : replayHighlightStep(intervals, position);
    if (step === null) return undefined;
    return runReplayHighlightStep(
      step,
      () => jumpTo(intervals, step.jump),
      () => budgetWaitRef.current(),
      (callback, ms) => {
        const timer = window.setTimeout(callback, ms);
        return () => window.clearTimeout(timer);
      },
      () => setRetries((count) => count + 1),
    );
  }, [active, current, intervals, jumpTo, pendingPlayback, pendingSeekMs, retries]);

  return { active, intervals, disabled: !active && (demo === null || povSlot === null), toggle };
}
