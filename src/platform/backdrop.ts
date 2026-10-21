// World blur under overlay panels (task 10-21-backdrop-blur, src-tauri/src/backdrop.rs).
//
// CS2 blurs the world under many HUD panels (`world-blur: hudWorldBlur`). The overlay is a
// transparent window and cannot blur the game itself, so each such panel registers its element
// here; one animation-frame loop measures what the page actually renders (box, turn, corner
// radius, opacity, `inset()` clip) and sends the list to Rust, which captures the game, blurs those
// regions on the GPU and shows them under the overlay. The list is sent only when it changes, so a
// still panel costs a layout read per frame and no IPC.
//
// `<html data-world-blur="on|off">` tells panel CSS which fill to draw: the CS2 fill over the blur,
// or the dense stand-in when no blur is available (switched off, Windows 10, capture failure).

import { useCallback, useEffect } from "react";

/** Opacity samples evenly spaced from `offset` to `offset + length`: CSS px from the box's top edge, in its own frame. */
export type BackdropFade = Readonly<{ offset: number; length: number; stops: readonly number[] }>;

/**
 * Overlay CSS px. `x, y, w, h` is the panel's box before `angle` (radians, clockwise, as CSS `rotate`) turns it about
 * its centre; `radius` is the corner radius on screen, `alpha` the panel's effective opacity, `fade` an opacity mask
 * down the box.
 */
export type BackdropRegion = Readonly<{
  x: number; y: number; w: number; h: number; radius: number; alpha: number; angle?: number; fade?: BackdropFade;
}>;

/**
 * `enabled: false` registers nothing. `fade`: the panel's vertical opacity mask (its CSS `mask`) as samples evenly
 * spaced over the element's own height, at most 16 (see `sampleFade`); keep it a module constant.
 */
export type BackdropRegionOptions = Readonly<{ enabled?: boolean; fade?: readonly number[] }>;

export type WorldBlurStrength = 1 | 2 | 3;

export type BackdropOptions = Readonly<{ enabled: boolean; strength: WorldBlurStrength }>;

/** Gaussian σ at 1080p per strength; the native blur scales it with the window height. */
export const WORLD_BLUR_SIGMA_AT_1080: Readonly<Record<WorldBlurStrength, number>> = { 1: 20, 2: 30, 3: 40 };

/** Most samples a fade keeps (the shader's limit). */
export const MAX_FADE_STOPS = 16;

/** Rounded to 1 / `per`. */
const round = (value: number, per: number) => Math.round(value * per) / per;

/**
 * Whole px, tenth-px radius, two-decimal opacity and thousandth-radian turn (an upright box sends none), so sub-pixel
 * jitter never re-sends an unchanged list.
 */
export function quantizeRegion(region: BackdropRegion): BackdropRegion {
  const angle = round(region.angle ?? 0, 1000);
  const fade = region.fade && {
    offset: round(region.fade.offset, 10),
    length: round(region.fade.length, 10),
    stops: region.fade.stops.map((stop) => round(stop, 1000)),
  };
  return {
    x: Math.round(region.x),
    y: Math.round(region.y),
    w: Math.round(region.w),
    h: Math.round(region.h),
    radius: round(region.radius, 10),
    alpha: round(region.alpha, 100),
    ...(angle === 0 ? {} : { angle }),
    ...(fade ? { fade } : {}),
  };
}

function sameFade(a: BackdropFade | undefined, b: BackdropFade | undefined): boolean {
  if (!a || !b) return a === b;
  return a.offset === b.offset && a.length === b.length && a.stops.length === b.stops.length
    && a.stops.every((stop, index) => stop === b.stops[index]);
}

export function sameRegions(a: readonly BackdropRegion[], b: readonly BackdropRegion[]): boolean {
  return a.length === b.length && a.every((region, index) => {
    const other = b[index];
    return region.x === other.x && region.y === other.y && region.w === other.w && region.h === other.h
      && region.radius === other.radius && region.alpha === other.alpha && (region.angle ?? 0) === (other.angle ?? 0)
      && sameFade(region.fade, other.fade);
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

/** One computed `inset()` length in layout px: "4px", "37.5%", or a calc() sum of px and % terms (mid-transition). */
function insetLength(value: string, size: number): number {
  let total = 0;
  for (const [, sign, number, unit] of value.matchAll(/([+-]?)\s*(\d*\.?\d+(?:e[+-]?\d+)?)(px|%)?/gi)) {
    const amount = Number.parseFloat(number) * (sign === "-" ? -1 : 1);
    total += unit === "%" ? amount / 100 * size : amount;
  }
  return total;
}

/**
 * The edges a computed `clip-path: inset(...)` takes off the element's layout box, in layout px, or null for any other
 * clip. One to four values, as in `margin`; a `round` corner part is ignored.
 */
export function insetClip(computed: string, width: number, height: number) {
  const match = /^inset\((.*)\)$/.exec(computed.trim());
  if (!match) return null;
  const parts = (match[1].split(/\sround\s/)[0] ?? "").match(/calc\([^)]*\)|\S+/g) ?? [];
  if (parts.length < 1 || parts.length > 4) return null;
  const [top = "0", right = top, bottom = top, left = right] = parts;
  return {
    top: insetLength(top, height),
    right: insetLength(right, width),
    bottom: insetLength(bottom, height),
    left: insetLength(left, width),
  };
}

/** `count` samples, evenly spaced from 0 to 1, of a gradient given as (offset 0-1, opacity) stops: a CSS mask's profile. */
export function sampleFade(stops: readonly (readonly [number, number])[], count = MAX_FADE_STOPS): number[] {
  return Array.from({ length: count }, (_, index) => {
    const at = index / (count - 1);
    const next = stops.findIndex(([offset]) => offset >= at);
    if (next <= 0) return stops[next === 0 ? 0 : stops.length - 1][1];
    const [from, low] = stops[next - 1];
    const [to, high] = stops[next];
    return low + (high - low) * (at - from) / (to - from);
  });
}

/** The element's box, turn, corner radius, opacity and fade as drawn on screen, or null when it draws nothing. */
function measure(element: HTMLElement, options: BackdropRegionOptions): BackdropRegion | null {
  let alpha = 1;
  let own: CSSStyleDeclaration | null = null;
  // The transforms down to the element (the overlay's canvas scale, a card's turn).
  let matrix = new DOMMatrix();
  for (let node: Element | null = element; node && alpha > 0; node = node.parentElement) {
    const style = getComputedStyle(node);
    own ??= style;
    if (style.display === "none") return null;
    if (node === element && style.visibility === "hidden") return null;
    alpha *= Number.parseFloat(style.opacity) || 0;
    if (style.transform !== "none") matrix = new DOMMatrix(style.transform).multiply(matrix);
  }
  const rect = element.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  if (!own || alpha <= 0 || rect.width < 1 || rect.height < 1 || width <= 0 || height <= 0) return null;
  let angle = Math.atan2(matrix.b, matrix.a);
  if (Math.abs(angle) < 0.0005) angle = 0;
  // An upright box is its bounding rect (exact under scaleX openings too); a turned one is the layout box scaled by
  // the transform, about the bounding rect's centre.
  const sx = angle === 0 ? rect.width / width : Math.hypot(matrix.a, matrix.b);
  const sy = angle === 0 ? rect.height / height : Math.hypot(matrix.c, matrix.d);
  let w = width * sx;
  let h = height * sy;
  let cx = rect.left + rect.width / 2;
  let cy = rect.top + rect.height / 2;
  const clip = insetClip(own.clipPath, width, height);
  if (clip) {
    // Shrink in the box's own frame, then move the centre on screen.
    const dx = (clip.left - clip.right) / 2 * sx;
    const dy = (clip.top - clip.bottom) / 2 * sy;
    cx += dx * Math.cos(angle) - dy * Math.sin(angle);
    cy += dx * Math.sin(angle) + dy * Math.cos(angle);
    w -= (clip.left + clip.right) * sx;
    h -= (clip.top + clip.bottom) * sy;
    if (w < 1 || h < 1) return null;
  }
  const radius = cornerRadius(own.borderTopLeftRadius, width) * sx;
  const fade = options.fade && options.fade.length >= 2
    ? { offset: -(clip?.top ?? 0) * sy, length: height * sy, stops: options.fade.slice(0, MAX_FADE_STOPS) }
    : undefined;
  return quantizeRegion({ x: cx - w / 2, y: cy - h / 2, w, h, radius, alpha, angle, fade });
}

type Sink = (regions: readonly BackdropRegion[]) => void;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// The browser mock preview has no native blur: page boxes under the panels stand in for it
// (`backdrop-filter` over the preview background), so reviews compare like with like.
const MOCK_STANDIN = import.meta.env?.MODE === "mock";
let strength: WorldBlurStrength = 1;

/** The CSS mask for a fade: the samples as gradient stops, in px down the box. */
function fadeMask(fade: BackdropFade): string {
  const last = fade.stops.length - 1;
  const stops = fade.stops.map((stop, index) => `rgb(0 0 0 / ${stop}) ${fade.offset + fade.length * index / last}px`);
  return `linear-gradient(${stops.join(", ")})`;
}

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
        transform: region.angle ? `rotate(${region.angle}rad)` : "",
        maskImage: region.fade ? fadeMask(region.fade) : "",
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

const registry = new Map<HTMLElement, BackdropRegionOptions>();
let sink: Sink | null = null;
let sent: readonly BackdropRegion[] = [];
let frame: number | null = null;
let flushQueued = false;

function send() {
  const regions: BackdropRegion[] = [];
  for (const [element, options] of registry) {
    const region = measure(element, options);
    if (region) regions.push(region);
  }
  if (!sameRegions(regions, sent)) {
    sent = regions;
    sink?.(regions);
  }
}

function tick() {
  frame = null;
  send();
  if (registry.size > 0) frame = requestAnimationFrame(tick);
}

// A panel leaving takes its blur away at once instead of on the next frame. Deferred to the end of the
// React commit, so a panel remounted under a new key in the same commit keeps the blur up.
function flush() {
  flushQueued = false;
  send();
  if (registry.size === 0 && frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
}

function backdropSink(): Sink | null {
  if (isTauri()) return tauriSink();
  return MOCK_STANDIN ? standinSink() : null;
}

/** Puts a world blur under `element` while it is in the document; returns the unregister. */
export function registerBackdrop(element: HTMLElement, options: BackdropRegionOptions = {}): () => void {
  sink ??= backdropSink();
  registry.set(element, options);
  frame ??= requestAnimationFrame(tick);
  return () => {
    registry.delete(element);
    if (!flushQueued) {
      flushQueued = true;
      queueMicrotask(flush);
    }
  };
}

/**
 * A callback ref that puts a world blur under the element while it is mounted (and `enabled`): for every panel whose
 * Panorama style has `world-blur`. Its CSS draws the fill on top.
 */
export function useBackdropRef(options: BackdropRegionOptions = {}) {
  const { enabled = true, fade } = options;
  return useCallback((element: HTMLElement | null) => {
    if (!element || !enabled) return undefined;
    return registerBackdrop(element, { fade });
  }, [enabled, fade]);
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
