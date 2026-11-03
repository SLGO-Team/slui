// Benchmark: per-render cost of the minimap reducer + selector on the v6 plugin layouts, and map resolve cost.
// Usage: node .trellis/tasks/10-31-overlay-perf/research/bench-minimap.mjs [repo] [--layout=0|1] [--hz=60] [--only=<label part>]
// Simulates the store as `useMinimapFeature` drives it: positions at the init's rate (15 Hz), a clock tick on every
// displayed frame (requestAnimationFrame, --hz), and one `selectMinimap` per store change (one radar render each).
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const flag = (name, fallback) => Number(args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const repo = resolve(args.find((arg) => !arg.startsWith("--")) ?? ".");
const LAYOUT = flag("layout", 0);
const DISPLAY_HZ = flag("hz", 60);
const ONLY = args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) ?? null;
// esbuild comes from the repo's node_modules (a vite dependency) unless DEPS points elsewhere.
const require = createRequire(resolve(process.env.DEPS ?? repo, "package.json"));
const { build } = require("esbuild");

const result = await build({
  stdin: {
    contents: `export * from "./features/minimap/resolver.ts"; export * from "./features/minimap/model.ts";
      export * from "./features/minimap/camera.ts"; export * from "./features/minimap/dynamicZoom.ts";
      export * from "./mocks/minimapFixtures.ts"; export { parseEvent } from "./contracts/index.ts";`,
    resolveDir: resolve(repo, "src"),
  },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2020",
  alias: { "@slgo/protocol": resolve(repo, "packages/protocol/src/index.ts") },
});
// Imported as a module in this realm, not run through `vm.runInNewContext`: there every global lookup (`Math`, …)
// goes through the sandbox's interceptor, which inflated hot loops several-fold compared with a browser.
const m = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

let seq = 1;
const envelope = (type, payload) => {
  const parsed = m.parseEvent({ protocol_version: 0, schema_version: 1, server_id: "server-1", instance_id: "instance-1",
    round_id: "round-1", sent_at: "2026-10-31T00:00:00.000Z", event_id: `event-${seq}`, sequence: seq++, type, payload });
  if (!parsed.ok) throw new Error(`${type}: ${JSON.stringify(parsed)}`);
  return parsed.value;
};

// --- 1. Map resolve ---
{
  for (const layout of [0, 1]) {
    const init = m.createMockMinimapInit(layout, `bench-${layout}`);
    const t0 = performance.now();
    const g = m.resolveMinimapSync(init);
    const t1 = performance.now();
    const zones = g.rooms.reduce((acc, r) => ({ ...acc, [r.zone]: (acc[r.zone] ?? 0) + 1 }), {});
    const corners = g.rooms.reduce((n, r) => n + r.footprint.flat().length, 0);
    console.log(`layout ${layout}: resolveMinimapSync (cold) ${(t1 - t0).toFixed(1)} ms, rooms ${g.rooms.length} ${JSON.stringify(zones)}, footprint points ${corners}`);
  }
}

// --- 2. Per-render reducer + selector ---
function scenario(label, prefs) {
  if (ONLY !== null && !label.includes(ONLY)) return;
  const init = m.createMockMinimapInit(LAYOUT, `bench-${LAYOUT}-${label}`);
  const opts = { ...m.defaultMinimapPreviewOptions, ...prefs, enemies: true, dynamicTargets: "far", motion: true };
  let now = 0;
  let state = m.minimapReducer(m.initialMinimapState, { type: "connection", status: "connecting" });
  state = m.minimapReducer(state, { type: "event", receivedAtMs: now, event: envelope("sidecar.baseline", { baseline: true }) });
  state = m.minimapReducer(state, { type: "event", receivedAtMs: now, event: envelope("minimap.init", init) });
  state = m.minimapReducer(state, { type: "resolved", token: state.requestToken, descriptorKey: m.mapDescriptorKey(init),
    geometry: m.resolveMinimapSync(init), nowMs: now });
  state = m.minimapReducer(state, { type: "connection", status: "live" });
  state = m.minimapReducer(state, { type: "focus", focused: true, revision: 1 });
  state = m.minimapReducer(state, { type: "radar-options", preferences: prefs, controls: {}, nowMs: now });

  const frames = [];
  for (let f = 0; f < 150; f++) frames.push(envelope("minimap.positions", m.createMinimapFrame(init, "76561198000000001", "team-a", opts, f)));

  const DURATION = 10_000;
  const posStep = 1000 / init.position_update_hz, tickStep = 1000 / DISPLAY_HZ;
  let nextPos = 0, nextTick = 0, frame = 0;
  let reducerMs = 0, selectMs = 0, renders = 0;
  // Warm-up with a live frame so the JIT sees the hot path.
  state = m.minimapReducer(state, { type: "event", receivedAtMs: 0, event: frames[0] });
  for (let i = 0; i < 300; i++) m.selectMinimap(state, 1, prefs);
  while (now < DURATION) {
    now = Math.min(nextPos, nextTick);
    let t = performance.now();
    if (now === nextPos) {
      state = m.minimapReducer(state, { type: "event", receivedAtMs: now, event: frames[frame++ % frames.length] });
      nextPos += posStep;
    } else {
      state = m.minimapReducer(state, { type: "tick", nowMs: now });
      nextTick += tickStep;
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

console.log(`\nlayout ${LAYOUT}, positions ${15} Hz, clock ${DISPLAY_HZ} Hz (rAF), 10 s simulated`);
scenario("default (centered, fixed, no dyn zoom)", {});
scenario("heading-up, centered", { orientation: "heading-up" });
scenario("heading-up, NOT centered", { orientation: "heading-up", alwaysCentered: false });
scenario("dynamic zoom, centered", { dynamicZoom: true });
scenario("dynamic zoom + heading-up + NOT centered", { dynamicZoom: true, orientation: "heading-up", alwaysCentered: false });

// --- 3. Micro: createRadarCamera and dynamicZoomTarget ---
if (ONLY === null) {
  const init = m.createMockMinimapInit(LAYOUT, `bench-micro-${LAYOUT}`);
  const g = m.resolveMinimapSync(init);
  const positions = m.createMinimapFrame(init, "76561198000000001", "team-a",
    { ...m.defaultMinimapPreviewOptions, enemies: true, dynamicTargets: "far" }, 0);
  const vp = positions.viewpoint;
  const N = 20000;
  const time = (label, fn) => {
    for (let i = 0; i < 500; i++) fn(i);
    const t = performance.now();
    for (let i = 0; i < N; i++) fn(i);
    console.log(`${label.padEnd(44)} ${((performance.now() - t) / N * 1000).toFixed(1)} µs/call`);
  };
  console.log("");
  time("createRadarCamera(follow, non-centered)", (i) => m.createRadarCamera(g, { ...vp, yaw_degrees: i % 360 },
    { alwaysCentered: false, orientation: "heading-up" }, false, 0.7));
  time("createRadarCamera(follow, centered)", (i) => m.createRadarCamera(g, { ...vp, yaw_degrees: i % 360 },
    { alwaysCentered: true, orientation: "heading-up" }, false, 0.7));
  time("createRadarCamera(overview)", () => m.createRadarCamera(g, null, {}, false));
  const prefs = m.normalizeRadarPreferences({ dynamicZoom: true, orientation: "heading-up", alwaysCentered: false });
  time("dynamicZoomTarget(heading-up, non-centered)", (i) => m.dynamicZoomTarget(g, { ...vp, yaw_degrees: i % 360 },
    positions.positions, prefs, 0.7));
}
