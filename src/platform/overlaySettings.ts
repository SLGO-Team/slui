// Overlay behaviour settings. `autoEnableOnConnect` switches the in-game UI on
// each time the session connects to a server (on by default); off keeps the manual switch only.
// `worldBlur` blurs the game under the panels CS2 draws on a world blur (on by default; the panels
// fall back to dense fills without it); `worldBlurStrength` 1-3 picks its strength.

import type { WorldBlurStrength } from "./backdrop.ts";

export type OverlaySettings = Readonly<{ autoEnableOnConnect: boolean; worldBlur: boolean; worldBlurStrength: WorldBlurStrength }>;

// Strength 1 is what the user chose in game (2026-10-21).
export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = { autoEnableOnConnect: true, worldBlur: true, worldBlurStrength: 1 };

export function normalizeOverlaySettings(value: Partial<Record<keyof OverlaySettings, unknown>> | null | undefined): OverlaySettings {
  const autoEnableOnConnect = value?.autoEnableOnConnect;
  const worldBlur = value?.worldBlur;
  const strength = value?.worldBlurStrength;
  return {
    autoEnableOnConnect: typeof autoEnableOnConnect === "boolean" ? autoEnableOnConnect : DEFAULT_OVERLAY_SETTINGS.autoEnableOnConnect,
    worldBlur: typeof worldBlur === "boolean" ? worldBlur : DEFAULT_OVERLAY_SETTINGS.worldBlur,
    worldBlurStrength: strength === 1 || strength === 2 || strength === 3 ? strength : DEFAULT_OVERLAY_SETTINGS.worldBlurStrength,
  };
}

/**
 * Whether this session attempt should switch the overlay on now: once per attempt (one connection to a
 * server), when it first reaches `live`. A player who switches the UI off afterwards keeps it off until
 * the next connection.
 */
export function shouldAutoEnableOverlay(
  settings: Pick<OverlaySettings, "autoEnableOnConnect">,
  status: string,
  attempt: number,
  handledAttempt: number | null,
): boolean {
  return settings.autoEnableOnConnect && status === "live" && attempt !== handledAttempt;
}
