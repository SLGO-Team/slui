import { currentThemePack, themePackUrl, type ThemePack } from "../../shared/themePack.ts";

export type ShopSoundSources = {
  select: string;
  unavailable: string;
  purchase: readonly [string, string, string];
};

// Synthesized by scripts/generate-shop-sounds.mjs.
export const BUILTIN_SHOP_SOUND_SOURCES: ShopSoundSources = {
  select: "/assets/sounds/shop/select.wav",
  unavailable: "/assets/sounds/shop/unavailable.wav",
  purchase: ["/assets/sounds/shop/purchase-1.wav", "/assets/sounds/shop/purchase-2.wav", "/assets/sounds/shop/purchase-3.wav"],
};

// Theme-pack files that replace each bundled sound when present.
export const THEME_PACK_SHOP_SOUNDS: ShopSoundSources = {
  select: "sounds/radial_canselect_01.wav",
  unavailable: "sounds/radial_cantselect_01.wav",
  purchase: ["sounds/radial_menu_buy_01.wav", "sounds/radial_menu_buy_02.wav", "sounds/radial_menu_buy_03.wav"],
};

export function resolveShopSoundSources(pack: ThemePack): ShopSoundSources {
  const pick = (file: string, builtin: string) => themePackUrl(pack, file) ?? builtin;
  const [buy1, buy2, buy3] = BUILTIN_SHOP_SOUND_SOURCES.purchase;
  const [packBuy1, packBuy2, packBuy3] = THEME_PACK_SHOP_SOUNDS.purchase;
  return {
    select: pick(THEME_PACK_SHOP_SOUNDS.select, BUILTIN_SHOP_SOUND_SOURCES.select),
    unavailable: pick(THEME_PACK_SHOP_SOUNDS.unavailable, BUILTIN_SHOP_SOUND_SOURCES.unavailable),
    purchase: [pick(packBuy1, buy1), pick(packBuy2, buy2), pick(packBuy3, buy3)],
  };
}

export type ShopSoundCue = "select" | "unavailable" | "purchase" | "deny";

// CS2 buymenu_mouseover/purchase/failure volumes; select also handles hover here.
// https://github.com/SteamTracking/GameTracking-CS2/blob/8d7a89560bdbed4d65fd6728a9d485066ecccf67/game/csgo/pak01_dir/soundevents/game_sounds_ui.vsndevts#L8182
const SHOP_SOUND_VOLUMES = {
  select: 0.3,
  unavailable: 0.3,
  purchase: 0.3,
  deny: 0.4,
} as const satisfies Record<ShopSoundCue, number>;

const clampVolume = (value: number) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;

export type ShopAudioElement = Pick<HTMLAudioElement, "readyState" | "preload" | "currentTime" | "volume" | "load" | "pause" | "play">;

type ShopAudioOptions = {
  sources?: ShopSoundSources;
  createAudio?: (source: string) => ShopAudioElement | null;
  now?: () => number;
  /** Scales every cue's CS2 volume; the player's shop volume setting. */
  volume?: number;
};

export function createShopAudio({
  sources = resolveShopSoundSources(currentThemePack()),
  createAudio = (source) => typeof Audio === "undefined" ? null : new Audio(source),
  now = () => performance.now(),
  volume = 1,
}: ShopAudioOptions = {}) {
  const clips = new Map<string, ShopAudioElement>();
  const reportedSources = new Set<string>();
  const lastAction = new Map<ShopSoundCue, number>();
  let navigation: ShopAudioElement | null = null;
  let action: ShopAudioElement | null = null;
  let lastNavigationAt = -Infinity;
  let quietNavigationUntil = -Infinity;
  let purchaseIndex = 0;
  let disposed = false;
  let scale = clampVolume(volume);

  function reportPlaybackError(source: string, error: unknown) {
    // Autoplay denial and cancellation are expected; only a new interaction may retry.
    if (error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")) return;
    if (reportedSources.has(source)) return;
    reportedSources.add(source);
    console.warn(`Unable to play shop sound: ${source}`, error);
  }

  function preload() {
    if (disposed) return;
    for (const source of [sources.select, sources.unavailable, ...sources.purchase]) {
      if (clips.has(source)) continue;
      try {
        const clip = createAudio(source);
        if (!clip) continue;
        clips.set(source, clip);
        clip.preload = "auto";
        clip.volume = SHOP_SOUND_VOLUMES.select * scale;
        clip.load();
      } catch (error) {
        reportPlaybackError(source, error);
      }
    }
  }

  function stop() {
    navigation?.pause();
    action?.pause();
    navigation = null;
    action = null;
  }

  function play(cue: ShopSoundCue) {
    if (disposed) return;
    preload();
    const timestamp = now();
    const isNavigation = cue === "select" || cue === "unavailable";
    if (isNavigation && (timestamp < quietNavigationUntil || timestamp - lastNavigationAt < 60)) return;
    if (!isNavigation && timestamp - (lastAction.get(cue) ?? -Infinity) < 100) return;
    const source = cue === "purchase"
      ? sources.purchase[purchaseIndex]
      : cue === "deny" ? sources.unavailable : sources[cue];
    const clip = clips.get(source);
    // Never enqueue sounds behind loading or autoplay unlocking.
    if (!clip || clip.readyState < 2) return;
    if (isNavigation) {
      navigation?.pause();
      navigation = clip;
      lastNavigationAt = timestamp;
    } else {
      stop();
      action = clip;
      lastAction.set(cue, timestamp);
      quietNavigationUntil = timestamp + 140;
    }
    if (cue === "purchase") purchaseIndex = (purchaseIndex + 1) % sources.purchase.length;
    try {
      clip.volume = SHOP_SOUND_VOLUMES[cue] * scale;
      clip.currentTime = 0;
      void clip.play().catch((error: unknown) => reportPlaybackError(source, error));
    } catch (error) {
      reportPlaybackError(source, error);
    }
  }

  // Applies from the next cue; a sound already playing keeps its level.
  function setVolume(next: number) {
    scale = clampVolume(next);
  }

  function dispose() {
    stop();
    clips.clear();
    disposed = true;
  }

  return { preload, play, stop, setVolume, dispose };
}
