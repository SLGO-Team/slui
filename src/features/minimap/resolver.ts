import { MINIMAP_SCHEMA_VERSION, type MinimapInit, type MinimapZone } from "../../contracts/index.ts";
import labels from "./special-room-labels.json" with { type: "json" };
import { createRoomArtwork, roomCorners, type RoomArtwork } from "./room-artwork.ts";

export type WorldPoint = { x: number; z: number };
export type MapBounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type MapRoom = {
  id: string;
  zone: MinimapZone;
  name: string;
  shape: string;
  prefabName: string;
  position: { x: number; y: number; z: number };
  rotationY: number;
  /** Null for a room of an unknown shape: it is not drawn but still names a place. */
  artwork: RoomArtwork | null;
  footprint: WorldPoint[][];
  label: string | null;
};
export type MapDiagnostic =
  | { kind: "unknown-room-label"; roomName: string }
  | { kind: "unknown-room-artwork"; prefab: string; shape: string; generic: boolean };
export type MapGeometry = {
  descriptorKey: string;
  rooms: MapRoom[];
  roomById: ReadonlyMap<string, MapRoom>;
  bounds: MapBounds;
  diagnostics: MapDiagnostic[];
};

const cache = new Map<string, MapGeometry>();
const roomLabels: Readonly<Record<string, string | null>> = labels;

/** The layout itself identifies the geometry: the same `map_id` must never come back with another one. */
export function mapDescriptorKey(init: MinimapInit): string {
  return JSON.stringify([init.minimap_schema_version, init.coordinate_system, init.grid, init.rooms]);
}

export function assertSupportedMap(init: MinimapInit): void {
  if (init.minimap_schema_version !== MINIMAP_SCHEMA_VERSION || init.coordinate_system !== "unity-world-xz") {
    throw new Error("incompatible-map");
  }
}

function boundsFor(rooms: MapRoom[]): MapBounds {
  const points = rooms.flatMap((room) => room.footprint.flat());
  return {
    minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)),
    minZ: Math.min(...points.map((point) => point.z)), maxZ: Math.max(...points.map((point) => point.z)),
  };
}

/** Builds the radar geometry from the plugin's layout; names, shapes and prefabs SLUI does not know degrade, never fail. */
export function resolveMinimapSync(init: MinimapInit): MapGeometry {
  assertSupportedMap(init);
  const descriptorKey = mapDescriptorKey(init);
  const cached = cache.get(descriptorKey);
  if (cached) return cached;
  const diagnostics: MapDiagnostic[] = [];
  const rooms: MapRoom[] = init.rooms.map((room) => {
    // Names come from the wire: only own keys of the vocabulary count.
    const known = Object.prototype.hasOwnProperty.call(roomLabels, room.name);
    if (!known) diagnostics.push({ kind: "unknown-room-label", roomName: room.name });
    const position = { x: room.x, y: room.y, z: room.z };
    const artwork = createRoomArtwork(room, position, room.yaw_degrees, init.grid);
    if (!artwork || artwork.generic) diagnostics.push({ kind: "unknown-room-artwork", prefab: room.prefab, shape: room.shape, generic: artwork !== null });
    return { id: room.room_id, zone: room.zone, name: room.name, shape: room.shape, prefabName: room.prefab, position,
      rotationY: room.yaw_degrees, artwork, footprint: [artwork?.corners ?? roomCorners(position, room.yaw_degrees, init.grid)],
      label: known ? roomLabels[room.name] : null };
  });
  const geometry: MapGeometry = { descriptorKey, rooms, roomById: new Map(rooms.map((room) => [room.id, room])), bounds: boundsFor(rooms),
    diagnostics };
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(descriptorKey, geometry);
  return geometry;
}

export async function resolveMinimap(init: MinimapInit): Promise<MapGeometry> {
  return resolveMinimapSync(init);
}
