import { useCallback, useRef, useSyncExternalStore } from "react";

/** Presentation clock rate: countdowns, expiry and command timeouts are read at this granularity. */
export const OVERLAY_CLOCK_INTERVAL_MS = 250;

type ClockTimers = {
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

export type Clock = {
  /** Calls `listener` with the tick time; the ticker runs while anyone listens. */
  subscribe(listener: (nowMs: number) => void): () => void;
  /** Time of the last tick, or of the start of the ticker; stable between ticks. */
  now(): number;
};

/**
 * One interval for every subscriber, started by the first and stopped with the last, so an idle
 * overlay runs no timer. Starting the ticker refreshes `now()`: a component subscribing after an
 * idle period reads the current time (useSyncExternalStore re-reads the snapshot after subscribing).
 */
export function createClock(timers: ClockTimers, intervalMs = OVERLAY_CLOCK_INTERVAL_MS): Clock {
  const listeners = new Set<(nowMs: number) => void>();
  let current = timers.now();
  let handle: unknown = null;
  const tick = () => {
    current = timers.now();
    for (const listener of [...listeners]) listener(current);
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (handle === null) {
        current = timers.now();
        handle = timers.setInterval(tick, intervalMs);
      }
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0 || handle === null) return;
        timers.clearInterval(handle);
        handle = null;
      };
    },
    now: () => current,
  };
}

export const overlayClock = createClock({
  now: Date.now,
  setInterval: (callback, ms) => window.setInterval(callback, ms),
  clearInterval: (handle) => window.clearInterval(handle as number),
});

export type ClockSelection<T> = (select: (nowMs: number) => T, isEqual: (a: T, b: T) => boolean) => T;

/**
 * The cache behind useClockSelector, pure so the smoke test can drive it. Across ticks of the same
 * `select`, a result `isEqual` to the previous one returns the previous value, so its reader does not
 * re-render. A new `select` (its inputs changed) always takes the fresh value: `isEqual` only compares
 * results of one selector at two times, so it may compare just the fields that selector derives from
 * the time.
 */
export function createClockSelection<T>(now: () => number): ClockSelection<T> {
  let last: { select: (nowMs: number) => T; nowMs: number; value: T } | null = null;
  return (select, isEqual) => {
    const nowMs = now();
    if (last !== null && last.select === select && last.nowMs === nowMs) return last.value;
    const value = select(nowMs);
    const kept = last !== null && last.select === select && isEqual(last.value, value) ? last.value : value;
    last = { select, nowMs, value: kept };
    return kept;
  };
}

/**
 * A value derived from the overlay clock; the component re-renders only when it changes. Memoise
 * `select` on its inputs (useCallback), else every render recomputes it. A value only one panel draws
 * is selected in that panel, so a tick re-renders that panel alone (see quality-guidelines, clocks).
 */
export function useClockSelector<T>(select: (nowMs: number) => T, isEqual: (a: T, b: T) => boolean = Object.is, clock: Clock = overlayClock): T {
  const selection = useRef<ClockSelection<T> | null>(null);
  selection.current ??= createClockSelection<T>(clock.now);
  const getSnapshot = useCallback(() => selection.current!(select, isEqual), [select, isEqual]);
  return useSyncExternalStore(clock.subscribe, getSnapshot);
}

/** Equality for lists whose items keep their identity (or id) while they stay. */
export function sameItems<T>(a: readonly T[], b: readonly T[], key: (item: T) => unknown = (item) => item): boolean {
  return a.length === b.length && a.every((item, index) => key(item) === key(b[index]));
}
