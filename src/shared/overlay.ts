import { useEffect, useState } from "react";

export const OVERLAY_DESIGN_WIDTH = 1920;
export const OVERLAY_DESIGN_HEIGHT = 1080;

/**
 * Panorama lays the HUD out in a space 1080 units tall and `1080 * width / height` wide, scaled
 * uniformly by `height / 1080` (CS2 endofmatch-characters.js centres a 1440 band with
 * `1080 * (w / h) * 0.5 - 720`). Each canvas is therefore `100vw / scale` design px wide, capped at
 * 1920 (wider screens keep the 16:9 canvas centred), and panels keep their left / right / centre anchors.
 */
export function overlayScaleForViewport(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  return height / OVERLAY_DESIGN_HEIGHT;
}

function currentOverlayScale(): number {
  if (typeof window === "undefined") return 1;
  return overlayScaleForViewport(window.innerWidth, window.innerHeight);
}

export function useOverlayScale(): number {
  const [scale, setScale] = useState(currentOverlayScale);
  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setScale(currentOverlayScale());
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);
  return scale;
}
