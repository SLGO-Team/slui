import { currentThemePack, themePackUrl, type ThemePack } from "../../shared/themePack.ts";

// The three sounds CS2's buy menu plays; each event is a single file. It has no failure sound: a
// card the player cannot buy still plays the purchase cue, and a refused command stays silent.
export type ShopSoundCue = "hover" | "select" | "purchase";
export type ShopSoundSources = Record<ShopSoundCue, string>;

// Synthesized by scripts/generate-shop-sounds.mjs.
export const BUILTIN_SHOP_SOUND_SOURCES: ShopSoundSources = {
  hover: "/assets/sounds/shop/hover.wav",
  select: "/assets/sounds/shop/select.wav",
  purchase: "/assets/sounds/shop/purchase.wav",
};

// Theme-pack files (CS2's own) that replace each bundled sound when present.
export const THEME_PACK_SHOP_SOUNDS: ShopSoundSources = {
  hover: "sounds/itemtile_rollover_09.wav",
  select: "sounds/inventory_item_select_01.wav",
  purchase: "sounds/radial_menu_buy_03.wav",
};

// Each cue falls back on its own, so an older pack still supplies the sounds it has.
export function resolveShopSoundSources(pack: ThemePack): ShopSoundSources {
  const pick = (cue: ShopSoundCue) => themePackUrl(pack, THEME_PACK_SHOP_SOUNDS[cue]) ?? BUILTIN_SHOP_SOUND_SOURCES[cue];
  return { hover: pick("hover"), select: pick("select"), purchase: pick("purchase") };
}

// CS2 UIPanorama.buymenu_mouseover / buymenu_select / buymenu_purchase volumes.
// https://github.com/SteamTracking/GameTracking-CS2/blob/8d7a89560bdbed4d65fd6728a9d485066ecccf67/game/csgo/pak01_dir/soundevents/game_sounds_ui.vsndevts#L8175-L8309
const SHOP_SOUND_VOLUMES = {
  hover: 0.3,
  select: 0.5,
  purchase: 0.3,
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
    for (const source of [sources.hover, sources.select, sources.purchase]) {
      if (clips.has(source)) continue;
      try {
        const clip = createAudio(source);
        if (!clip) continue;
        clips.set(source, clip);
        clip.preload = "auto";
        clip.volume = SHOP_SOUND_VOLUMES.hover * scale;
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
    // Hover is navigation: throttled, quiet right after an action, and it only cuts another hover,
    // so a following mouse-over never cuts the longer select or purchase sound.
    const isNavigation = cue === "hover";
    if (isNavigation && (timestamp < quietNavigationUntil || timestamp - lastNavigationAt < 60)) return;
    if (!isNavigation && timestamp - (lastAction.get(cue) ?? -Infinity) < 100) return;
    const source = sources[cue];
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
