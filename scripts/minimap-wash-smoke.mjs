import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveMinimap, resolveMinimapSync } from "../src/features/minimap/resolver.ts";
import { svgDataUrl, washSvg, ZONE_WASH } from "../src/features/minimap/roomWash.ts";

// The radar draws each room's artwork washed in its zone colour instead of filtering it (task 10-31-perf-radar-zone-filters).
// Multiplying the fill colours gives the filter's pixels only while the artwork paints with flat `fill="#rrggbb"` alone.
const artworkRoot = resolve("public/assets/minimap/rooms");
const artwork = readdirSync(artworkRoot).filter((name) => name.endsWith(".svg"));
assert.ok(artwork.length > 0);
for (const name of artwork) {
  const svg = readFileSync(resolve(artworkRoot, name), "utf8");
  for (const paint of svg.matchAll(/\bfill="([^"]*)"/g)) {
    assert.match(paint[1], /^(#[0-9a-fA-F]{6}|none)$/, `${name}: fill ${paint[1]} is a 6-digit colour or none`);
  }
  assert.doesNotMatch(svg, /\bstroke=|\bstyle=|\bcolor=|<image|<use|Gradient|<pattern|<filter|rgb\(|currentColor|<style/,
    `${name}: paints only with fill attributes`);
}

// White takes the wash itself; other colours are multiplied per channel; opacity and shape stay.
const sample = '<svg><path d="M0 0" fill="#ffffff" fill-opacity="0.651"/><path d="M1 1" fill="#DBDCDC"/><path fill="none"/></svg>';
assert.equal(washSvg(sample, ZONE_WASH.HeavyContainment),
  '<svg><path d="M0 0" fill="#505c5b" fill-opacity="0.651"/><path d="M1 1" fill="#454f4f"/><path fill="none"/></svg>');
assert.equal(washSvg(sample, ZONE_WASH.Entrance).match(/fill="#[0-9a-f]{6}"/)[0], 'fill="#5a6050"');
assert.equal(svgDataUrl("<svg/>"), "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");

// The resolved geometry draws washed artwork: per artwork and zone one URL, the file itself when its load failed.
const { layouts } = JSON.parse(readFileSync(resolve("src/mocks/minimap-layouts.json"), "utf8"));
const init = { minimap_schema_version: 6, map_id: "wash", coordinate_system: "unity-world-xz", grid: layouts[0].grid,
  position_update_hz: 15, rooms: layouts[0].rooms, bombsites: [] };
const files = (href) => readFileSync(resolve("public", decodeURIComponent(href).replace(/^\//, "")), "utf8");
const loads = [];
const geometry = await resolveMinimap(init, async (href) => { loads.push(href); return files(href); });
const plain = resolveMinimapSync(init);
const drawn = geometry.rooms.filter((room) => room.artwork);
assert.ok(drawn.length > 0 && drawn.some((room) => room.zone === "Entrance") && drawn.some((room) => room.zone === "HeavyContainment"));
assert.equal(new Set(loads).size, loads.length, "each artwork file loads once");
for (const room of drawn) {
  assert.equal(room.artwork.href, plain.roomById.get(room.id).artwork.href, "the file path stays");
  assert.equal(room.artwork.washedHref, svgDataUrl(washSvg(files(room.artwork.href), ZONE_WASH[room.zone])), `${room.id} washed in its zone colour`);
  assert.equal(geometry.roomById.get(room.id), room);
}
const shared = new Map();
for (const room of drawn) {
  const key = `${room.zone} ${room.artwork.href}`;
  if (shared.has(key)) assert.equal(room.artwork.washedHref, shared.get(key), "rooms with one artwork and zone share the URL");
  shared.set(key, room.artwork.washedHref);
}
assert.equal(geometry.descriptorKey, plain.descriptorKey);
assert.deepEqual(geometry.bounds, plain.bounds);

const errors = [];
const originalError = console.error;
console.error = (...args) => errors.push(args);
try {
  const failing = drawn[0].artwork.href;
  const partial = await resolveMinimap(init, async (href) => {
    if (href === failing) throw new Error("not found");
    return files(href);
  });
  for (const room of partial.rooms.filter((room) => room.artwork)) {
    assert.equal(room.artwork.washedHref === undefined, room.artwork.href === failing, "only the failed artwork falls back to the file");
  }
  assert.equal(errors.length, 1, "the failed artwork is reported once");
} finally {
  console.error = originalError;
}
await assert.rejects(resolveMinimap({ ...init, coordinate_system: "other" }, async () => ""), /incompatible-map/);

console.log(`minimap wash smoke passed (${artwork.length} artwork files, ${drawn.length} washed rooms)`);
