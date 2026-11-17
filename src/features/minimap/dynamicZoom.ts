import type { MinimapViewpoint } from "../../contracts";
import type { WorldPoint } from "./resolver";
import { RADAR_NORMAL_WORLD_RADIUS, RADAR_RADIUS } from "./camera.ts";

/**
 * CS2 `cl_radar_scale_dynamic` (client.dll, task 11-17-minimap-cs2-slui research): the radar zooms out so the farthest
 * drawn element sits at 95 % of the radius. It tracks a smoothed distance, not a scale: a larger target distance is taken
 * at once; a smaller one is held for 4 s from the first frame it appeared, then approached at most 520 Source units/s.
 * The state is scalars only, never a history of poses.
 */
export type DynamicZoomState = { identity: string; distance: number; shrinkAtMs: number | null; updatedAtMs: number };

export const DYNAMIC_ZOOM_HOLD_MS = 4000;
/** 520 Source units/s (CS2 260 x 2) at 1 unit = 1 inch = 0.0254 m. */
export const DYNAMIC_ZOOM_SHRINK_M_PER_S = 520 * 0.0254;
export const DYNAMIC_ZOOM_FILL = 0.95;
export const DYNAMIC_ZOOM_MIN_SCALE = 0.25;

/** Largest horizontal distance from the viewpoint to any drawn element; 0 when there is none. */
export function dynamicZoomDistance(viewpoint: MinimapViewpoint, points: readonly WorldPoint[]): number {
  let distance = 0;
  for (const point of points) distance = Math.max(distance, Math.hypot(point.x - viewpoint.x, point.z - viewpoint.z));
  return distance;
}

/** The map scale that puts `distance` at 95 % of the view radius, within [0.25, selected]. */
export function dynamicZoomScale(distance: number, viewSize: number, selectedScale: number): number {
  if (!(distance > 0)) return selectedScale;
  // Follow-camera pixels per metre are RADAR_RADIUS * mapScale / (45 * 0.70); solve distance * that = 0.95 * viewSize / 2.
  const fit = DYNAMIC_ZOOM_FILL * (viewSize / 2) * RADAR_NORMAL_WORLD_RADIUS * 0.70 / (RADAR_RADIUS * distance);
  return Math.max(DYNAMIC_ZOOM_MIN_SCALE, Math.min(selectedScale, fit));
}

export function advanceDynamicZoom(previous: DynamicZoomState | null,
  input: { identity: string; target: number; nowMs: number }): DynamicZoomState {
  const { identity, target, nowMs } = input;
  if (!previous || previous.identity !== identity || nowMs < previous.updatedAtMs || target >= previous.distance) {
    return { identity, distance: target, shrinkAtMs: null, updatedAtMs: nowMs };
  }
  const shrinkAtMs = previous.shrinkAtMs ?? nowMs + DYNAMIC_ZOOM_HOLD_MS;
  const elapsed = Math.max(0, nowMs - Math.max(previous.updatedAtMs, shrinkAtMs)) / 1000;
  return { identity, distance: Math.max(target, previous.distance - elapsed * DYNAMIC_ZOOM_SHRINK_M_PER_S), shrinkAtMs, updatedAtMs: nowMs };
}
