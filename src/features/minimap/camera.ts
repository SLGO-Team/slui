import type { MinimapPosition, MinimapViewpoint, MinimapZone } from "../../contracts";
import type { MapGeometry, WorldPoint } from "./resolver";
import type { RoomArtwork } from "./room-artwork";
import { normalizeRadarPreferences, type RadarPreferences } from "./preferences.ts";
export { normalizeRadarPreferences, type RadarPreferences } from "./preferences.ts";

export const RADAR_PANEL_SIZE = 300;
export const RADAR_VIEW_SIZE = 250;
export const RADAR_RADIUS = RADAR_VIEW_SIZE / 2;
export const RADAR_NORMAL_WORLD_RADIUS = 45;
export const RADAR_EDGE_PADDING = 12;
export type RadarShape = "circle" | "square";
export type RadarCamera = {
  center: WorldPoint; yaw: number; scale: number; mode: "follow" | "overview"; zone: MinimapZone | null;
  shape: RadarShape; viewSize: 250 | 290;
};
/**
 * `opacity` is the CS2 fade of last-known (6 s) and death (4 s) markers; live markers are always 1.
 * `hostile` = on the other team than the viewer (red enemy style); `followed` = the camera follows this marker.
 * `hasKeycard` = carries the commander keycard (the plugin only sends it on live friendly / observed markers).
 */
export type RadarMarker = RadarPoint & { playerId: string; visibility: MinimapPosition["visibility"]; role: MinimapPosition["role"];
  status: MinimapPosition["status"]; opacity: number; hostile: boolean; followed: boolean; hasKeycard: boolean; yaw: number };
/** A radar-space point clamped to the edge band like CS2 offmap icons; `edgeAngle` points outward when clamped. */
export type RadarPoint = { x: number; y: number; edge: boolean; edgeAngle: number };
export function radarShape(preferences: RadarPreferences, fullMap: boolean): RadarShape {
  return preferences.forceSquare || (fullMap && preferences.squareWithScoreboard) ? "square" : "circle";
}

function rotatePoint(point: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const angle = degrees * Math.PI / 180;
  return { x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle) };
}

/**
 * What a camera needs from the map alone. The radar builds a camera on every displayed frame (and dynamic zoom up to
 * 22 per fit), so the zone corners and the overview extent are computed once per geometry. `MapGeometry` is treated
 * as immutable once `resolveMinimapSync` built it (it is cached and shared by descriptor): the cache is keyed by the
 * object itself, so a new layout gets its own entry and a dropped geometry can still be collected.
 */
type GeometryCameraCache = { zonePoints: Map<MinimapZone, Float64Array>; farthest: Partial<Record<RadarShape, number>> };
const cameraCaches = new WeakMap<MapGeometry, GeometryCameraCache>();

function cameraCache(geometry: MapGeometry): GeometryCameraCache {
  let cache = cameraCaches.get(geometry);
  if (!cache) {
    cache = { zonePoints: new Map(), farthest: {} };
    cameraCaches.set(geometry, cache);
  }
  return cache;
}

/** The zone's room corners in projected world space `(x, -z)`, interleaved `x0, y0, x1, y1, …`. */
function zonePoints(geometry: MapGeometry, zone: MinimapZone): Float64Array {
  const cache = cameraCache(geometry);
  const cached = cache.zonePoints.get(zone);
  if (cached) return cached;
  const corners = geometry.rooms.filter((room) => room.zone === zone).flatMap((room) => room.footprint.flat());
  const points = new Float64Array(corners.length * 2);
  corners.forEach((point, index) => {
    points[index * 2] = point.x;
    points[index * 2 + 1] = -point.z;
  });
  cache.zonePoints.set(zone, points);
  return points;
}

function overviewCenter(geometry: MapGeometry): WorldPoint {
  const { bounds } = geometry;
  return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
}

/** The farthest room corner from the overview center, by the radar shape's metric. */
function overviewFarthest(geometry: MapGeometry, shape: RadarShape): number {
  const cache = cameraCache(geometry);
  const cached = cache.farthest[shape];
  if (cached !== undefined) return cached;
  const center = overviewCenter(geometry);
  const farthest = Math.max(1, ...geometry.rooms.flatMap((room) => room.footprint.flat())
    .map((point) => shape === "circle" ? Math.hypot(point.x - center.x, point.z - center.z)
      : Math.max(Math.abs(point.x - center.x), Math.abs(point.z - center.z))));
  cache.farthest[shape] = farthest;
  return farthest;
}

export function createRadarCamera(geometry: MapGeometry, viewpoint: MinimapViewpoint | null,
  preferences: Partial<RadarPreferences>, fullMap: boolean, activeMapScale?: number): RadarCamera {
  return radarCameraFor(geometry, viewpoint, normalizeRadarPreferences(preferences), fullMap, activeMapScale);
}

/**
 * `createRadarCamera` for preferences that already went through `normalizeRadarPreferences`, for callers that build
 * many cameras from one preference set (dynamic zoom tries up to 22 scales per fit).
 */
export function radarCameraFor(geometry: MapGeometry, viewpoint: MinimapViewpoint | null,
  settings: RadarPreferences, fullMap: boolean, activeMapScale?: number): RadarCamera {
  const shape = radarShape(settings, fullMap);
  const viewSize = shape === "square" ? 290 : 250;
  const radius = viewSize / 2;
  if (viewpoint && !fullMap) {
    const yaw = settings.orientation === "heading-up" ? viewpoint.yaw_degrees : 0;
    const mapScale = activeMapScale ?? settings.mapScale;
    const scale = RADAR_RADIUS / (RADAR_NORMAL_WORLD_RADIUS * 0.70 / mapScale);
    let center = { x: viewpoint.x, z: viewpoint.z };
    // Clamp in camera axes, so heading-up uses the rotated zone's actual extent. A layout may lack the viewpoint's
    // zone (the protocol needs only one room); then there is nothing to clamp to.
    const points = settings.alwaysCentered ? null : zonePoints(geometry, viewpoint.zone);
    if (points && points.length) {
      // `rotatePoint(corner, -yaw)` over every corner in one pass without allocating: the same products in the same
      // order, and folding Math.min/max gives what the spread form gave (-0 included), so the camera is bit-identical.
      const angle = -yaw * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let index = 0; index < points.length; index += 2) {
        const x = points[index] * cos - points[index + 1] * sin;
        const y = points[index] * sin + points[index + 1] * cos;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const projected = rotatePoint({ x: center.x, y: -center.z }, -yaw);
      const half = radius / scale;
      const clamp = (value: number, min: number, max: number): number =>
        max - min <= half * 2 ? (min + max) / 2 : Math.max(min + half, Math.min(max - half, value));
      const world = rotatePoint({ x: clamp(projected.x, minX, maxX), y: clamp(projected.y, minY, maxY) }, yaw);
      center = { x: world.x, z: -world.y };
    }
    return { center, yaw, scale, mode: "follow", zone: viewpoint.zone, shape, viewSize };
  }
  const center = overviewCenter(geometry);
  return { center, yaw: 0, scale: (radius - RADAR_EDGE_PADDING) / overviewFarthest(geometry, shape), mode: "overview",
    zone: null, shape, viewSize };
}

export function worldToRadar(point: WorldPoint, camera: RadarCamera): { x: number; y: number } {
  const projected = rotatePoint({ x: point.x - camera.center.x, y: -(point.z - camera.center.z) }, -camera.yaw);
  return { x: camera.viewSize / 2 + projected.x * camera.scale, y: camera.viewSize / 2 + projected.y * camera.scale };
}

/**
 * The room artwork's static SVG transform into projected world space `(x, -z)`, derived from the
 * same corners used for overview bounds. `cameraToRadar` then maps that space onto the radar, so a
 * camera move rewrites one transform instead of every room's.
 */
export function roomArtworkToWorld(artwork: RoomArtwork): string {
  const [origin, right, , bottom] = artwork.corners;
  return `matrix(${(right.x - origin.x) / artwork.width} ${(origin.z - right.z) / artwork.width} ${
    (bottom.x - origin.x) / artwork.height} ${(origin.z - bottom.z) / artwork.height} ${origin.x} ${-origin.z})`;
}

/** `worldToRadar` as an SVG transform of projected world space `(x, -z)`. */
export function cameraToRadar(camera: RadarCamera): string {
  const origin = worldToRadar({ x: 0, z: 0 }, camera);
  const unitX = worldToRadar({ x: 1, z: 0 }, camera);
  const unitY = worldToRadar({ x: 0, z: -1 }, camera);
  return `matrix(${unitX.x - origin.x} ${unitX.y - origin.y} ${unitY.x - origin.x} ${unitY.y - origin.y} ${origin.x} ${origin.y})`;
}

export function clampToRadar(point: WorldPoint, camera: RadarCamera): RadarPoint {
  const projected = worldToRadar(point, camera);
  const radius = camera.viewSize / 2;
  const dx = projected.x - radius, dy = projected.y - radius;
  const distance = camera.shape === "circle" ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy));
  const edge = distance > radius - RADAR_EDGE_PADDING;
  const ratio = edge ? (radius - RADAR_EDGE_PADDING) / distance : 1;
  return { x: radius + dx * ratio, y: radius + dy * ratio, edge, edgeAngle: Math.atan2(dy, dx) * 180 / Math.PI + 90 };
}

export function positionMarker(position: MinimapPosition, camera: RadarCamera, opacity = 1): RadarMarker {
  return { ...clampToRadar(position, camera), playerId: position.player_id, visibility: position.visibility, role: position.role,
    status: position.status, opacity, hostile: position.visibility.startsWith("spotted-"), followed: false,
    hasKeycard: position.has_commander_keycard, yaw: position.yaw_degrees - camera.yaw };
}

