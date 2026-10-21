// World blur under overlay panels (task 10-21-backdrop-blur, src-tauri/src/backdrop.rs).
//
// CS2 blurs the world under many HUD panels (`world-blur: hudWorldBlur`). The overlay is a
// transparent window and cannot blur the game itself, so each such panel registers its element
// here; one animation-frame loop measures what the page actually renders (rect, corner radius,
// opacity) and sends the list to Rust, which captures the game, blurs those regions on the GPU and
// shows them under the overlay. The list is sent only when it changes, so a still panel costs a
// layout read per frame and no IPC.
//
// `<html data-world-blur="on|off">` tells panel CSS which fill to draw: the CS2 fill over the blur,
// or the dense stand-in when no blur is available (switched off, Windows 10, capture failure).

import { useEffect, type RefObject } from "react";

/** Overlay CSS px; `radius` is the corner radius on screen, `alpha` the panel's effective opacity. */
export type BackdropRegion = Readonly<{ x: number; y: number; w: number; h: number; radius: number; alpha: number }>;

export type WorldBlurStrength = 1 | 2 | 3;

export type BackdropOptions = Readonly<{ enabled: boolean; strength: WorldBlurStrength }>;

/** Gaussian σ at 1080p per strength; the native blur scales it with the window height. */
export const WORLD_BLUR_SIGMA_AT_1080: Readonly<Record<WorldBlurStrength, number>> = { 1: 20, 2: 30, 3: 40 };

/** Whole px, tenth-px radius and two-decimal opacity, so sub-pixel jitter never re-sends an unchanged list. */
export function quantizeRegion(region: BackdropRegion): BackdropRegion {
  return {
    x: Math.round(region.x),
    y: Math.round(region.y),
    w: Math.round(region.w),
    h: Math.round(region.h),
    radius: Math.round(region.radius * 10) / 10,
    alpha: Math.round(region.alpha * 100) / 100,
  };
}

export function sameRegions(a: readonly BackdropRegion[], b: readonly BackdropRegion[]): boolean {
  return a.length === b.length && a.every((region, index) => {
    const other = b[index];
    return region.x === other.x && region.y === other.y && region.w === other.w && region.h === other.h
      && region.radius === other.radius && region.alpha === other.alpha;
  });
}

/**
 * A computed `border-top-left-radius` in layout px: "5px", "50%" (of the width) or the first value of
 * an elliptical pair.
 */
export function cornerRadius(computed: string, layoutWidth: number): number {
  const first = computed.trim().split(/\s+/)[0] ?? "";
  const value = Number.parseFloat(first);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return first.endsWith("%") ? value / 100 * layoutWidth : value;
}

/** The element's on-screen rect, corner radius and effective opacity, or null when it draws nothing. */
function measure(element: HTMLElement): BackdropRegion | null {
  let alpha = 1;
  for (let node: Element | null = element; node && alpha > 0; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none") return null;
    if (node === element && style.visibility === "hidden") return null;
    alpha *= Number.parseFloat(style.opacity) || 0;
  }
  const rect = element.getBoundingClientRect();
  if (alpha <= 0 || rect.width < 1 || rect.height < 1) return null;
  // Transforms (the overlay's canvas scale) shrink or grow the radius with the box.
  const scale = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
  const radius = cornerRadius(getComputedStyle(element).borderTopLeftRadius, element.offsetWidth) * scale;
  return quantizeRegion({ x: rect.left, y: rect.top, w: rect.width, h: rect.height, radius, alpha });
}

type Sink = (regions: readonly BackdropRegion[]) => void;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// The browser mock preview has no native blur: page boxes under the panels stand in for it
// (`backdrop-filter` over the preview background), so reviews compare like with like.
const MOCK_STANDIN = import.meta.env?.MODE === "mock";
let strength: WorldBlurStrength = 1;

function standinSink(): Sink {
  let layer: HTMLDivElement | null = null;
  return (regions) => {
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "slui-backdrop-standin";
      layer.setAttribute("aria-hidden", "true");
      Object.assign(layer.style, { position: "fixed", inset: "0", zIndex: "0", pointerEvents: "none" });
      document.body.append(layer);
    }
    const sigma = WORLD_BLUR_SIGMA_AT_1080[strength] * window.innerHeight / 1080;
    layer.replaceChildren(...regions.map((region) => {
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "absolute", left: `${region.x}px`, top: `${region.y}px`, width: `${region.w}px`, height: `${region.h}px`,
        borderRadius: `${region.radius}px`, opacity: String(region.alpha), backdropFilter: `blur(${sigma}px)`,
      });
      return box;
    }));
  };
}

function tauriSink(): Sink {
  return (regions) => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_backdrop_regions", { regions }))
      .catch((error: unknown) => console.error("Unable to set backdrop regions", error));
  };
}

const registry = new Set<HTMLElement>();
let sink: Sink | null = null;
let sent: readonly BackdropRegion[] = [];
let frame: number | null = null;

function tick() {
  frame = null;
  const regions: BackdropRegion[] = [];
  for (const element of registry) {
    const region = measure(element);
    if (region) regions.push(region);
  }
  if (!sameRegions(regions, sent)) {
    sent = regions;
    sink?.(regions);
  }
  if (registry.size > 0) frame = requestAnimationFrame(tick);
}

function backdropSink(): Sink | null {
  if (isTauri()) return tauriSink();
  return MOCK_STANDIN ? standinSink() : null;
}

/** Puts a world blur under `element` while it is in the document; returns the unregister. */
export function registerBackdrop(element: HTMLElement): () => void {
  sink ??= backdropSink();
  registry.add(element);
  frame ??= requestAnimationFrame(tick);
  return () => {
    registry.delete(element);
    // Clear at once: the panel is leaving, and its blur must not outlive it by a frame.
    if (registry.size === 0) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (sent.length > 0) {
        sent = [];
        sink?.([]);
      }
    }
  };
}

/** Registers the referenced element for a world blur while the component is mounted. */
export function useBackdropRegion(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    return element ? registerBackdrop(element) : undefined;
  }, [ref]);
}

/** Whether a real or stand-in blur can show (Rust reports what it can do; the mock always can). */
export async function getBackdropAvailable(): Promise<boolean> {
  if (!isTauri()) return MOCK_STANDIN;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("get_backdrop_available");
}

export function subscribeBackdropAvailable(listener: (available: boolean) => void): () => void {
  if (!isTauri()) return () => undefined;
  let active = true;
  let cleanup: (() => void) | undefined;
  void import("@tauri-apps/api/event").then(({ listen }) => listen<unknown>("slgo-backdrop-available", ({ payload }) => {
    const available = (payload as { available?: unknown } | null)?.available;
    if (active && typeof available === "boolean") listener(available);
  })).then((unlisten) => {
    if (active) cleanup = unlisten;
    else unlisten();
  }).catch((error: unknown) => console.error("Unable to subscribe to backdrop availability", error));
  return () => {
    active = false;
    cleanup?.();
  };
}

export async function setBackdropOptions(options: BackdropOptions): Promise<void> {
  strength = options.strength;
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_backdrop_options", { enabled: options.enabled, strength: options.strength });
}

/**
 * Applies the blur setting and keeps `<html data-world-blur>` in step with whether a blur is
 * actually under the panels (the setting is on and SLUI can blur).
 */
export function useWorldBlur(enabled: boolean, blurStrength: WorldBlurStrength) {
  useEffect(() => {
    void setBackdropOptions({ enabled, strength: blurStrength })
      .catch((error: unknown) => console.error("Unable to set backdrop options", error));
  }, [enabled, blurStrength]);
  useEffect(() => {
    let active = true;
    let available = false;
    const root = document.documentElement;
    // The mock stand-in hides with it too (App.css).
    const apply = () => {
      root.dataset.worldBlur = enabled && available ? "on" : "off";
    };
    apply();
    void getBackdropAvailable().then((value) => {
      if (!active) return;
      available = value;
      apply();
    }).catch((error: unknown) => console.error("Unable to read backdrop availability", error));
    const unsubscribe = subscribeBackdropAvailable((value) => {
      available = value;
      apply();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled]);
}
