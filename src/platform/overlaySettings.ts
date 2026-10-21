// Overlay behaviour settings. `autoEnableOnConnect` switches the in-game UI on
// each time the session connects to a server (on by default); off keeps the manual switch only.
// `worldBlur` puts Windows' blur under the panels CS2 draws on a world blur (on by default; the
// panels fall back to dense fills without it); `worldBlurLayers` stacks 1-3 blur passes.

export type WorldBlurLayers = 1 | 2 | 3;

export type OverlaySettings = Readonly<{ autoEnableOnConnect: boolean; worldBlur: boolean; worldBlurLayers: WorldBlurLayers }>;

// One layer is the strength the user chose in game (2026-10-21).
export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = { autoEnableOnConnect: true, worldBlur: true, worldBlurLayers: 1 };

export function normalizeOverlaySettings(value: Partial<Record<keyof OverlaySettings, unknown>> | null | undefined): OverlaySettings {
  const autoEnableOnConnect = value?.autoEnableOnConnect;
  const worldBlur = value?.worldBlur;
  const layers = value?.worldBlurLayers;
  return {
    autoEnableOnConnect: typeof autoEnableOnConnect === "boolean" ? autoEnableOnConnect : DEFAULT_OVERLAY_SETTINGS.autoEnableOnConnect,
    worldBlur: typeof worldBlur === "boolean" ? worldBlur : DEFAULT_OVERLAY_SETTINGS.worldBlur,
    worldBlurLayers: layers === 1 || layers === 2 || layers === 3 ? layers : DEFAULT_OVERLAY_SETTINGS.worldBlurLayers,
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
