import { advanceReplayPosition, replayElapsedMs, type ReplayState } from "../../contracts/index.ts";

/**
 * The HUD clock (README "Demo replay", "Replay clock"): the time every HUD reducer stamps its frames with and every
 * HUD selector reads, so "remaining = value - (now - receivedAt)" runs on recording time in replay mode without the
 * features knowing. On a match server it is the wall clock itself. In replay mode it advances by `replayElapsedMs`
 * from the latest `replay.state` (frozen while paused or with nothing loaded, scaled by the speed, across intro skips,
 * stopped at the end). Each anchor starts where the previous one stood at that moment, so the HUD clock is continuous
 * and never goes backwards; seeks do not move it (the plugin republishes the HUD at the new position).
 */
export type HudClock = {
  /** Wall time of the anchor (Date.now() of the receipt). */
  wallMs: number;
  /** HUD time at `wallMs`. */
  hudMs: number;
  /** `null` = wall rate (match server); else the replay state whose clock it follows. */
  replay: Pick<ReplayState, "demo" | "playback"> | null;
};

/** HUD time = wall time until a replay state arrives. */
export const WALL_HUD_CLOCK: HudClock = { wallMs: 0, hudMs: 0, replay: null };

export function hudTimeAt(clock: HudClock, wallMs: number): number {
  const elapsed = Math.max(0, wallMs - clock.wallMs);
  if (clock.replay === null) return clock.hudMs + elapsed;
  const { demo, playback } = clock.replay;
  if (demo === null || playback === null) return clock.hudMs;
  return clock.hudMs + replayElapsedMs(playback, demo.timeline.skips, demo.duration_ms, elapsed);
}

/** Re-anchors at `wallMs` on a new replay state, or back on the wall rate (`null`: replay mode left). */
export function anchorHudClock(clock: HudClock, replay: Pick<ReplayState, "demo" | "playback"> | null, wallMs: number): HudClock {
  if (replay === null && clock.replay === null) return clock;
  return { wallMs, hudMs: hudTimeAt(clock, wallMs), replay };
}

/**
 * How fast the HUD clock runs against the wall clock right now: 1 on a match server, the replay speed while playing,
 * 0 while paused, at the end or with nothing loaded. CSS animations (chat fades, progress bars) use it.
 */
export function hudClockRate(clock: HudClock, wallMs: number): number {
  if (clock.replay === null) return 1;
  const { demo, playback } = clock.replay;
  if (demo === null || playback === null || !playback.playing) return 0;
  // Playback stops at the end: past it the clock no longer runs.
  const now = advanceReplayPosition(playback, demo.timeline.skips, demo.duration_ms, Math.max(0, wallMs - clock.wallMs));
  return now.playing ? playback.speed : 0;
}
