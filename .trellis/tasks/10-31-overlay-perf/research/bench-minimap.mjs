// Benchmark: per-tick cost of the minimap reducer + selector, and cold map generation.
// Usage: node .trellis/tasks/10-31-overlay-perf/research/bench-minimap.mjs .
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

const repo = resolve(process.argv[2] ?? ".");
// esbuild comes from the repo's node_modules (a vite dependency) unless DEPS points elsewhere.
const require = createRequire(resolve(process.env.DEPS ?? repo, "package.json"));
const { build } = require("esbuild");

const result = await build({
  stdin: {
    contents: `export * from "./features/minimap/resolver.ts"; export * from "./features/minimap/model.ts";
      export * from "./features/minimap/camera.ts"; export * from "./features/minimap/dynamicZoom.ts";
      export * from "./mocks/minimapFixtures.ts";
      import template from "./features/minimap/vendor/map-seed/data/mapgen-raw-14.2.7.json";
      import { generateFromTemplate } from "./features/minimap/vendor/map-seed/generator.js";
      export const generate = (seed) => generateFromTemplate(template, seed, { holiday: "None" });`,
    resolveDir: resolve(repo, "src"),
  },
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "m", target: "es2020",
  alias: { "@slgo/protocol": resolve(repo, "packages/protocol/src/index.ts") },
});
const ctx = { atob, performance, console, window: { location: { search: "" } }, URLSearchParams };
runInNewContext(result.outputFiles[0].text, ctx);
const m = ctx.m;

// --- 1. Cold map generation ---
{
  const t0 = performance.now();
  m.generate(123456);
  const t1 = performance.now();
  const init = m.createMockMinimapInit(987654321, "map-x");
  const t2 = performance.now();
  m.resolveMinimapSync({ ...init, seed: 55555 });
  const t3 = performance.now();
  console.log(`map generate (raw, first call incl. JIT): ${(t1 - t0).toFixed(1)} ms`);
  console.log(`resolveMinimapSync (cold seed): ${(t3 - t2).toFixed(1)} ms`);
  const g = m.resolveMinimapSync(init);
  const zones = g.rooms.reduce((acc, r) => ({ ...acc, [r.zone]: (acc[r.zone] ?? 0) + 1 }), {});
  console.log(`rooms: ${g.rooms.length}`, JSON.stringify(zones));
}

// --- 2. Per-tick reducer + selector ---
function scenario(label, prefs) {
  const init = m.createMockMinimapInit();
  const geometry = m.resolveMinimapSync(init);
  const opts = { ...m.defaultMinimapPreviewOptions, ...prefs, enemies: true, dynamicTargets: "far", motion: true };
  const base = { server_id: "s", instance_id: "i", round_id: "r", protocol_version: 1, schema_version: 1, event_id: "e", sent_at: new Date().toISOString() };
  let seq = 1;
  let now = 0;
  let state = m.initialMinimapState;
  state = m.minimapReducer(state, { type: "connection", status: "live" });
  state = m.minimapReducer(state, { type: "event", receivedAtMs: now, event: { ...base, type: "sidecar.baseline", sequence: seq++, payload: { baseline: true } } });
  state = m.minimapReducer(state, { type: "focus", focused: true, revision: 1 });
  state = m.minimapReducer(state, { type: "radar-options", preferences: prefs, controls: {}, nowMs: now });
  state = m.minimapReducer(state, { type: "event", receivedAtMs: now, event: { ...base, type: "minimap.init", sequence: seq++, payload: init } });
  state = m.minimapReducer(state, { type: "resolved", token: state.requestToken, descriptorKey: m.mapDescriptorKey(init), geometry, nowMs: now });

  const frames = [];
  for (let f = 0; f < 150; f++) frames.push(m.createMinimapFrame(init, "76561198000000001", "team-a", opts, f));

  // Simulate 10 s: positions at 15 Hz, tick at ~31 Hz (32 ms), selector after every state change (one render each).
  const DURATION = 10_000;
  let nextPos = 0, nextTick = 0, frame = 0;
  let reducerMs = 0, selectMs = 0, renders = 0;
  // warm-up
  for (let i = 0; i < 200; i++) { m.selectMinimap(state, now, prefs); }
  while (now < DURATION) {
    now = Math.min(nextPos, nextTick);
    let t = performance.now();
    if (now === nextPos) {
      state = m.minimapReducer(state, { type: "event", receivedAtMs: now,
        event: { ...base, type: "minimap.positions", sequence: seq++, payload: frames[frame++ % frames.length] } });
      nextPos += 1000 / 15;
    } else {
      state = m.minimapReducer(state, { type: "tick", nowMs: now });
      nextTick += 32;
    }
    reducerMs += performance.now() - t;
    t = performance.now();
    const view = m.selectMinimap(state, now, prefs);
    selectMs += performance.now() - t;
    renders++;
    if (view.availability !== "live") throw new Error(`${label}: radar not live: ${view.availability}`);
  }
  const perSec = (ms) => (ms / (DURATION / 1000)).toFixed(2);
  console.log(`${label.padEnd(44)} renders/s=${(renders / 10).toFixed(0)}  reducer=${perSec(reducerMs)} ms/s  selectMinimap=${perSec(selectMs)} ms/s  per-render=${((reducerMs + selectMs) / renders * 1000).toFixed(0)} µs`);
}

scenario("default (centered, fixed, no dyn zoom)", {});
scenario("heading-up, centered", { orientation: "heading-up" });
scenario("heading-up, NOT centered", { orientation: "heading-up", alwaysCentered: false });
scenario("dynamic zoom, centered", { dynamicZoom: true });
scenario("dynamic zoom + heading-up + NOT centered", { dynamicZoom: true, orientation: "heading-up", alwaysCentered: false });

// --- 3. Micro: createRadarCamera, non-centered ---
{
  const init = m.createMockMinimapInit();
  const g = m.resolveMinimapSync(init);
  const vp = { ...m.mockMinimapPositions.viewpoint };
  const N = 20000;
  let t = performance.now();
  for (let i = 0; i < N; i++) m.createRadarCamera(g, { ...vp, yaw_degrees: i % 360 }, { alwaysCentered: false, orientation: "heading-up" }, false, 0.7);
  console.log(`createRadarCamera(non-centered): ${((performance.now() - t) / N * 1000).toFixed(1)} µs/call`);
  t = performance.now();
  for (let i = 0; i < N; i++) m.createRadarCamera(g, null, {}, false);
  console.log(`createRadarCamera(overview):     ${((performance.now() - t) / N * 1000).toFixed(1)} µs/call`);
}
