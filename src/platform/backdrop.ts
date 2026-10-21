// Native world blur under overlay panels (task 10-21-backdrop-blur, src-tauri/src/backdrop.rs).
//
// CS2 blurs the world under many HUD panels (`world-blur: hudWorldBlur`). The overlay is a
// transparent window and cannot blur the game itself, so each such panel registers its element
// here; one animation-frame loop measures what the page actually renders (rect, opacity) and sends
// the list to Rust, which places DWM blur windows under the overlay at those rects. The list is
// sent only when it changes, so a still panel costs a layout read per frame and no IPC.
//
// `<html data-world-blur="on|off">` tells panel CSS which fill to draw: the CS2 fill over the blur,
// or the dense stand-in when no blur is available (switched off, Windows transparency effects off,
// energy saver).

import { useEffect, type RefObject } from "react";

export type BackdropCorner = "square" | "small" | "round";

/** Overlay CSS px; `alpha` is the panel's effective opacity. */
export type BackdropRegion = Readonly<{ x: number; y: number; w: number; h: number; corner: BackdropCorner; alpha: number }>;

export type BackdropOptions = Readonly<{ enabled: boolean; layers: number }>;

/** Whole px and two-decimal opacity, so sub-pixel jitter never re-sends an unchanged list. */
export function quantizeRegion(region: BackdropRegion): BackdropRegion {
  return {
    x: Math.round(region.x),
    y: Math.round(region.y),
    w: Math.round(region.w),
    h: Math.round(region.h),
    corner: region.corner,
    alpha: Math.round(region.alpha * 100) / 100,
  };
}

export function sameRegions(a: readonly BackdropRegion[], b: readonly BackdropRegion[]): boolean {
  return a.length === b.length && a.every((region, index) => {
    const other = b[index];
    return region.x === other.x && region.y === other.y && region.w === other.w && region.h === other.h
      && region.corner === other.corner && region.alpha === other.alpha;
  });
}

/** The element's on-screen rect and effective opacity, or null when it draws nothing. */
function measure(element: Element, corner: BackdropCorner): BackdropRegion | null {
  let alpha = 1;
  for (let node: Element | null = element; node && alpha > 0; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none") return null;
    if (node === element && style.visibility === "hidden") return null;
    alpha *= Number.parseFloat(style.opacity) || 0;
  }
  const rect = element.getBoundingClientRect();
  if (alpha <= 0 || rect.width < 1 || rect.height < 1) return null;
  return quantizeRegion({ x: rect.left, y: rect.top, w: rect.width, h: rect.height, corner, alpha });
}

type Sink = (regions: readonly BackdropRegion[]) => void;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// The browser mock preview has no native blur: a page layer under the panels stands in for it
// (`backdrop-filter` over the preview background), so reviews compare like with like.
const MOCK_STANDIN = import.meta.env?.MODE === "mock";
const STANDIN_BLUR_PX = 30;
// The native top layer's 0x40 black tint (src-tauri/src/backdrop.rs).
const STANDIN_TINT = "rgba(0, 0, 0, 0.25)";

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
    const radius: Record<BackdropCorner, string> = { square: "0", small: "4px", round: "8px" };
    layer.replaceChildren(...regions.map((region) => {
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "absolute", left: `${region.x}px`, top: `${region.y}px`, width: `${region.w}px`, height: `${region.h}px`,
        borderRadius: radius[region.corner], opacity: String(region.alpha), backdropFilter: `blur(${STANDIN_BLUR_PX}px)`,
        background: STANDIN_TINT,
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

const registry = new Map<Element, BackdropCorner>();
let sink: Sink | null = null;
let sent: readonly BackdropRegion[] = [];
let frame: number | null = null;

function tick() {
  frame = null;
  const regions: BackdropRegion[] = [];
  for (const [element, corner] of registry) {
    const region = measure(element, corner);
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
export function registerBackdrop(element: Element, corner: BackdropCorner): () => void {
  sink ??= backdropSink();
  registry.set(element, corner);
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
export function useBackdropRegion(ref: RefObject<Element | null>, corner: BackdropCorner) {
  useEffect(() => {
    const element = ref.current;
    return element ? registerBackdrop(element, corner) : undefined;
  }, [ref, corner]);
}

/** Whether a real or stand-in blur can show (Rust reports Windows' state; the mock always can). */
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
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_backdrop_options", { enabled: options.enabled, layers: options.layers });
}

/**
 * Applies the blur setting and keeps `<html data-world-blur>` in step with whether a blur is
 * actually under the panels (the setting is on and Windows can blur).
 */
export function useWorldBlur(enabled: boolean, layers: number) {
  useEffect(() => {
    void setBackdropOptions({ enabled, layers }).catch((error: unknown) => console.error("Unable to set backdrop options", error));
  }, [enabled, layers]);
  useEffect(() => {
    let active = true;
    let available = false;
    const root = document.documentElement;
    const apply = () => {
      // The mock stand-in hides with it too (App.css).
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
