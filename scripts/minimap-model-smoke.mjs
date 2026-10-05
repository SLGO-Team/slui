import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const root = resolve("src/features/minimap");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const digest = (text) => createHash("sha256").update(text).digest("hex");
const artworkManifest = JSON.parse(read("room-artwork.json"));
const artworkRoot = resolve("public/assets/minimap/rooms");
const artworkProvenance = JSON.parse(readFileSync(resolve(artworkRoot, "PROVENANCE.json"), "utf8"));
assert.equal(digest(read("room-artwork.json")), artworkProvenance.manifestSha256, "reviewed prefab mapping stays pinned");
const artworkFiles = [...new Set(Object.values(artworkManifest.byPrefabName))].sort();
assert.equal(artworkFiles.length, 29);
assert.deepEqual(readdirSync(artworkRoot).filter((name) => name.endsWith(".svg")).sort(), artworkFiles, "only used room artwork is bundled");
assert.deepEqual(Object.keys(artworkProvenance.assets).sort(), artworkFiles);
for (const filename of artworkFiles) {
  const svg = readFileSync(resolve(artworkRoot, filename), "utf8");
  assert.equal(digest(svg), artworkProvenance.assets[filename], `${filename}: source artwork unchanged`);
  assert.match(svg, /viewBox="0 0 256 256"/);
  assert.match(svg, /<path\s/);
  assert.doesNotMatch(svg, /<!DOCTYPE|<!ENTITY|\b(?:href|style|on\w+)\s*=|url\(/i, `${filename}: no scripts or external dependencies`);
  for (const tag of svg.matchAll(/<\/?([\w:]+)/g)) assert.ok(["svg", "title", "path"].includes(tag[1]), `${filename}: static vector markup`);
}
const fixtures = JSON.parse(read("vendor/map-seed/fixtures.json"));
const originalDecode = "Buffer.from(atlas.rgbaBase64, 'base64')";
const browserDecode = "Uint8Array.from(atob(atlas.rgbaBase64), (character) => character.charCodeAt(0))";
const modificationNotice = "// Modified by SLUI on 2026-09-07: use browser atob/Uint8Array instead of Buffer for atlas decoding.\n"
  + "// Upstream Apache-2.0 license and exact source provenance are retained in LICENSE and PROVENANCE.md.\n";
assert.equal(digest(read("vendor/map-seed/generator.js").replace(modificationNotice, "").replace(browserDecode, originalDecode)), fixtures.sourceHashes["src/generator.js"]);
for (const name of ["random.js", "errors.js"]) assert.equal(digest(read(`vendor/map-seed/${name}`)), fixtures.sourceHashes[`src/${name}`]);
assert.equal(digest(read("vendor/map-seed/LICENSE")), fixtures.sourceHashes.LICENSE);
assert.equal(digest(read("vendor/map-seed/data/mapgen-raw-14.2.7.json")), fixtures.template.sha256);

const result = await build({
  stdin: { contents: `export * from "./resolver.ts"; export * from "./model.ts"; export * from "./camera.ts"; export * from "./room-artwork.ts";
    export * from "./preferences.ts"; export * from "./dynamicZoom.ts";
    export { parseEvent } from "../../contracts/index.ts";
    import template from "./vendor/map-seed/data/mapgen-raw-14.2.7.json";
    import { generateFromTemplate } from "./vendor/map-seed/generator.js";
    export const generateFixture = (seed, holiday) => generateFromTemplate(template, seed, {holiday});`, resolveDir: root },
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "minimapTest", target: "es2020",
});
const context = { atob };
runInNewContext(result.outputFiles[0].text, context);
const { generateFixture, resolveMinimapSync, mapDescriptorKey, minimapReducer, initialMinimapState,
  selectMinimap, createRadarCamera, worldToRadar, roomArtworkToWorld, cameraToRadar, createRoomArtwork,
  positionMarker, shortestAngle, parseEvent, normalizeRadarPreferences, DEFAULT_RADAR_PREFERENCES,
  CS2_REFERENCE_RADAR_PREFERENCES, RADAR_NUMERIC_RANGES, dynamicZoomTarget, advanceDynamicZoom } = context.minimapTest;
const plain = (value) => JSON.parse(JSON.stringify(value));
const init = { minimap_schema_version: 5, map_id: "map-1", game_version: "14.2.7", map_generator: "@scpsl-tools/map-seed",
  map_generator_version: "1.0.0", map_schema_version: 1, seed: 1062329959, holiday: "None", coordinate_system: "unity-world-xz", position_update_hz: 15, bombsites: [] };
for (const fixture of fixtures.fixtures) {
  const output = generateFixture(fixture.seed, fixture.holiday);
  assert.equal(digest(JSON.stringify(output)), fixture.sha256, `complete generator output: ${fixture.seed}/${fixture.holiday}`);
  const geometry = resolveMinimapSync({ ...init, seed: fixture.seed, holiday: fixture.holiday });
  assert.equal(geometry.rooms.length, fixture.supportedRooms);
  assert.equal(geometry.connections.filter((edge) => edge.kind === "connector").length, fixture.supportedEdges);
  assert.equal(geometry.connections.filter((edge) => edge.kind === "checkpoint-pair").length, 2);
  assert.equal(geometry.diagnostics.length, 0);
  assert.ok(geometry.rooms.every((room) => ["Entrance", "HeavyContainment"].includes(room.zone)));
  const overview = createRadarCamera(geometry, null, { orientation: "fixed", squareWithScoreboard: false }, true);
  const squareOverview = createRadarCamera(geometry, null, { forceSquare: true }, true);
  for (const room of geometry.rooms) {
    assert.equal(room.artwork.href, `/assets/minimap/rooms/${encodeURIComponent(artworkManifest.byPrefabName[room.prefabName])}`);
    assert.strictEqual(room.footprint[0], room.artwork.corners, "bounds and renderer share the complete canvas");
    for (const point of room.footprint.flat()) {
      assert.ok(point.x >= geometry.bounds.minX && point.x <= geometry.bounds.maxX && point.z >= geometry.bounds.minZ && point.z <= geometry.bounds.maxZ);
      const projected = worldToRadar(point, overview);
      assert.ok(Math.hypot(projected.x - 125, projected.y - 125) <= 113.000001, "every seed/holiday fits all rotated canvases");
      const squarePoint = worldToRadar(point, squareOverview);
      assert.ok(Math.max(Math.abs(squarePoint.x - 145), Math.abs(squarePoint.y - 145)) <= 133.000001, "square overview fits both zones");
    }
  }
  for (const pair of geometry.connections.filter((edge) => edge.kind === "checkpoint-pair")) {
    const from = geometry.roomById.get(pair.from).artwork.corners;
    const to = geometry.roomById.get(pair.to).artwork.corners;
    // Source HCZ right-edge and EZ top-edge exit pixels already meet exactly.
    const hczExit = { x: (from[1].x + from[2].x) / 2, z: (from[1].z + from[2].z) / 2 };
    const ezExit = { x: (to[0].x + to[1].x) / 2, z: (to[0].z + to[1].z) / 2 };
    assert.ok(Math.hypot(hczExit.x - ezExit.x, hczExit.z - ezExit.z) < 1e-8, "checkpoint SVG exits join without an extra center line");
  }
}
for (const seed of [0, -1, 2147483648, NaN, 1.25]) assert.throws(() => generateFixture(seed, "None"));
assert.throws(() => generateFixture(1, "unsupported"));
for (const overrides of [{ game_version: "unknown" }, { map_generator_version: "2.0.0" }, { coordinate_system: "other" }, { minimap_schema_version: 1 }]) {
  assert.throws(() => resolveMinimapSync({ ...init, ...overrides }));
}
const geometry = resolveMinimapSync(init);
assert.strictEqual(resolveMinimapSync({ ...init, map_id: "another-map" }), geometry, "geometry cache never substitutes map identity");
const labels = JSON.parse(read("special-room-labels.json"));
const template = JSON.parse(read("vendor/map-seed/data/mapgen-raw-14.2.7.json"));
const templates = new Map(template.roomTemplates.map((room) => [room.id, room]));
const supportedTemplates = template.roomTemplates.filter((room) => ["Entrance", "HeavyContainment"].includes(room.zone.name));
assert.equal(supportedTemplates.length, 110);
assert.deepEqual(Object.keys(artworkManifest.byPrefabName).sort(), supportedTemplates.map((room) => room.prefabName).sort(), "all supported prefabs including holidays have explicit mappings");
for (const room of supportedTemplates) {
  const art = createRoomArtwork(room.prefabName, { x: 0, z: 0 }, 0, { x: 15, z: 15 });
  assert.ok(artworkFiles.includes(decodeURIComponent(art.href.split("/").at(-1))), `${room.prefabName}: existing bundled SVG`);
}
assert.throws(() => createRoomArtwork("unknown-prefab", { x: 0, z: 0 }, 0, { x: 15, z: 15 }), /incompatible-room-artwork/);
const checkpointRooms = geometry.rooms.filter((room) => room.name === "HczCheckpointToEntranceZone");
assert.equal(checkpointRooms.length, 4);
for (const room of checkpointRooms) assert.equal(decodeURIComponent(room.artwork.href.split("/").at(-1)),
  room.zone === "Entrance" ? "EZ_HCZ_Checkpoint Part.svg" : "HCZ_Straight.svg", "same semantic name keeps distinct checkpoint halves");
assert.ok(new Set(geometry.rooms.filter((room) => room.name === "Unnamed").map((room) => room.artwork.href)).size > 3,
  "Unnamed corridors preserve prefab-specific artwork");

// Exit pixels were inspected in the pinned source SVGs. Independent quarter-turn
// expectations detect wrong projection, mirrored artwork, cropped anchors and +180 drift.
const exits = {
  top: { pixel: [128, 0], world: [[0, 7.5], [7.5, 0], [0, -7.5], [-7.5, 0]] },
  right: { pixel: [256, 128], world: [[7.5, 0], [0, -7.5], [-7.5, 0], [0, 7.5]] },
  bottom: { pixel: [128, 256], world: [[0, -7.5], [-7.5, 0], [0, 7.5], [7.5, 0]] },
  left: { pixel: [0, 128], world: [[-7.5, 0], [0, 7.5], [7.5, 0], [0, -7.5]] },
};
const asymmetricRooms = { HCZ_Curve: ["right", "bottom"], EZ_Curve: ["left", "bottom"],
  HCZ_Intersection: ["top", "left", "bottom"], EZ_ThreeWay: ["top", "left", "right"],
  HCZ_079: ["left"], EZ_Endoof: ["top"] };
const origin = { x: 45, z: 90 };
for (const [prefabName, sides] of Object.entries(asymmetricRooms)) {
  const room = supportedTemplates.find((item) => item.prefabName === prefabName);
  assert.equal(room.connectorPoints.length, sides.length);
  for (const side of sides) {
    const [x, z] = exits[side].world[0];
    assert.ok(room.connectorPoints.some(({ localPosition: p }) => Math.hypot(p.x - x, p.z - z) < 0.001), `${prefabName}: artwork exits match template`);
  }
  for (const quarter of [0, 1, 2, 3]) {
    const art = createRoomArtwork(prefabName, origin, quarter * 90, { x: 15, z: 15 });
    for (const cameraYaw of [0, 37, 90]) {
      const camera = { center: origin, yaw: cameraYaw, scale: 2, mode: "follow", zone: room.zone.name, shape: "circle", viewSize: 250 };
      // The rendered chain: room artwork -> projected world (static) -> radar (camera group).
      const affine = (transform) => {
        const [a, b, c, d, e, f] = transform.slice(7, -1).split(" ").map(Number);
        return ({ x, y }) => ({ x: a * x + c * y + e, y: b * x + d * y + f });
      };
      const toWorld = affine(roomArtworkToWorld(art)), toRadar = affine(cameraToRadar(camera));
      const screenPixel = ([u, v]) => toRadar(toWorld({ x: u, y: v }));
      const center = screenPixel([128, 128]);
      assert.ok(Math.hypot(center.x - 125, center.y - 125) < 1e-8, "full canvas pivot stays registered to room/marker center");
      for (const side of sides) {
        const actual = screenPixel(exits[side].pixel);
        const [x, z] = exits[side].world[quarter];
        const expected = worldToRadar({ x: origin.x + x, z: origin.z + z }, camera);
        assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-8, `${prefabName}: ${side}, yaw ${quarter * 90}, camera ${cameraYaw}`);
      }
    }
  }
}
for (const generator of template.generators.filter((item) => ["Entrance", "HeavyContainment"].includes(item.targetZone?.name))) {
  for (const id of generator.compatibleRoomTemplateIds) assert.ok(Object.hasOwn(labels, templates.get(id).name.name), "every base template has an explicit Chinese/null label");
}

const hcz = geometry.rooms.filter((room) => room.zone === "HeavyContainment");
const ez = geometry.rooms.filter((room) => room.zone === "Entrance");
function marker(id, room, visibility, team = "team-a") {
  return { player_id: id, team_id: team, role: team === "team-a" ? "ntf" : "scp", visibility, status: "live", status_age_ms: 0, has_commander_keycard: false,
    ...room.position, yaw_degrees: 90, zone: room.zone, room_id: room.id };
}
const self = marker("76561198000000001", hcz[0], "self");
const teammate = marker("76561198000000002", hcz[1], "teammate");
const teammate2 = marker("76561198000000003", ez[0], "teammate");
const enemy = marker("76561198000000004", hcz[2], "spotted-by-self", "team-b");
const enemy2 = marker("76561198000000005", ez[1], "spotted-by-teammate", "team-b");
const pose = (position) => Object.fromEntries(["player_id", "x", "y", "z", "yaw_degrees", "zone", "room_id"].map((key) => [key, position[key]]));
const positions = { minimap_schema_version: 5, map_id: init.map_id, visibility_revision: 1,
  viewer: { player_id: self.player_id, team_id: "team-a", is_alive: true }, viewpoint: pose(self), scoreboard_visible: false,
  positions: [self, teammate, teammate2, enemy, enemy2], commander_keycard: null };
const envelope = (type, payload, sequence, extras = {}) => ({ protocol_version: 0, schema_version: 1,
  server_id: "server-1", instance_id: "instance-1", round_id: "round-1", sent_at: "2026-09-07T00:00:00.000Z",
  event_id: `event-${sequence}`, sequence, type, payload, ...extras });
const parsed = (event) => { const result = parseEvent(event); assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const event = (state, type, payload, sequence, time = sequence * 10, extras) => minimapReducer(state, {
  type: "event", event: parsed(envelope(type, payload, sequence, extras)), receivedAtMs: time });
const resolved = (state, nowMs = 30, result = geometry) => minimapReducer(state, { type: "resolved", token: state.requestToken,
  descriptorKey: mapDescriptorKey(state.init), geometry: result, nowMs });
function ready() {
  let state = minimapReducer(initialMinimapState, { type: "connection", status: "connecting" });
  state = event(state, "sidecar.baseline", { baseline: true }, 1);
  state = event(state, "minimap.init", init, 2);
  state = resolved(state);
  state = minimapReducer(state, { type: "connection", status: "live" });
  return minimapReducer(state, { type: "focus", focused: true, revision: 1 });
}
let state = ready();
state = event(state, "minimap.positions", positions, 3, 100);
assert.equal(state.frame.payload.positions.length, 5);
assert.equal(selectMinimap(state, 120).markers.length, 5);
assert.strictEqual(event(state, "minimap.positions", positions, 2, 900), state, "old sequence cannot refresh freshness");
assert.equal(selectMinimap(state, 1101).markers.length, 0);
assert.equal(selectMinimap(state, 1101).availability, "stale");
const movedSelf = { ...self, x: self.x + 10, z: self.z + 5, yaw_degrees: 120 };
const movedFrame = { ...positions, viewpoint: pose(movedSelf), positions: [movedSelf, ...positions.positions.slice(1)] };
const moving = event(state, "minimap.positions", movedFrame, 4, 150);
for (const orientation of ["fixed", "heading-up"]) {
  for (const time of [150, 175, 220]) {
    const view = selectMinimap(moving, time, { orientation });
    const followed = view.markers.find((p) => p.playerId === self.player_id);
    assert.equal(followed.x, 125, "followed marker stays centered while its pose interpolates");
    assert.equal(followed.y, 125);
    if (orientation === "heading-up") assert.equal(followed.yaw, 0, "camera heading uses the same interpolated pose");
  }
}
const oldDeadSelf = { ...self, status: "dead" };
const beforeRespawn = event(ready(), "minimap.positions", { ...positions, viewer: { ...positions.viewer, is_alive: false },
  viewpoint: pose(teammate), positions: [oldDeadSelf, teammate, teammate2, { ...enemy, visibility: "spotted-by-teammate" }, enemy2] }, 3, 100);
const respawned = event(beforeRespawn, "minimap.positions", { ...movedFrame, visibility_revision: 2 }, 4, 150);
assert.equal(selectMinimap(respawned, 150).camera.center.x, movedSelf.x, "respawn never interpolates from the last corpse location");
let badRevision = event(state, "minimap.positions", { ...positions, positions: positions.positions.filter((p) => p !== enemy) }, 4, 120);
assert.equal(badRevision.frame, null, "same revision cannot change authorization membership");
state = event(badRevision, "minimap.positions", { ...positions, visibility_revision: 2, positions: positions.positions.filter((p) => p !== enemy) }, 5, 130);
assert.equal(selectMinimap(state, 140).markers.some((p) => p.playerId === enemy.player_id), false);
assert.equal(event(state, "minimap.positions", positions, 6).frame, null, "revision rollback clears data");
const death = { ...positions, visibility_revision: 3, viewer: { ...positions.viewer, is_alive: false }, viewpoint: pose(teammate),
  positions: [teammate, teammate2, { ...enemy, visibility: "spotted-by-teammate" }, enemy2] };
state = event(state, "minimap.positions", death, 7, 200);
assert.equal(selectMinimap(state, 210).markers.length, 4, "death keeps both teammates and both authorized enemies");
state = event(state, "minimap.positions", { ...death, viewpoint: pose(teammate2) }, 8, 220);
assert.equal(selectMinimap(state, 230).markers.length, 4, "same-team spectate target does not change permission");
state = event(state, "minimap.positions", { ...death, viewpoint: null }, 9, 240);
assert.equal(selectMinimap(state, 250, { orientation: "heading-up" }).camera.yaw, 0);
assert.equal(selectMinimap(state, 250).availability, "waiting-viewpoint");
assert.equal(selectMinimap(state, 250).markers.length, 4);
state = event(state, "minimap.positions", { ...death, scoreboard_visible: true }, 10, 260);
assert.equal(selectMinimap(state, 270).fullMap, true);
state = minimapReducer(state, { type: "focus", focused: false, revision: 2 });
assert.equal(selectMinimap(state, 270).fullMap, false);
assert.equal(selectMinimap(state, 270).markers.length, 4, "focus only controls camera");
state = minimapReducer(state, { type: "focus", focused: true, revision: 3 });
state = event(state, "minimap.positions", { ...death, scoreboard_visible: true }, 11, 280);
assert.equal(selectMinimap(state, 290).fullMap, false, "late true cannot rearm after focus restore");
state = event(state, "minimap.positions", death, 12, 300);
state = event(state, "minimap.positions", { ...death, scoreboard_visible: true }, 13, 320);
assert.equal(selectMinimap(state, 330).fullMap, true);
state = event(state, "minimap.positions", { ...death, scoreboard_visible: true }, 14, 1500);
assert.equal(selectMinimap(state, 1510).fullMap, false, "an unobserved stale gap also resets scoreboard arming");
const stale = minimapReducer(state, { type: "tick", nowMs: 2600 });
assert.equal(stale.frame, null);
assert.strictEqual(stale.geometry, geometry);
state = event(stale, "minimap.positions", { ...death, visibility_revision: 4, viewer: { ...death.viewer, team_id: null }, viewpoint: null, positions: [] }, 15, 2700);
assert.equal(selectMinimap(state, 2700).markers.length, 0, "complete empty revocation frame clears all markers");
assert.equal(state.frame.payload.viewer.team_id, null);

let pending = event(ready(), "minimap.init", { ...init, map_id: "map-2" }, 20);
pending = event(pending, "minimap.positions", { ...positions, map_id: "map-2" }, 21, 100);
pending = event(pending, "minimap.positions", { ...positions, map_id: "map-2", scoreboard_visible: true }, 22, 110);
assert.equal(pending.frame, null);
assert.equal(pending.pendingFrame.receivedAtMs, 110, "only latest complete frame is queued");
assert.equal(resolved(pending, 120).frame.receivedAtMs, 110);
assert.equal(resolved(pending, 1111).frame, null, "late geometry cannot revive stale queued markers");
const oldToken = pending.requestToken;
const rebuilt = event(pending, "minimap.init", { ...init, map_id: "map-3", seed: 1 }, 23);
assert.strictEqual(minimapReducer(rebuilt, { type: "resolved", token: oldToken, descriptorKey: geometry.descriptorKey, geometry, nowMs: 120 }), rebuilt);
assert.equal(event(ready(), "minimap.init", { ...init, seed: 1 }, 20).availability, "incompatible", "map ID cannot change descriptor");
assert.equal(event(ready(), "minimap.positions", positions, 20, 100, { round_id: "old-round" }).frame, null);
const unknownRoom = { ...positions, positions: positions.positions.map((p) => p === enemy ? { ...p, room_id: "not-a-room" } : p) };
assert.equal(event(ready(), "minimap.positions", unknownRoom, 20).availability, "invalid");
let unknownPending = event(ready(), "minimap.init", init, 20);
unknownPending = event(unknownPending, "minimap.positions", unknownRoom, 21, 100);
assert.equal(resolved(unknownPending, 110).availability, "invalid", "queued room references are checked once geometry resolves");
const highInvalidPending = event(unknownPending, "minimap.positions", { ...unknownRoom, visibility_revision: 999 }, 22, 110);
const recoveredPending = event(resolved(highInvalidPending, 120), "minimap.positions", positions, 23, 130);
assert.equal(recoveredPending.availability, "live", "an invalid queued room cannot establish a blocking authorization revision");
assert.equal(recoveredPending.visibilityRevision, positions.visibility_revision);
const correctedPending = event(highInvalidPending, "minimap.positions", positions, 23, 130);
assert.equal(resolved(correctedPending, 140).availability, "live", "latest complete valid frame replaces an unvalidated pending frame");
const live = event(ready(), "minimap.positions", positions, 3, 100);
const diagnostic = { feature: "minimap", kind: "invalid-payload", eventType: "minimap.positions", serverId: "server-1", instanceId: "instance-1", eventId: "bad-frame", sequence: 4, receivedAtMs: 110 };
const invalid = minimapReducer(live, { type: "diagnostic", diagnostic });
assert.equal(invalid.frame, null);
assert.strictEqual(invalid.geometry, geometry);
assert.equal(event(invalid, "minimap.positions", positions, 5, 120).frame.payload.positions.length, 5);
assert.strictEqual(minimapReducer(live, { type: "diagnostic", diagnostic: { ...diagnostic, sequence: 2 } }), live);
const incompatible = minimapReducer(live, { type: "diagnostic", diagnostic: { ...diagnostic, eventType: "minimap.init" } });
assert.equal(incompatible.init, null);
assert.equal(event(incompatible, "minimap.positions", positions, 5).frame, null);
const disconnected = minimapReducer(live, { type: "connection", status: "offline" });
assert.equal(disconnected.frame, null);
assert.equal(disconnected.baselineAccepted, false);
assert.equal(event(disconnected, "minimap.init", init, 10).init, null);
assert.strictEqual(minimapReducer(disconnected, { type: "resolved", token: live.requestToken, descriptorKey: geometry.descriptorKey, geometry, nowMs: 120 }), disconnected);
let reconnected = event(disconnected, "sidecar.baseline", { baseline: true }, 10);
assert.equal(reconnected.geometry, null);
reconnected = event(reconnected, "minimap.init", init, 11);
reconnected = event(resolved(reconnected, 120), "minimap.positions", positions, 12, 130);
assert.equal(reconnected.frame.payload.positions.length, 5);
const differentInstance = event(live, "minimap.positions", positions, 20, 200, { instance_id: "instance-2" });
assert.equal(differentInstance.baselineAccepted, false);
assert.equal(differentInstance.geometry, null);

const fixed = createRadarCamera(geometry, pose(self), { orientation: "fixed" }, false);
const rotated = createRadarCamera(geometry, pose(self), { orientation: "heading-up" }, false);
assert.deepEqual(plain(worldToRadar(self, fixed)), { x: 125, y: 125 });
assert.ok(worldToRadar({ x: self.x, z: self.z + 1 }, fixed).y < 125, "+Z projects up");
assert.ok(Math.abs(worldToRadar({ x: self.x + 1, z: self.z }, rotated).x - 125) < 0.001);
assert.ok(worldToRadar({ x: self.x + 1, z: self.z }, rotated).y < 125, "yaw 90 rotates +X to up");
assert.equal(shortestAngle(359, 1, 0.5), 360);
const full = createRadarCamera(geometry, pose(self), { orientation: "heading-up", squareWithScoreboard: false }, true);
for (const point of geometry.rooms.flatMap((room) => room.footprint.flat())) {
  const projected = worldToRadar(point, full);
  assert.ok(Math.hypot(projected.x - 125, projected.y - 125) <= 113.000001, "overview fits complete room footprints with padding");
}
const edge = positionMarker({ ...enemy, x: self.x + 1000 }, fixed);
assert.equal(edge.edge, true);
assert.ok(Math.abs(Math.hypot(edge.x - 125, edge.y - 125) - 113) < 0.001);
const namedRoom = geometry.rooms.find((room) => room.label && room.name !== "HczCheckpointToEntranceZone");
const anchoredSelf = marker(self.player_id, namedRoom, "self");
const anchoredFrame = { ...positions, viewpoint: pose(anchoredSelf), positions: [anchoredSelf, ...positions.positions.slice(1)] };
const locationState = event(ready(), "minimap.positions", anchoredFrame, 3, 100);
assert.equal(selectMinimap(locationState, 180).locationLabel, namedRoom.label);
assert.equal("labels" in selectMinimap(locationState, 180), false, "map room-label layer is removed");
assert.equal(context.minimapTest.placeRoomLabels, undefined, "no obsolete layout shim remains");
assert.equal(selectMinimap(locationState, 1101).locationLabel, "两区概览", "stale cannot retain the old location");
const unnamed = geometry.rooms.find((room) => room.label === null);
const unnamedSelf = marker(self.player_id, unnamed, "self");
const unnamedState = event(ready(), "minimap.positions", { ...positions, viewpoint: pose(unnamedSelf), positions: [unnamedSelf] }, 3, 100);
assert.equal(selectMinimap(unnamedState, 150).locationLabel, unnamed.zone === "Entrance" ? "办公区" : "重收容区");
const missingRoomSelf = { ...anchoredSelf, room_id: null };
const missingRoomState = event(ready(), "minimap.positions", { ...positions, viewpoint: pose(missingRoomSelf), positions: [missingRoomSelf] }, 3, 100);
assert.equal(selectMinimap(missingRoomState, 150).locationLabel, namedRoom.zone === "Entrance" ? "办公区" : "重收容区");
assert.equal(selectMinimap(event(ready(), "minimap.positions", { ...death, viewpoint: pose(teammate2) }, 3, 100), 150).locationLabel,
  geometry.roomById.get(teammate2.room_id).label ?? "办公区", "spectator location follows the real viewpoint");

// All preferences are independently normalized without rewriting caller values.
assert.equal(Object.keys(DEFAULT_RADAR_PREFERENCES).length, 11);
assert.deepEqual(plain(normalizeRadarPreferences({ orientation: "heading-up" })), { ...plain(DEFAULT_RADAR_PREFERENCES), orientation: "heading-up" });
assert.deepEqual(plain(normalizeRadarPreferences(null)), plain(DEFAULT_RADAR_PREFERENCES));
assert.equal(CS2_REFERENCE_RADAR_PREFERENCES.mapScale, 0.25);
assert.equal(CS2_REFERENCE_RADAR_PREFERENCES.orientation, "heading-up");
for (const [key, [min, max]] of Object.entries(RADAR_NUMERIC_RANGES)) {
  for (const [input, expected] of [[min, min], [max, max], [min - 1, min], [max + 1, max],
    [NaN, DEFAULT_RADAR_PREFERENCES[key]], [Infinity, DEFAULT_RADAR_PREFERENCES[key]],
    [-Infinity, DEFAULT_RADAR_PREFERENCES[key]], ["0.8", DEFAULT_RADAR_PREFERENCES[key]], [null, DEFAULT_RADAR_PREFERENCES[key]]]) {
    const source = Object.freeze({ [key]: input });
    assert.equal(normalizeRadarPreferences(source)[key], expected, `${key}: ${input}`);
    assert.equal(source[key], input);
  }
}
for (const key of ["alwaysCentered", "mapBlend", "blurBackground", "squareWithScoreboard", "forceSquare", "dynamicZoom"]) {
  for (const value of [true, false]) assert.equal(normalizeRadarPreferences({ [key]: value })[key], value);
  for (const value of [0, 1, "false", null, []]) assert.equal(normalizeRadarPreferences({ [key]: value })[key], DEFAULT_RADAR_PREFERENCES[key]);
}
for (const value of [null, 1, "unknown", ["heading-up"]]) assert.equal(normalizeRadarPreferences({ orientation: value }).orientation, "fixed");
assert.equal(createRadarCamera(geometry, pose(self), { mapScale: 0.7 }, false).scale, 125 / 45);
assert.equal(createRadarCamera(geometry, pose(self), { mapScale: 0.25 }, false).scale,
  createRadarCamera(geometry, pose(self), { mapScale: 1 }, false).scale / 4);
assert.deepEqual(plain(createRadarCamera(geometry, pose(self), { hudScale: 0.8 }, false)),
  plain(createRadarCamera(geometry, pose(self), { hudScale: 1.3 }, false)), "HUD scale does not change world coverage");
for (const forceSquare of [false, true]) for (const squareWithScoreboard of [false, true]) for (const scoreboard of [false, true]) {
  const camera = createRadarCamera(geometry, pose(self), { forceSquare, squareWithScoreboard }, scoreboard);
  const expectedShape = forceSquare || (squareWithScoreboard && scoreboard) ? "square" : "circle";
  assert.equal(camera.shape, expectedShape);
  assert.equal(camera.viewSize, expectedShape === "square" ? 290 : 250);
  assert.equal(selectMinimap(initialMinimapState, 0, { forceSquare }).viewSize, forceSquare ? 290 : 250);
}
const square = createRadarCamera(geometry, pose(self), { forceSquare: true }, false);
assert.equal(square.scale, fixed.scale, "square keeps the same world-to-design scale");
assert.deepEqual(plain(worldToRadar(self, square)), { x: 145, y: 145 });
const squareEdge = positionMarker({ ...enemy, x: self.x + 1000, z: self.z - 1000 }, square);
assert.equal(squareEdge.edge, true);
assert.equal(squareEdge.x, 278); assert.equal(squareEdge.y, 278);
assert.ok(Math.hypot(squareEdge.x - 145, squareEdge.y - 145) > 133, "square corner must not use a circular edge projection");
const corner = { ...self, x: self.x + 120 / fixed.scale, z: self.z - 120 / fixed.scale };
assert.equal(positionMarker(corner, fixed).edge, true);
assert.equal(positionMarker(corner, square).edge, false);

// Independent clamp expectations in rotated axes, including an undersized zone.
for (const yaw of [0, 37, 90, 180, 270]) for (const forceSquare of [false, true]) for (const mapScale of [0.25, 0.7, 1]) {
  const point = { ...pose(self), x: -1000, z: 1000, yaw_degrees: yaw };
  const camera = createRadarCamera(geometry, point, { orientation: "heading-up", alwaysCentered: false, forceSquare, mapScale }, false);
  const angle = yaw * Math.PI / 180;
  const axes = (p) => [p.x * Math.cos(angle) - p.z * Math.sin(angle), -p.x * Math.sin(angle) - p.z * Math.cos(angle)];
  const bounds = hcz.flatMap((room) => room.footprint.flat()).map(axes);
  const actual = axes(camera.center), desired = axes(point);
  for (const axis of [0, 1]) {
    const min = Math.min(...bounds.map((p) => p[axis])), max = Math.max(...bounds.map((p) => p[axis]));
    const half = camera.viewSize / 2 / camera.scale;
    const expected = max - min <= half * 2 ? (min + max) / 2 : Math.max(min + half, Math.min(max - half, desired[axis]));
    assert.ok(Math.abs(actual[axis] - expected) < 1e-8, "camera clamp follows current rotated zone bounds");
  }
}
for (const pageBackdrop of [true, false]) for (const blurBackground of [true, false]) for (const mapBlend of [true, false]) {
  const view = selectMinimap(live, 150, { blurBackground, mapBlend }, { pageBackdrop });
  assert.deepEqual(plain(view.effects), { mapBlend, blurBackground: blurBackground && pageBackdrop, pageBackdrop });
  assert.equal(view.markers.length, 5);
}
assert.equal(selectMinimap(live, 150).effects.blurBackground, false, "external backdrop capability defaults unsupported");

const configure = (snapshot, preferences = snapshot.preferences, alternateZoomActive = snapshot.alternateZoomRequested, nowMs = snapshot.radarUpdatedAtMs) =>
  minimapReducer(snapshot, { type: "radar-options", preferences, controls: { alternateZoomActive }, nowMs });
let zoom = configure(live, { mapScale: 0.4, alternateMapScale: 0.9 }, true, 150);
assert.equal(selectMinimap(zoom, 150).activeMapScale, 0.9);
assert.equal(selectMinimap(zoom, 150).fullMap, false, "alternate action never opens scoreboard overview");
assert.strictEqual(zoom.geometry, live.geometry); assert.strictEqual(zoom.frame, live.frame);
assert.equal(zoom.preferences.mapScale, 0.4);
zoom = event(zoom, "minimap.positions", { ...positions, scoreboard_visible: true }, 4, 200);
assert.equal(selectMinimap(zoom, 210).camera.mode, "overview");
assert.equal(selectMinimap(zoom, 210).alternateZoomActive, false);
zoom = event(zoom, "minimap.positions", positions, 5, 250);
assert.equal(selectMinimap(zoom, 260).activeMapScale, 0.9);
zoom = minimapReducer(zoom, { type: "focus", focused: false, revision: 2 });
assert.equal(selectMinimap(zoom, 260).activeMapScale, 0.4);
zoom = minimapReducer(zoom, { type: "focus", focused: true, revision: 3 });
zoom = event(zoom, "minimap.positions", positions, 6, 300);
assert.equal(selectMinimap(zoom, 300).alternateZoomActive, false, "held true does not reactivate on focus recovery");
zoom = configure(zoom, zoom.preferences, false, 310);
zoom = configure(zoom, zoom.preferences, true, 320);
assert.equal(selectMinimap(zoom, 320).activeMapScale, 0.9);
zoom = event(zoom, "minimap.positions", positions, 7, 1500);
assert.equal(selectMinimap(zoom, 1500).alternateZoomActive, false, "stale gaps reset held action without needing a prior tick");
zoom = configure(configure(zoom, zoom.preferences, false, 1510), zoom.preferences, true, 1520);
assert.equal(selectMinimap(zoom, 1520).alternateZoomActive, true);
zoom = minimapReducer(zoom, { type: "tick", nowMs: 2600 });
assert.equal(selectMinimap(zoom, 2600).alternateZoomActive, false);
zoom = event(zoom, "minimap.positions", positions, 8, 2700);
assert.equal(selectMinimap(zoom, 2700).alternateZoomActive, false);
zoom = configure(configure(zoom, zoom.preferences, false, 2710), zoom.preferences, true, 2720);
zoom = event(zoom, "minimap.positions", { ...death, viewpoint: null }, 9, 2730);
assert.equal(selectMinimap(zoom, 2730).camera.mode, "overview");
assert.equal(selectMinimap(zoom, 2730).alternateZoomActive, false);
zoom = minimapReducer(zoom, { type: "connection", status: "offline" });
assert.equal(zoom.alternateZoomArmed, false);
assert.equal(zoom.preferences.mapScale, 0.4);

// Recovery is delayed, then time-based; incoming targets expand immediately.
let smooth = advanceDynamicZoom(null, { identity: "map/view", targets: "near", targetScale: 0.8, selectedScale: 0.8, nowMs: 0 });
smooth = advanceDynamicZoom(smooth, { identity: "map/view", targets: "far", targetScale: 0.3, selectedScale: 0.8, nowMs: 100 });
assert.equal(smooth.scale, 0.3);
smooth = advanceDynamicZoom(smooth, { identity: "map/view", targets: "near", targetScale: 0.8, selectedScale: 0.8, nowMs: 200 });
assert.equal(smooth.recoverAtMs, 2200);
for (const nowMs of [2199, 2200]) {
  smooth = advanceDynamicZoom(smooth, { identity: "map/view", targets: "near", targetScale: 0.8, selectedScale: 0.8, nowMs });
  assert.equal(smooth.scale, 0.3, "no recovery before or exactly at the 2 second boundary");
}
smooth = advanceDynamicZoom(smooth, { identity: "map/view", targets: "near", targetScale: 0.8, selectedScale: 0.8, nowMs: 2700 });
assert.ok(Math.abs(smooth.scale - 0.475) < 1e-8);
smooth = advanceDynamicZoom(smooth, { identity: "map/view", targets: "new-near", targetScale: 0.8, selectedScale: 0.8, nowMs: 2800 });
assert.equal(smooth.recoverAtMs, 4800, "new authorization resets the recovery wait");
smooth = advanceDynamicZoom(smooth, { identity: "new-source", targets: "near", targetScale: 0.8, selectedScale: 0.8, nowMs: 2900 });
assert.equal(smooth.scale, 0.8); assert.equal(smooth.recoverAtMs, null);
assert.deepEqual(Object.keys(smooth).sort(), ["identity", "recoverAtMs", "scale", "targets", "updatedAtMs"], "zoom history contains no poses");
const farEnemy = { ...enemy, x: self.x + 70, z: self.z, room_id: null, visibility: "spotted-by-teammate" };
const nearPayload = { ...positions, positions: [self] };
const farPayload = { ...positions, visibility_revision: 2, positions: [self, farEnemy] };
let dynamic = configure(event(ready(), "minimap.positions", nearPayload, 3, 100), { dynamicZoom: true, mapScale: 0.8 }, false, 110);
assert.equal(selectMinimap(dynamic, 110).activeMapScale, 0.8);
dynamic = event(dynamic, "minimap.positions", farPayload, 4, 200);
const expanded = selectMinimap(dynamic, 200);
assert.ok(expanded.activeMapScale < 0.8 && expanded.activeMapScale >= 0.25);
assert.equal(expanded.markers.find((p) => p.playerId === farEnemy.player_id).edge, false);
assert.equal(dynamicZoomTarget(geometry, pose(self), [self, { ...farEnemy, zone: "Entrance" }], normalizeRadarPreferences({}), 0.8), 0.8, "other-zone targets do not influence follow zoom");
dynamic = event(dynamic, "minimap.positions", { ...nearPayload, visibility_revision: 3 }, 5, 300);
assert.equal(selectMinimap(dynamic, 300).markers.length, 1, "lost enemy clears immediately while zoom recovers later");
assert.equal(dynamic.dynamicZoom.recoverAtMs, 2300);
const crossZoneChange = event(dynamic, "minimap.positions", { ...nearPayload, visibility_revision: 4, positions: [self, teammate2] }, 6, 400);
assert.equal(crossZoneChange.dynamicZoom.recoverAtMs, 2300, "other-zone authorization does not delay current-zone recovery");
const inactiveEnemy = { ...farEnemy, x: self.x + 1, status: "dead" };
const deadTargetChange = event(dynamic, "minimap.positions", { ...nearPayload, visibility_revision: 4, positions: [self, inactiveEnemy] }, 6, 400);
assert.equal(deadTargetChange.dynamicZoom.recoverAtMs, 2300, "dead markers cannot delay recovery");
const reactivatedTarget = event(deadTargetChange, "minimap.positions", { ...nearPayload, visibility_revision: 5, positions: [self, { ...inactiveEnemy, status: "live" }] }, 7, 500);
assert.equal(reactivatedTarget.dynamicZoom.recoverAtMs, 2500, "a newly live in-zone target resets waiting even when wire membership is unchanged");
assert.equal(event(deadTargetChange, "minimap.positions", { ...nearPayload, visibility_revision: 4, positions: [self, { ...inactiveEnemy, status: "live" }] }, 7, 500).frame, null,
  "v3 status is part of the authorization key, so dead -> live needs a new revision");
for (const [sequence, time] of [[6, 1000], [7, 1700], [8, 2300]]) dynamic = event(dynamic, "minimap.positions", { ...nearPayload, visibility_revision: 3 }, sequence, time);
assert.equal(dynamic.dynamicZoom.scale, expanded.activeMapScale);
dynamic = minimapReducer(dynamic, { type: "tick", nowMs: 2800 });
assert.ok(Math.abs(dynamic.dynamicZoom.scale - expanded.activeMapScale - 0.175) < 1e-8);
const waitingDynamic = event(dynamic, "minimap.positions", farPayload, 9, 2900); // Old revision is invalid and clears all dynamic state.
assert.equal(waitingDynamic.dynamicZoom, null);
for (const change of [
  (s) => configure(s, { ...s.preferences, dynamicZoom: false }, false, 2900),
  (s) => minimapReducer(s, { type: "focus", focused: false, revision: 2 }),
  (s) => minimapReducer(s, { type: "tick", nowMs: 3401 }),
  (s) => minimapReducer(s, { type: "connection", status: "offline" }),
  (s) => event(s, "minimap.positions", { ...nearPayload, visibility_revision: 3, scoreboard_visible: true }, 9, 2900),
  (s) => event(s, "minimap.positions", { ...nearPayload, visibility_revision: 4, viewer: { ...positions.viewer, team_id: null }, positions: [], viewpoint: null }, 9, 2900),
]) assert.equal(change(dynamic).dynamicZoom, null, "disabled/full/focus/stale/revoked contexts clear scalar waiting state");
for (const changes of [{ forceSquare: true }, { orientation: "heading-up" }, { alwaysCentered: false }, { mapScale: 0.9 }]) {
  assert.equal(configure(dynamic, { ...dynamic.preferences, ...changes }, false, 2900).dynamicZoom.recoverAtMs, null, "camera context changes reset waiting");
}
const staleDynamic = minimapReducer(dynamic, { type: "tick", nowMs: 3401 });
const restoredDynamic = event(staleDynamic, "minimap.positions", { ...nearPayload, visibility_revision: 3 }, 9, 3500);
assert.equal(restoredDynamic.dynamicZoom.scale, 0.8);
assert.equal(restoredDynamic.dynamicZoom.recoverAtMs, null, "stale recovery never restores old enemy extent/waiting");
let newSourceDynamic = minimapReducer(dynamic, { type: "connection", status: "offline" });
newSourceDynamic = event(newSourceDynamic, "sidecar.baseline", { baseline: true }, 10, 3500);
newSourceDynamic = event(newSourceDynamic, "minimap.init", init, 11, 3510);
newSourceDynamic = resolved(newSourceDynamic, 3520);
newSourceDynamic = event(newSourceDynamic, "minimap.positions", nearPayload, 12, 3530);
assert.equal(newSourceDynamic.dynamicZoom.scale, 0.8);
assert.equal(newSourceDynamic.dynamicZoom.recoverAtMs, null, "reconnection keeps preferences but discards dynamic history");
let movingZoom = configure(event(ready(), "minimap.positions", nearPayload, 3, 100), { dynamicZoom: true, mapScale: 0.8 }, false, 110);
const advancingSelf = { ...self, x: self.x + 10 };
const newlySpotted = { ...farEnemy, x: self.x + 55 };
movingZoom = event(movingZoom, "minimap.positions", { ...positions, visibility_revision: 2,
  viewpoint: pose(advancingSelf), positions: [advancingSelf, newlySpotted] }, 4, 200);
const firstExpandedScale = movingZoom.dynamicZoom.scale;
for (const time of [200, 232, 267]) {
  movingZoom = minimapReducer(movingZoom, { type: "tick", nowMs: time });
  const view = selectMinimap(movingZoom, time);
  assert.equal(view.markers.find((p) => p.playerId === newlySpotted.player_id).edge, false,
    "new target fits immediately while the viewpoint is still interpolating");
  assert.equal(view.activeMapScale, firstExpandedScale, "interpolation finishing must not skip the delayed recovery");
  assert.equal(view.markers.find((p) => p.playerId === self.player_id).x, 125);
}
// v3 CS2 markers: last-known `?` fades over 6 s, death `X` over 4 s, both frozen and never camera/zoom targets.
{
  const ghost = { ...enemy, visibility: "spotted-by-teammate", status: "last-known", status_age_ms: 3000, x: enemy.x + 3 };
  const deadMate = { ...teammate, status: "dead", status_age_ms: 1000 };
  const cs2Frame = { ...positions, visibility_revision: 1, positions: [self, deadMate, teammate2, ghost, enemy2] };
  let cs2 = event(ready(), "minimap.positions", cs2Frame, 3, 1000);
  const at = (time) => Object.fromEntries(selectMinimap(cs2, time).markers.map((m) => [m.playerId, m]));
  let markers = at(1000);
  assert.equal(markers[ghost.player_id].status, "last-known");
  assert.ok(Math.abs(markers[ghost.player_id].opacity - 0.5) < 1e-9, "last-known alpha = 1 - age / 6000");
  assert.ok(Math.abs(markers[deadMate.player_id].opacity - 0.75) < 1e-9, "death alpha = 1 - age / 4000");
  assert.equal(markers[self.player_id].opacity, 1);
  markers = at(1600);
  assert.ok(Math.abs(markers[ghost.player_id].opacity - 0.4) < 1e-9, "age advances with the local clock after receipt");
  assert.ok(Math.abs(markers[deadMate.player_id].opacity - 0.6) < 1e-9);
  const view = selectMinimap(cs2, 1600);
  assert.equal(view.camera.center.x, self.x, "frozen markers never become the camera target");
  const lateGhost = event(ready(), "minimap.positions", { ...cs2Frame, positions: [self, { ...ghost, status_age_ms: 5500 }, enemy2] }, 3, 1000);
  assert.equal(selectMinimap(lateGhost, 1400).markers.some((m) => m.playerId === ghost.player_id), true);
  assert.equal(selectMinimap(lateGhost, 1500).markers.some((m) => m.playerId === ghost.player_id), false,
    "an expired marker is dropped by the local clock even while the frame is fresh");
  const moved = event(cs2, "minimap.positions", { ...cs2Frame, positions: [self, deadMate, teammate2, { ...ghost, x: ghost.x + 40 }, enemy2] }, 4, 1050);
  assert.equal(selectMinimap(moved, 1060).markers.find((m) => m.playerId === ghost.player_id).x,
    selectMinimap(moved, 1200).markers.find((m) => m.playerId === ghost.player_id).x, "frozen markers are not interpolated");
  const liveAgain = event(cs2, "minimap.positions", { ...cs2Frame, visibility_revision: 2, positions: [self, deadMate, teammate2, { ...enemy, visibility: "spotted-by-teammate" }, enemy2] }, 4, 1100);
  assert.equal(selectMinimap(liveAgain, 1100).markers.find((m) => m.playerId === ghost.player_id).status, "live",
    "a re-spotted enemy returns to a live marker");
  assert.equal(event(cs2, "minimap.positions", { ...cs2Frame, positions: [self, deadMate, teammate2, { ...enemy, visibility: "spotted-by-teammate" }, enemy2] }, 4, 1100).frame, null,
    "live <-> last-known needs a new visibility revision");
  const statusOrder = selectMinimap(cs2, 1000).markers.map((m) => m.status);
  assert.ok(statusOrder.lastIndexOf("dead") < statusOrder.indexOf("live") || !statusOrder.includes("dead"), "frozen markers render beneath live ones");
}

// v4 commander keycard (CS2 bomb): holder icon on its marker (a spotted enemy too), dropped / planted / fading radar item.
{
  const holder = { ...teammate, has_commander_keycard: true };
  const carried = { ...positions, visibility_revision: 1, positions: [self, holder, teammate2, enemy, enemy2] };
  const held = event(ready(), "minimap.positions", carried, 3, 100);
  const view = selectMinimap(held, 100);
  assert.equal(view.markers.filter((m) => m.hasKeycard).map((m) => m.playerId).join(), teammate.player_id, "only the holder carries the icon");
  assert.equal(view.keycard, null);
  assert.equal(event(held, "minimap.positions", positions, 4, 110).frame, null, "a holder change needs a new visibility revision");
  const enemyHolder = selectMinimap(event(ready(), "minimap.positions",
    { ...positions, positions: [self, teammate, teammate2, { ...enemy, has_commander_keycard: true }, enemy2] }, 3, 100), 100);
  assert.equal(enemyHolder.markers.find((m) => m.hasKeycard).hostile, true, "a spotted enemy holder shows the card like the CS2 carrier");
  const near = hcz[1];
  const drop = { x: near.position.x + 1, y: near.position.y, z: near.position.z, zone: near.zone, room_id: near.id,
    team_id: "team-a", status: "live", status_age_ms: 0, state: "dropped" };
  const dropped = event(held, "minimap.positions", { ...positions, visibility_revision: 2, commander_keycard: drop }, 4, 120);
  const dropView = selectMinimap(dropped, 120);
  assert.equal(dropView.markers.some((m) => m.hasKeycard), false);
  assert.ok(dropView.keycard && dropView.keycard.state === "dropped" && dropView.keycard.opacity === 1, "a seen drop is placed on the radar");
  assert.equal(dropView.keycard.hostile, false, "the owning side sees its own card");
  const enemyCard = selectMinimap(event(ready(), "minimap.positions", { ...positions, commander_keycard: { ...drop, team_id: "team-b" } }, 3, 100), 100);
  assert.equal(enemyCard.keycard.hostile, true, "the other side's card is drawn red, like the CS2 enemy C4");
  assert.equal(event(dropped, "minimap.positions", { ...positions, visibility_revision: 2, commander_keycard: { ...drop, state: "planted" } }, 5, 125).frame, null,
    "dropped -> planted needs a new visibility revision");
  const planted = selectMinimap(event(dropped, "minimap.positions", { ...positions, visibility_revision: 3, commander_keycard: { ...drop, state: "planted" } }, 5, 125), 125);
  assert.equal(planted.keycard.state, "planted", "a card planted in a generator stays fixed there like the CS2 planted bomb");
  const camera = dropView.camera;
  const expected = selectMinimap(event(ready(), "minimap.positions", { ...positions, positions: [self, { ...teammate, x: drop.x, z: drop.z }] }, 3, 120), 120)
    .markers.find((m) => m.playerId === teammate.player_id);
  assert.ok(Math.abs(dropView.keycard.x - expected.x) < 1e-9 && Math.abs(dropView.keycard.y - expected.y) < 1e-9 && camera,
    "the item uses the same projection and edge clamp as markers");
  const lost = { ...drop, status: "last-known", status_age_ms: 2000 };
  assert.equal(event(dropped, "minimap.positions", { ...positions, visibility_revision: 2, commander_keycard: lost }, 5, 130).frame, null,
    "live -> last-known (SCP losing sight) needs a new visibility revision");
  const fading = event(dropped, "minimap.positions", { ...positions, visibility_revision: 3, commander_keycard: lost }, 5, 1000);
  assert.ok(Math.abs(selectMinimap(fading, 1000).keycard.opacity - 0.75) < 1e-9, "CS2 bomb fade: 1 - age / 8000");
  assert.ok(Math.abs(selectMinimap(fading, 1800).keycard.opacity - 0.65) < 1e-9, "the fade advances with the local clock");
  const late = event(ready(), "minimap.positions", { ...positions, commander_keycard: { ...lost, status_age_ms: 7900 } }, 3, 100);
  assert.ok(selectMinimap(late, 150).keycard);
  assert.equal(selectMinimap(late, 200).keycard, null, "an expired item is dropped by the local clock even while the frame is fresh");
  const far = ez[ez.length - 1];
  const edge = selectMinimap(event(ready(), "minimap.positions", { ...positions, commander_keycard: { ...drop, x: far.position.x, z: far.position.z, zone: far.zone, room_id: far.id } }, 3, 100), 100);
  assert.equal(edge.keycard.edge, true, "an offscreen item clamps to the edge");
  const wrongRoom = event(ready(), "minimap.positions", { ...positions, commander_keycard: { ...drop, room_id: ez[0].id } }, 3, 100);
  assert.equal(wrongRoom.frame, null, "an item room must belong to its zone");
  assert.equal(wrongRoom.availability, "invalid");
}

// v5 bombsites (CS2 BombZoneA/B): static init data, projected and edge-clamped like markers, kept with the map.
{
  const siteAt = (label, room, dx = 0) => ({ label, x: room.position.x + dx, y: room.position.y, z: room.position.z, zone: room.zone, room_id: room.id });
  const far = ez[ez.length - 1];
  const sitesInit = { ...init, bombsites: [siteAt("A", hcz[0], 3), siteAt("B", far), { ...siteAt("C", hcz[2]), room_id: null }] };
  const readyWith = (payload) => {
    let next = minimapReducer(initialMinimapState, { type: "connection", status: "connecting" });
    next = event(next, "sidecar.baseline", { baseline: true }, 1);
    next = event(next, "minimap.init", payload, 2);
    next = resolved(next);
    next = minimapReducer(next, { type: "connection", status: "live" });
    return minimapReducer(next, { type: "focus", focused: true, revision: 1 });
  };
  const loading = event(event(minimapReducer(initialMinimapState, { type: "connection", status: "connecting" }), "sidecar.baseline", { baseline: true }, 1),
    "minimap.init", sitesInit, 2);
  assert.deepEqual(plain(selectMinimap(loading, 0).bombsites), [], "no bombsites before the geometry resolves");
  const withSites = event(readyWith(sitesInit), "minimap.positions", positions, 3, 100);
  const view = selectMinimap(withSites, 100);
  assert.deepEqual(view.bombsites.map((site) => site.label), ["A", "B", "C"]);
  const a = view.bombsites.find((site) => site.label === "A");
  const expected = selectMinimap(event(ready(), "minimap.positions", { ...positions, positions: [self, { ...teammate, x: sitesInit.bombsites[0].x, z: sitesInit.bombsites[0].z }] }, 3, 100), 100)
    .markers.find((m) => m.playerId === teammate.player_id);
  assert.ok(Math.abs(a.x - expected.x) < 1e-9 && Math.abs(a.y - expected.y) < 1e-9, "a bombsite uses the markers' projection");
  assert.equal(a.edge, false, "a site in range is drawn on the map");
  assert.equal(view.bombsites.find((site) => site.label === "B").edge, true, "an offscreen site clamps to the edge");
  const rotated = selectMinimap(withSites, 100, { orientation: "heading-up" });
  assert.notEqual(rotated.camera.yaw, 0);
  const rotatedA = rotated.bombsites.find((site) => site.label === "A");
  const rotatedExpected = plain(worldToRadar(sitesInit.bombsites[0], rotated.camera));
  assert.ok(Math.abs(rotatedA.x - rotatedExpected.x) < 1e-9 && Math.abs(rotatedA.y - rotatedExpected.y) < 1e-9, "heading-up rotates positions, never the letters");
  const overview = selectMinimap(event(withSites, "minimap.positions", { ...positions, scoreboard_visible: true }, 4, 120), 120);
  assert.equal(overview.fullMap, true);
  assert.equal(overview.bombsites.length, 3, "the full map shows every site");
  assert.ok(overview.bombsites.every((site) => !site.edge), "the overview fits both zones, so no site is clamped");
  const stale = minimapReducer(withSites, { type: "tick", nowMs: 2600 });
  assert.equal(stale.frame, null);
  assert.equal(selectMinimap(stale, 2600).markers.length, 0);
  assert.equal(selectMinimap(stale, 2600).bombsites.length, 3, "stale positions clear markers, never the static bombsites");
  assert.equal(selectMinimap(minimapReducer(withSites, { type: "diagnostic", diagnostic: { feature: "minimap", kind: "invalid-payload",
    eventType: "minimap.positions", serverId: "server-1", instanceId: "instance-1", eventId: "bad", sequence: 4, receivedAtMs: 120 } }), 120).bombsites.length, 3,
    "an invalid frame keeps the bombsites with the map");
  const offline = minimapReducer(withSites, { type: "connection", status: "offline" });
  assert.strictEqual(offline.geometry, geometry);
  assert.equal(selectMinimap(offline, 200).bombsites.length, 3, "a dropped connection keeps the bombsites with the retained map");
  // The sites belong to the geometry they were validated against: every path that drops the map drops them too.
  const pendingInit = event(withSites, "minimap.init", { ...sitesInit, map_id: "map-2", bombsites: [siteAt("B", hcz[0])] }, 4);
  assert.equal(pendingInit.geometry, null);
  assert.deepEqual(plain(pendingInit.bombsites), [], "a new init drops the previous map's sites until it resolves");
  assert.deepEqual(plain(event(withSites, "sidecar.baseline", { baseline: true }, 4).bombsites), [], "a new baseline drops the sites with the map");
  assert.deepEqual(plain(minimapReducer(withSites, { type: "connection", status: "connecting" }).bombsites), [], "a reconnect drops the sites with the map");
  const replaced = resolved(pendingInit, 130);
  assert.deepEqual(selectMinimap(replaced, 130).bombsites.map((site) => site.label), ["B"], "a new init replaces the bombsites");
  const emptied = resolved(event(withSites, "minimap.init", { ...sitesInit, map_id: "map-3", bombsites: [] }, 4), 130);
  assert.equal(selectMinimap(emptied, 130).bombsites.length, 0);
  for (const bad of [{ ...siteAt("A", hcz[1]), zone: "Entrance" }, { ...siteAt("A", hcz[1]), room_id: "not-a-room" }]) {
    let rejected = event(event(minimapReducer(initialMinimapState, { type: "connection", status: "connecting" }), "sidecar.baseline", { baseline: true }, 1),
      "minimap.init", { ...init, bombsites: [bad] }, 2);
    rejected = resolved(rejected);
    assert.equal(rejected.availability, "invalid", "a bombsite room must belong to its zone");
    assert.equal(rejected.geometry, null);
    assert.equal(rejected.init, null, "the rejected init is not committed");
    assert.deepEqual(plain(rejected.bombsites), [], "the rejected sites are not committed");
    assert.equal(selectMinimap(rejected, 30).bombsites.length, 0);
    assert.equal(event(rejected, "minimap.positions", positions, 3, 100).frame, null, "no frame is accepted against a rejected init");
  }
}

// Observation rights: a dead viewer follows an observed opponent; team-less spectators see both teams in team colors.
{
  const observedEnemy = { ...enemy, visibility: "observed" };
  const follow = { ...positions, visibility_revision: 1, viewer: { ...positions.viewer, is_alive: false },
    viewpoint: pose(observedEnemy), positions: [teammate, observedEnemy] };
  const followed = selectMinimap(event(ready(), "minimap.positions", follow, 3, 1000), 1000);
  assert.equal(followed.camera.center.x, observedEnemy.x, "the camera follows the spectated opponent");
  const enemyMarker = followed.markers.find((m) => m.playerId === observedEnemy.player_id);
  assert.equal(enemyMarker.hostile, true);
  assert.equal(enemyMarker.followed, true);
  assert.equal(followed.markers.find((m) => m.playerId === teammate.player_id).hostile, false);
  const spectator = { ...follow, viewer: { ...follow.viewer, team_id: null }, viewpoint: null,
    positions: [{ ...teammate, visibility: "observed" }, observedEnemy] };
  const overview = selectMinimap(event(ready(), "minimap.positions", spectator, 3, 1000), 1000);
  assert.equal(overview.markers.length, 2);
  assert.equal(overview.markers.every((m) => m.hostile === false), true, "a team-less spectator has no enemies, only team colors");
}
// Playout: poses follow the plugin's capture time (`sent_at`), not arrival. Captures every 67 ms at a constant
// 150 deg/s turn, arriving in the 61/61/79 ms pattern measured in game: every 240 Hz frame turns the same angle.
{
  const captureAt = Date.parse("2026-09-07T00:00:00.000Z");
  const turning = (index) => {
    const pose = { ...self, yaw_degrees: (index * 67 * 0.15) % 360 };
    return { ...positions, viewpoint: { player_id: pose.player_id, x: pose.x, y: pose.y, z: pose.z, yaw_degrees: pose.yaw_degrees, zone: pose.zone,
      room_id: pose.room_id }, positions: [pose, ...positions.positions.slice(1)] };
  };
  let arrival = 1000, playout = ready();
  const arrivals = Array.from({ length: 40 }, (_, index) => (arrival += [61, 61, 79][index % 3]) + 5);
  const steps = [];
  let next = 0, previousYaw = null;
  for (let time = arrivals[0]; time < arrivals.at(-1); time += 1000 / 240) {
    while (next < arrivals.length && arrivals[next] <= time) {
      playout = event(playout, "minimap.positions", turning(next), 3 + next, arrivals[next],
        { sent_at: new Date(captureAt + next * 67).toISOString() });
      next += 1;
    }
    playout = minimapReducer(playout, { type: "tick", nowMs: time });
    const yaw = selectMinimap(playout, time, { orientation: "heading-up" }).camera.yaw;
    if (previousYaw !== null && time > arrivals[6]) steps.push(shortestAngle(previousYaw, yaw, 1) - previousYaw);
    previousYaw = yaw;
  }
  const expected = 0.15 * 1000 / 240;
  assert.ok(steps.length > 400 && steps.every((step) => Math.abs(step - expected) < expected * 0.01),
    "the heading-up camera turns evenly through uneven arrivals: no holds or jumps");
  const waiting = minimapReducer(playout, { type: "tick", nowMs: arrivals.at(-1) + 200 });
  assert.equal(selectMinimap(waiting, arrivals.at(-1) + 200, { orientation: "heading-up" }).camera.yaw, turning(next - 1).viewpoint.yaw_degrees,
    "a frame later than the playout delay never extrapolates: the camera holds the newest capture until it arrives");
}

console.log("minimap model smoke: pinned generator and 29 SVGs/110 mappings; permissions/lifecycle; 11 preferences, circle/square fit, centering, manual/dynamic zoom, capability fallback, location title, CS2 last-known/death fades, commander keycard holder/drop, bombsites, capture-time playout and observation-right following passed");
