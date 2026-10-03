import { MINIMAP_DEAD_MS, MINIMAP_KEYCARD_FADE_MS, MINIMAP_LAST_KNOWN_MS, MINIMAP_SCHEMA_VERSION, type MinimapBombsite, type MinimapInit, type MinimapPose,
  type MinimapPosition, type MinimapPositions, type MinimapZone } from "../contracts/index.ts";
import { resolveMinimapSync } from "../features/minimap/resolver.ts";
import { CS2_REFERENCE_RADAR_PREFERENCES, DEFAULT_RADAR_PREFERENCES, normalizeRadarPreferences,
  RADAR_NUMERIC_RANGES, type RadarPreferences } from "../features/minimap/preferences.ts";

export type MinimapPreviewOptions = RadarPreferences & {
  zone: MinimapZone;
  life: "alive" | "dead" | "no-viewpoint";
  alternateZoomActive: boolean;
  scoreboard: boolean;
  paused: boolean;
  motion: boolean;
  enemies: boolean;
  dynamicTargets: "near" | "far";
  spectate: 0 | 1;
  /** Preview-only: the second enemy is a plugin-authored last-known marker whose age loops over 6 s. */
  lastKnown: boolean;
  /** Preview-only: a dead teammate death marker whose age loops over 4 s. */
  deaths: boolean;
  /**
   * Preview-only commander keycard: `carried` by the first NTF teammate (or, for an SCP viewer, by the spotted NTF
   * enemy), `dropped` near the viewer, `planted` in a started generator near the viewer, or `lost` = a dropped card
   * the viewer's side no longer sees, fading over 8 s.
   */
  keycard: "none" | "carried" | "dropped" | "planted" | "lost";
  /** Preview-only: `false` sends the init with an empty bombsite list (`?minimapBombsites=0`). */
  bombsites: boolean;
};

export const defaultMinimapPreviewOptions: MinimapPreviewOptions = {
  ...DEFAULT_RADAR_PREFERENCES, zone: "HeavyContainment", life: "alive", alternateZoomActive: false,
  scoreboard: false, paused: false, motion: true, enemies: true, dynamicTargets: "near", spectate: 0,
  lastKnown: false, deaths: false, keycard: "none", bombsites: true,
};

export function readMinimapPreviewOptions(search = window.location.search): MinimapPreviewOptions {
  const params = new URLSearchParams(search);
  const preferences = { ...(params.get("minimapPreset") === "cs2-reference"
    ? CS2_REFERENCE_RADAR_PREFERENCES : DEFAULT_RADAR_PREFERENCES) };
  for (const key of Object.keys(preferences) as (keyof RadarPreferences)[]) {
    const value = params.get(`minimap${key[0].toUpperCase()}${key.slice(1)}`);
    if (value === null) continue;
    if (key === "orientation") preferences.orientation = value === "heading-up" ? "heading-up" : "fixed";
    else if (key in RADAR_NUMERIC_RANGES) {
      const numericKey = key as keyof typeof RADAR_NUMERIC_RANGES;
      preferences[numericKey] = value.trim() ? Number(value) : NaN;
    } else if (value === "1" || value === "true" || value === "0" || value === "false") {
      const booleanKey = key as "alwaysCentered" | "mapBlend" | "blurBackground" | "squareWithScoreboard" | "forceSquare" | "dynamicZoom";
      preferences[booleanKey] = value === "1" || value === "true";
    }
  }
  return {
    ...normalizeRadarPreferences(preferences),
    zone: params.get("minimapZone") === "Entrance" ? "Entrance" : "HeavyContainment",
    life: params.get("minimapLife") === "dead" ? "dead" : params.get("minimapLife") === "no-viewpoint" ? "no-viewpoint" : "alive",
    alternateZoomActive: ["1", "true"].includes(params.get("minimapAlternateZoomActive") ?? ""),
    scoreboard: params.get("minimapScoreboard") === "1",
    paused: params.get("minimapPaused") === "1",
    motion: params.get("minimapMotion") !== "0",
    enemies: params.get("minimapEnemies") !== "0",
    dynamicTargets: params.get("minimapDynamicTargets") === "far" ? "far" : "near",
    spectate: params.get("minimapSpectate") === "1" ? 1 : 0,
    lastKnown: params.get("minimapLastKnown") === "1",
    deaths: params.get("minimapDeaths") === "1",
    keycard: (["carried", "dropped", "planted", "lost"] as const).find((value) => value === params.get("minimapKeycard")) ?? "none",
    bombsites: params.get("minimapBombsites") !== "0",
  };
}

/**
 * Mock-only mirror of the plugin's default `GeneratorRoomTypes` (Hcz939 = A, HczNuke = B) and the generator offsets
 * in `SLGO/Features/Generators/GeneratorConstants.cs` (`RoomPlacements`, room-local). The real plugin sends its own
 * resolved sites; the client never derives them. Matched by generator room name (HczNuke is `HczWarhead` there).
 */
const MOCK_BOMBSITE_ROOMS = [
  { label: "A", roomName: "Hcz939", offset: { x: 2.236, y: 0, z: -5.05 } },
  { label: "B", roomName: "HczWarhead", offset: { x: 5.783, y: -0.024, z: 6.68 } },
] as const;

/** Unity `room.Position + room.Rotation * offset` for a Y-only rotation (0 = +Z, 90 = +X). */
export function mockBombsites(init: MinimapInit): MinimapBombsite[] {
  const geometry = resolveMinimapSync(init);
  return MOCK_BOMBSITE_ROOMS.flatMap(({ label, roomName, offset }) => {
    const room = geometry.rooms.find((candidate) => candidate.name === roomName);
    if (!room) return [];
    const angle = room.rotationY * Math.PI / 180;
    return [{ label, x: room.position.x + offset.x * Math.cos(angle) + offset.z * Math.sin(angle), y: room.position.y + offset.y,
      z: room.position.z - offset.x * Math.sin(angle) + offset.z * Math.cos(angle), zone: room.zone, room_id: room.id }];
  });
}

export function createMockMinimapInit(seed = 1062329959, mapId = "map-demo-1", bombsites = true): MinimapInit {
  const init: MinimapInit = {
    minimap_schema_version: MINIMAP_SCHEMA_VERSION,
    map_id: mapId,
    game_version: "14.2.7",
    map_generator: "@scpsl-tools/map-seed",
    map_generator_version: "1.0.0",
    map_schema_version: 1,
    seed,
    holiday: "None",
    coordinate_system: "unity-world-xz",
    position_update_hz: 15,
    bombsites: [],
  };
  return bombsites ? { ...init, bombsites: mockBombsites(init) } : init;
}

export const mockMinimapInit: MinimapInit = createMockMinimapInit();

export function createMinimapFrame(
  init: MinimapInit,
  viewerId = "76561198000000001",
  team: "team-a" | "team-b" = "team-a",
  options: MinimapPreviewOptions = defaultMinimapPreviewOptions,
  frame = 0,
  visibilityRevision = 1,
): MinimapPositions {
  const geometry = resolveMinimapSync(init);
  const zoneRooms = geometry.rooms.filter((room) => room.zone === options.zone);
  const otherRooms = geometry.rooms.filter((room) => room.zone !== options.zone);
  const anchor = zoneRooms.find((room) => room.label && !room.name.includes("Checkpoint")) ?? zoneRooms[0];
  if (!anchor || !otherRooms[0]) throw new Error("Minimap fixture requires both supported zones");
  const nearby = [...zoneRooms].sort((a, b) =>
    Math.hypot(a.position.x - anchor.position.x, a.position.z - anchor.position.z)
    - Math.hypot(b.position.x - anchor.position.x, b.position.z - anchor.position.z));
  const enemyRoom = options.dynamicTargets === "far"
    ? nearby.find((room) => Math.hypot(room.position.x - anchor.position.x, room.position.z - anchor.position.z) >= 60)
      ?? nearby[nearby.length - 1]
    : nearby[2] ?? anchor;
  const phase = options.motion ? frame / init.position_update_hz : 0;
  const elapsedMs = frame * 1000 / init.position_update_hz;
  const pose = (room: typeof anchor, index: number): MinimapPose => ({
    ...room.position,
    x: room.position.x + Math.sin(phase * 0.7 + index) * 2,
    z: room.position.z + Math.cos(phase * 0.7 + index) * 2,
    yaw_degrees: (55 + phase * 14 + index * 45) % 360,
    zone: room.zone,
    room_id: room.id,
  });
  const friendlyRole = team === "team-a" ? "ntf" : "scp";
  const enemyTeam = team === "team-a" ? "team-b" : "team-a";
  const alive = options.life === "alive";
  const ids = ["76561198000000002", "76561198000000003", "76561198000000004", "76561198000000010", "76561198000000005"]
    .filter((id) => id !== viewerId);
  // CS2 bomb: the NTF side always knows its holder; the SCP side sees the card on the NTF holder it has spotted.
  const holder = options.keycard !== "carried" ? null : friendlyRole === "ntf" ? ids[0] : options.enemies ? ids[2] : null;
  const drop = options.keycard === "dropped" || options.keycard === "planted" || options.keycard === "lost" ? (nearby[2] ?? anchor) : null;
  const markers: Omit<MinimapPosition, "has_commander_keycard">[] = [
    ...(alive ? [{ ...pose(anchor, 0), player_id: viewerId, team_id: team, role: friendlyRole, visibility: "self", status: "live", status_age_ms: 0 } as MinimapPosition] : []),
    { ...pose(nearby[1] ?? anchor, 1), player_id: ids[0], team_id: team, role: friendlyRole, visibility: "teammate", status: "live", status_age_ms: 0 },
    { ...pose(otherRooms[Math.floor(otherRooms.length / 2)], 2), player_id: ids[1], team_id: team, role: friendlyRole, visibility: "teammate", status: "live", status_age_ms: 0 },
    ...(options.enemies ? [
      { ...pose(enemyRoom, 3), player_id: ids[2], team_id: enemyTeam, role: enemyTeam === "team-a" ? "ntf" : "scp", visibility: "spotted-by-teammate", status: "live", status_age_ms: 0 } as MinimapPosition,
      options.lastKnown
        ? { ...pose(enemyRoom, 4), x: pose(enemyRoom, 4).x + 6, player_id: ids[3], team_id: enemyTeam, role: enemyTeam === "team-a" ? "ntf" : "scp",
          visibility: "spotted-by-teammate", status: "last-known", status_age_ms: Math.floor(elapsedMs % MINIMAP_LAST_KNOWN_MS) } as MinimapPosition
        : { ...pose(otherRooms[0], 4), player_id: ids[3], team_id: enemyTeam, role: enemyTeam === "team-a" ? "ntf" : "scp", visibility: "spotted-by-teammate", status: "live", status_age_ms: 0 } as MinimapPosition,
    ] : []),
    ...(options.deaths && ids[4] ? [{ ...pose(nearby[3] ?? anchor, 5), player_id: ids[4], team_id: team, role: friendlyRole,
      visibility: "teammate", status: "dead", status_age_ms: Math.floor(elapsedMs % MINIMAP_DEAD_MS) } as MinimapPosition] : []),
  ];
  const positions: MinimapPosition[] = markers.map((position) => ({ ...position, has_commander_keycard: position.player_id === holder }));
  const target = options.life === "no-viewpoint" ? null : alive ? positions[0] : positions[options.spectate];
  const viewpoint = target ? {
    player_id: target.player_id, x: target.x, y: target.y, z: target.z,
    yaw_degrees: target.yaw_degrees, zone: target.zone, room_id: target.room_id,
  } : null;
  return {
    minimap_schema_version: MINIMAP_SCHEMA_VERSION, map_id: init.map_id, visibility_revision: visibilityRevision,
    viewer: { player_id: viewerId, team_id: team, is_alive: alive },
    viewpoint, scoreboard_visible: options.scoreboard, positions,
    commander_keycard: drop ? { x: drop.position.x + 3, y: drop.position.y, z: drop.position.z - 2, zone: drop.zone, room_id: drop.id,
      team_id: friendlyRole === "ntf" ? team : enemyTeam,
      state: options.keycard === "planted" ? "planted" as const : "dropped" as const, ...(options.keycard === "lost"
        ? { status: "last-known" as const, status_age_ms: Math.floor(elapsedMs % MINIMAP_KEYCARD_FADE_MS) }
        : { status: "live" as const, status_age_ms: 0 }) } : null,
  };
}

export const mockMinimapPositions = createMinimapFrame(mockMinimapInit);
