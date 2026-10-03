import { MINIMAP_SCHEMA_VERSION, type MinimapInit, type MinimapZone } from "../../contracts/index.ts";
import template from "./vendor/map-seed/data/mapgen-raw-14.2.7.json" with { type: "json" };
import { generateFromTemplate } from "./vendor/map-seed/generator.js";
import type { Vector3 } from "./vendor/map-seed/index";
import labels from "./special-room-labels.json" with { type: "json" };
import { createRoomArtwork, type RoomArtwork } from "./room-artwork.ts";

export type WorldPoint = { x: number; z: number };
export type MapBounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type MapRoom = {
  id: string;
  zone: MinimapZone;
  name: string;
  prefabName: string;
  position: Vector3;
  rotationY: number;
  artwork: RoomArtwork;
  footprint: WorldPoint[][];
  connectors: Vector3[];
  label: string | null;
};
export type MapConnection = { from: string; to: string; kind: "connector" | "checkpoint-pair" };
export type MapGeometry = {
  descriptorKey: string;
  rooms: MapRoom[];
  roomById: ReadonlyMap<string, MapRoom>;
  connections: MapConnection[];
  bounds: MapBounds;
  zones: { zone: MinimapZone; bounds: MapBounds }[];
  diagnostics: { kind: "unknown-room-label"; roomName: string }[];
};

const cache = new Map<string, MapGeometry>();
const roomLabels: Readonly<Record<string, string | null>> = labels;

export function mapDescriptorKey(init: MinimapInit): string {
  return JSON.stringify([init.minimap_schema_version, init.game_version, init.map_generator,
    init.map_generator_version, init.map_schema_version, init.seed, init.holiday, init.coordinate_system]);
}

export function assertSupportedMap(init: MinimapInit): void {
  if (init.minimap_schema_version !== MINIMAP_SCHEMA_VERSION || init.game_version !== "14.2.7"
    || init.map_generator !== "@scpsl-tools/map-seed" || init.map_generator_version !== "1.0.0"
    || init.map_schema_version !== 1 || init.coordinate_system !== "unity-world-xz") {
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

export function resolveMinimapSync(init: MinimapInit): MapGeometry {
  assertSupportedMap(init);
  const descriptorKey = mapDescriptorKey(init);
  const cached = cache.get(descriptorKey);
  if (cached) return cached;
  const generated = generateFromTemplate(template, init.seed, { holiday: init.holiday });
  const diagnostics: MapGeometry["diagnostics"] = [];
  const rooms: MapRoom[] = generated.rooms.flatMap((room) => {
    if (room.zone.name !== "Entrance" && room.zone.name !== "HeavyContainment") return [];
    if (!Object.prototype.hasOwnProperty.call(roomLabels, room.name.name)) diagnostics.push({ kind: "unknown-room-label", roomName: room.name.name });
    const artwork = createRoomArtwork(room.prefabName, room.position, room.rotationY, generated.gridScale);
    return [{ id: room.id, zone: room.zone.name, name: room.name.name, prefabName: room.prefabName, position: room.position,
      rotationY: room.rotationY, artwork, footprint: [artwork.corners],
      connectors: room.connectorInstances.map((connector) => connector.worldPosition), label: roomLabels[room.name.name] ?? null }];
  });
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const connections: MapConnection[] = generated.connectorAdjacency
    .filter((edge) => roomById.has(edge.from) && roomById.has(edge.to))
    .map(({ from, to }) => ({ from, to, kind: "connector" }));
  const checkpoints = rooms.filter((room) => room.name === "HczCheckpointToEntranceZone");
  for (const hcz of checkpoints.filter((room) => room.zone === "HeavyContainment")) {
    const ez = checkpoints.find((room) => room.zone === "Entrance"
      && Math.abs(room.position.y - hcz.position.y) < 0.001
      && Math.abs(room.position.z - hcz.position.z) < 0.001
      && Math.abs(room.position.x - hcz.position.x - generated.gridScale.x) < 0.001);
    if (!ez) throw new Error("incompatible-checkpoint-geometry");
    connections.push({ from: hcz.id, to: ez.id, kind: "checkpoint-pair" });
  }
  if (connections.filter((edge) => edge.kind === "checkpoint-pair").length !== 2) throw new Error("incompatible-checkpoint-geometry");
  const geometry: MapGeometry = { descriptorKey, rooms, roomById, connections, bounds: boundsFor(rooms),
    zones: (["HeavyContainment", "Entrance"] as const).map((zone) => ({ zone, bounds: boundsFor(rooms.filter((room) => room.zone === zone)) })), diagnostics };
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(descriptorKey, geometry);
  return geometry;
}

export async function resolveMinimap(init: MinimapInit): Promise<MapGeometry> {
  return resolveMinimapSync(init);
}
