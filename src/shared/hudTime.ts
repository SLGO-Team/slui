import { createContext, useContext } from "react";

/**
 * The HUD clock as components read it (design 11-07-demo-replay-slui §11.1): the time HUD frames are stamped with.
 * On a match server it is the wall clock; on a demo replay server it runs on recording time (frozen while paused,
 * scaled by the speed). Components that time things themselves (an expiry timer, a CSS fade, a countdown drawn per
 * frame) read `now()` instead of `Date.now()` and divide wall durations by `rate`; `epoch` changes whenever the rate
 * may have, so a CSS animation timed at mount can remount (key) with the new rate.
 */
export type HudTime = {
  now(): number;
  /** HUD milliseconds per wall millisecond: 1 on a match server, the replay speed, 0 while paused. */
  rate: number;
  epoch: number;
};

export const WALL_HUD_TIME: HudTime = { now: Date.now, rate: 1, epoch: 0 };

export const HudTimeContext = createContext<HudTime>(WALL_HUD_TIME);

export function useHudTime(): HudTime {
  return useContext(HudTimeContext);
}

/** Wall milliseconds until `hudMs` at the current rate; null when the HUD clock stands still (it never gets there). */
export function wallDelayUntil(time: HudTime, hudMs: number): number | null {
  if (time.rate <= 0) return null;
  return Math.max(0, (hudMs - time.now()) / time.rate);
}
