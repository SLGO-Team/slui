import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveMinimap, resolveMinimapSync } from "../src/features/minimap/resolver.ts";
import { BLEND_WASH, mapBlendLayers, svgDataUrl, washSvg, ZONE_WASH, ZONE_WASH_PEAK } from "../src/features/minimap/roomWash.ts";

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
  assert.equal(room.artwork.blendHref, svgDataUrl(washSvg(files(room.artwork.href), BLEND_WASH[room.zone])), `${room.id} blend wash`);
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
    assert.equal(room.artwork.blendHref === undefined, room.artwork.href === failing, "the blend wash falls back with it");
  }
  assert.equal(errors.length, 1, "the failed artwork is reported once");
} finally {
  console.error = originalError;
}
await assert.rejects(resolveMinimap({ ...init, coordinate_system: "other" }, async () => ""), /incompatible-map/);

// mapBlend (CS2 cl_hud_radar_map_additive): the page is composited over the game W as C + (1 - α)·W (premultiplied).
// The base is the BLEND_WASH room over opaque black under black at 1 - roomOpacity, the whole group at the background
// alpha a; the lift draws the same room at liftOpacity over it. Additive is M + (1 - a)·W: exact while M fits under a, otherwise the
// colour stays M and α rises only to the wash peak inside rooms. Outside rooms the radar stays the black fill at a.
assert.equal(ZONE_WASH_PEAK, 96 / 255);
assert.ok(Math.abs(Math.max(...Object.values(BLEND_WASH).flat()) - 255) < 1e-9, "the blend wash peaks at 255");
for (const zone of Object.keys(ZONE_WASH)) for (let channel = 0; channel < 3; channel++) {
  assert.ok(Math.abs(BLEND_WASH[zone][channel] * ZONE_WASH_PEAK - ZONE_WASH[zone][channel]) < 1e-9, "the blend wash keeps the zone hue");
}
const over = (top, bottom) => ({ c: top.c + (1 - top.a) * bottom.c, a: top.a + (1 - top.a) * bottom.a });
for (const a of [0, 0.1, 0.2, ZONE_WASH_PEAK, 0.5, 0.63, 1]) {
  const { roomOpacity, liftOpacity } = mapBlendLayers(a);
  assert.ok(roomOpacity > 0 && roomOpacity <= 1 && liftOpacity >= 0 && liftOpacity < 1, `layers at a=${a} are opacities`);
  for (const [zone, wash] of Object.entries(ZONE_WASH)) for (let channel = 0; channel < 3; channel++) for (const coverage of [1, 0.651, 0]) {
    const m = coverage * wash[channel] / 255;
    const blend = coverage * BLEND_WASH[zone][channel] / 255;
    // Room over opaque black, dimmed by black at 1 - roomOpacity, group at a; then the lift room at liftOpacity.
    const inner = over({ c: 0, a: 1 - roomOpacity }, over({ c: blend, a: coverage }, { c: 0, a: 1 }));
    const base = { c: a * inner.c, a: a * inner.a };
    const page = over({ c: liftOpacity * blend, a: liftOpacity * coverage }, base);
    const label = `a=${a} ${zone}[${channel}] coverage ${coverage}`;
    assert.ok(page.c <= page.a + 1e-9, `${label}: a valid premultiplied pixel`);
    // Exact for whole pixels and above the peak. A partly covered pixel under the lift (antialiased edge, translucent
    // art layer) comes out up to m·a·h·(1 - m) brighter, at most 3/255.
    const exact = coverage === 0 || coverage === 1 || liftOpacity === 0;
    assert.ok(page.c >= m - 1e-9 && page.c - m < (exact ? 1e-9 : 3 / 255), `${label}: the map colour is added in full (${page.c} vs ${m})`);
    const alpha = coverage === 0 ? a : Math.max(a, ZONE_WASH_PEAK);
    if (coverage !== 0.651) assert.ok(Math.abs(page.a - alpha) < 1e-9, `${label}: alpha ${page.a} is ${alpha}`);
  }
}

console.log(`minimap wash smoke passed (${artwork.length} artwork files, ${drawn.length} washed rooms)`);
