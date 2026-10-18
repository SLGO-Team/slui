import type { MinimapRoom } from "../../contracts/index.ts";
import manifest from "./room-artwork.json" with { type: "json" };
import type { WorldPoint } from "./resolver";

export type RoomCorners = [WorldPoint, WorldPoint, WorldPoint, WorldPoint];
export type RoomArtwork = {
  href: string;
  width: number;
  height: number;
  // Full-canvas corners in world coordinates: top-left, top-right, bottom-right, bottom-left.
  corners: RoomCorners;
  /** The zone + shape fallback stands in for a prefab without its own artwork (e.g. added by a game update). */
  generic: boolean;
};

const byPrefabName: Readonly<Record<string, string>> = manifest.byPrefabName;
const byZoneShape: Readonly<Record<string, Readonly<Record<string, string>>>> = manifest.byZoneShape;
// The names come from the wire: only own keys count, never inherited ones like "constructor".
const own = <T>(map: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

/**
 * The full grid-cell canvas of a room at `position` / `yaw`. The artwork's (-x,z), yaw+180 becomes (x,-z), yaw.
 * Use the full grid-sized canvas, not just the drawn area. See rooms/PROVENANCE.md.
 */
export function roomCorners(position: WorldPoint, yaw: number, grid: WorldPoint): RoomCorners {
  const { anchorX, anchorY } = manifest.canvas;
  const angle = yaw * Math.PI / 180;
  const corner = (u: number, v: number): WorldPoint => {
    const x = (u - anchorX) * grid.x;
    const y = (v - anchorY) * grid.z;
    return { x: position.x + x * Math.cos(angle) - y * Math.sin(angle),
      z: position.z - x * Math.sin(angle) - y * Math.cos(angle) };
  };
  return [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
}

/**
 * The prefab's own artwork, else the generic artwork of its zone and shape (rooms of one shape share their exits'
 * orientation), else null: a room of an unknown shape is not drawn.
 */
export function createRoomArtwork(room: Pick<MinimapRoom, "prefab" | "zone" | "shape">, position: WorldPoint, yaw: number,
  grid: WorldPoint): RoomArtwork | null {
  const prefabArtwork = own(byPrefabName, room.prefab);
  const filename = prefabArtwork ?? own(own(byZoneShape, room.zone) ?? {}, room.shape);
  if (!filename) return null;
  const { width, height } = manifest.canvas;
  return { href: `/assets/minimap/rooms/${encodeURIComponent(filename)}`, width, height,
    corners: roomCorners(position, yaw, grid), generic: prefabArtwork === undefined };
}
