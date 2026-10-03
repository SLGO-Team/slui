import { useEffect, useState } from "react";

export const OVERLAY_DESIGN_WIDTH = 1920;
export const OVERLAY_DESIGN_HEIGHT = 1080;

export function overlayScaleForViewport(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  return Math.min(width / OVERLAY_DESIGN_WIDTH, height / OVERLAY_DESIGN_HEIGHT);
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
