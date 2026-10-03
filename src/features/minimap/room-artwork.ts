import manifest from "./room-artwork.json" with { type: "json" };
import type { WorldPoint } from "./resolver";

export type RoomArtwork = {
  href: string;
  width: number;
  height: number;
  // Full-canvas corners in world coordinates: top-left, top-right, bottom-right, bottom-left.
  corners: [WorldPoint, WorldPoint, WorldPoint, WorldPoint];
};

const byPrefabName: Readonly<Record<string, string>> = manifest.byPrefabName;

export function createRoomArtwork(prefabName: string, position: WorldPoint, yaw: number, gridScale: WorldPoint): RoomArtwork {
  const filename = Object.prototype.hasOwnProperty.call(byPrefabName, prefabName) ? byPrefabName[prefabName] : undefined;
  if (!filename) throw new Error("incompatible-room-artwork");
  const { width, height, anchorX, anchorY } = manifest.canvas;
  const angle = yaw * Math.PI / 180;
  // The artwork's (-x,z), yaw+180 becomes (x,-z), yaw. Use the full grid-sized canvas,
  // not just the drawn area. See rooms/PROVENANCE.md.
  const corner = (u: number, v: number): WorldPoint => {
    const x = (u - anchorX) * gridScale.x;
    const y = (v - anchorY) * gridScale.z;
    return { x: position.x + x * Math.cos(angle) - y * Math.sin(angle),
      z: position.z - x * Math.sin(angle) - y * Math.cos(angle) };
  };
  return { href: `/assets/minimap/rooms/${encodeURIComponent(filename)}`, width, height,
    corners: [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)] };
}
