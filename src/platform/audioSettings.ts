// Overlay sound levels. `shopVolume` scales the shop's CS2 buy menu volumes:
// 1 plays them as CS2 does, the default is 15% of that.

export type AudioSettings = Readonly<{ shopVolume: number }>;

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { shopVolume: 0.15 };

export function normalizeAudioSettings(value: Partial<Record<keyof AudioSettings, unknown>> | null | undefined): AudioSettings {
  const shopVolume = value?.shopVolume;
  return {
    shopVolume: typeof shopVolume === "number" && Number.isFinite(shopVolume)
      ? Math.min(1, Math.max(0, shopVolume))
      : DEFAULT_AUDIO_SETTINGS.shopVolume,
  };
}
