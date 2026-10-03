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

export function createRadarCamera(geometry: MapGeometry, viewpoint: MinimapViewpoint | null,
  preferences: Partial<RadarPreferences>, fullMap: boolean, activeMapScale?: number): RadarCamera {
  const settings = normalizeRadarPreferences(preferences);
  const shape = radarShape(settings, fullMap);
  const viewSize = shape === "square" ? 290 : 250;
  const radius = viewSize / 2;
  if (viewpoint && !fullMap) {
    const yaw = settings.orientation === "heading-up" ? viewpoint.yaw_degrees : 0;
    const mapScale = activeMapScale ?? settings.mapScale;
    const scale = RADAR_RADIUS / (RADAR_NORMAL_WORLD_RADIUS * 0.70 / mapScale);
    let center = { x: viewpoint.x, z: viewpoint.z };
    if (!settings.alwaysCentered) {
      // Clamp in camera axes, so heading-up uses the rotated zone's actual extent.
      const points = geometry.rooms.filter((room) => room.zone === viewpoint.zone)
        .flatMap((room) => room.footprint.flat()).map((point) => rotatePoint({ x: point.x, y: -point.z }, -yaw));
      const projected = rotatePoint({ x: center.x, y: -center.z }, -yaw);
      const clamp = (value: number, values: number[]): number => {
        const min = Math.min(...values), max = Math.max(...values), half = radius / scale;
        return max - min <= half * 2 ? (min + max) / 2 : Math.max(min + half, Math.min(max - half, value));
      };
      const world = rotatePoint({ x: clamp(projected.x, points.map((p) => p.x)),
        y: clamp(projected.y, points.map((p) => p.y)) }, yaw);
      center = { x: world.x, z: -world.y };
    }
    return { center, yaw, scale, mode: "follow", zone: viewpoint.zone, shape, viewSize };
  }
  const { bounds } = geometry;
  const center = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  const farthest = Math.max(1, ...geometry.rooms.flatMap((room) => room.footprint.flat())
    .map((point) => shape === "circle" ? Math.hypot(point.x - center.x, point.z - center.z)
      : Math.max(Math.abs(point.x - center.x), Math.abs(point.z - center.z))));
  return { center, yaw: 0, scale: (radius - RADAR_EDGE_PADDING) / farthest, mode: "overview", zone: null, shape, viewSize };
}

export function worldToRadar(point: WorldPoint, camera: RadarCamera): { x: number; y: number } {
  const projected = rotatePoint({ x: point.x - camera.center.x, y: -(point.z - camera.center.z) }, -camera.yaw);
  return { x: camera.viewSize / 2 + projected.x * camera.scale, y: camera.viewSize / 2 + projected.y * camera.scale };
}

export function roomArtworkToRadar(artwork: RoomArtwork, camera: RadarCamera): string {
  // Derive the SVG affine transform from the same corners used for overview bounds.
  const origin = worldToRadar(artwork.corners[0], camera);
  const right = worldToRadar(artwork.corners[1], camera);
  const bottom = worldToRadar(artwork.corners[3], camera);
  return `matrix(${(right.x - origin.x) / artwork.width} ${(right.y - origin.y) / artwork.width} ${
    (bottom.x - origin.x) / artwork.height} ${(bottom.y - origin.y) / artwork.height} ${origin.x} ${origin.y})`;
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

