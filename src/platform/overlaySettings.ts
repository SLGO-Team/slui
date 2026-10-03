// Overlay behaviour settings. `autoEnableOnConnect` switches the in-game UI on
// each time the session connects to a server (on by default); off keeps the manual switch only.

export type OverlaySettings = Readonly<{ autoEnableOnConnect: boolean }>;

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = { autoEnableOnConnect: true };

export function normalizeOverlaySettings(value: Partial<Record<keyof OverlaySettings, unknown>> | null | undefined): OverlaySettings {
  const autoEnableOnConnect = value?.autoEnableOnConnect;
  return {
    autoEnableOnConnect: typeof autoEnableOnConnect === "boolean" ? autoEnableOnConnect : DEFAULT_OVERLAY_SETTINGS.autoEnableOnConnect,
  };
}

/**
 * Whether this session attempt should switch the overlay on now: once per attempt (one connection to a
 * server), when it first reaches `live`. A player who switches the UI off afterwards keeps it off until
 * the next connection.
 */
export function shouldAutoEnableOverlay(
  settings: OverlaySettings,
  status: string,
  attempt: number,
  handledAttempt: number | null,
): boolean {
  return settings.autoEnableOnConnect && status === "live" && attempt !== handledAttempt;
}
