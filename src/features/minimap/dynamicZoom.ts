import type { MinimapPosition, MinimapViewpoint } from "../../contracts";
import type { MapGeometry } from "./resolver";
import { createRadarCamera, RADAR_EDGE_PADDING, worldToRadar } from "./camera.ts";
import type { RadarPreferences } from "./preferences.ts";

export type DynamicZoomState = {
  identity: string; targets: string; scale: number; recoverAtMs: number | null; updatedAtMs: number;
};

export function dynamicZoomTargets(positions: MinimapPosition[], viewpoint: MinimapViewpoint): MinimapPosition[] {
  return positions.filter((position) => position.status === "live" && position.zone === viewpoint.zone);
}

export function dynamicZoomTarget(geometry: MapGeometry, viewpoint: MinimapViewpoint,
  positions: MinimapPosition[], preferences: RadarPreferences, selectedScale: number): number {
  const targets = dynamicZoomTargets(positions, viewpoint);
  const fits = (scale: number): boolean => {
    const camera = createRadarCamera(geometry, viewpoint, preferences, false, scale);
    const radius = camera.viewSize / 2;
    return targets.every((position) => {
      const point = worldToRadar(position, camera);
      const x = Math.abs(point.x - radius), y = Math.abs(point.y - radius);
      return (camera.shape === "circle" ? Math.hypot(x, y) : Math.max(x, y)) <= radius - RADAR_EDGE_PADDING;
    });
  };
  if (fits(selectedScale)) return selectedScale;
  if (!fits(0.25)) return 0.25;
  // The non-centered camera also changes with scale. Fit against that same camera.
  let lower = 0.25, upper = selectedScale;
  for (let step = 0; step < 20; step++) {
    const middle = (lower + upper) / 2;
    if (fits(middle)) lower = middle; else upper = middle;
  }
  return lower;
}

export function advanceDynamicZoom(previous: DynamicZoomState | null,
  input: { identity: string; targets: string; targetScale: number; selectedScale: number; nowMs: number }): DynamicZoomState {
  const { identity, targets, selectedScale, nowMs } = input;
  const target = Math.max(0.25, Math.min(selectedScale, input.targetScale));
  if (!previous || previous.identity !== identity || nowMs < previous.updatedAtMs) {
    return { identity, targets, scale: target, recoverAtMs: null, updatedAtMs: nowMs };
  }
  if (target <= previous.scale) return { identity, targets, scale: target, recoverAtMs: null, updatedAtMs: nowMs };
  const recoverAtMs = previous.targets !== targets ? nowMs + 2000 : previous.recoverAtMs ?? nowMs + 2000;
  const elapsed = Math.max(0, nowMs - Math.max(previous.updatedAtMs, recoverAtMs)) / 1000;
  return { identity, targets, scale: Math.min(target, previous.scale + elapsed * 0.35), recoverAtMs, updatedAtMs: nowMs };
}
