# Overlay performance baseline (2026-10-31)

Measured on the cloud dev container (Linux, no GPU). Absolute numbers will differ in
production WebView2 on a gaming PC; ratios between configurations are what the child
tasks use as acceptance evidence. Re-run the same scripts after each child task.

## How to reproduce

```bash
# Minimap reducer + selector cost, cold map generation (Node, no browser)
node .trellis/tasks/10-31-overlay-perf/research/bench-minimap.mjs .

# React commits / re-renders and main-thread time in the mock overlay (dev build, headless Chromium)
npm run dev:mock   # in another shell, port 1420
NODE_PATH=$(npm root -g) node .trellis/tasks/10-31-overlay-perf/research/profile-overlay.cjs
```

`profile-overlay.cjs` installs a fake `__REACT_DEVTOOLS_GLOBAL_HOOK__` and counts, per commit,
fibers of watched components whose props object changed. Inside a subtree skipped by a
`React.memo` bailout the descendants keep stale alternates, so their counts (e.g.
`PlayerSlot`) are not meaningful once a parent is memoized; the memoized component's own
count is.

## Results

### React re-render fan-out (`profile-overlay.cjs`, default radar, 10 s)

| Metric | Value |
|---|---|
| React commits/s | 47.2 (positions 15 Hz + minimap clock 32 ms) |
| `HudTeamCounter` / `ShopPanel` / `ChatInput` / `MinimapRadar` re-renders/s | 47.2 each |
| `PlayerSlot` re-renders/s | 472 |
| Main thread (CDP, dev build) | Task 598 ms/s, Script 444 ms/s, Layout 10 ms/s, RecalcStyle 18 ms/s |

Experiment (scratch copy only): wrapping `HudTeamCounter`, `ShopPanel`, `ChatInput` in
`React.memo` dropped their re-renders to 4.0 / 4.0 / 5.1 per second and Task to 515 ms/s
(-14%). `MinimapRadar` keeps re-rendering at the commit rate.

### Minimap model cost (`bench-minimap.mjs`, 10 s simulated, 47 renders/s)

| Configuration | per render (reducer + `selectMinimap`) |
|---|---|
| default (centered, fixed, no dynamic zoom) | 43–64 µs |
| heading-up, centered | 38–42 µs |
| heading-up, not centered | 199–233 µs |
| dynamic zoom, centered | 285–310 µs |
| **dynamic zoom + heading-up + not centered** | **8.3–8.4 ms** (≈ 390 ms CPU per second) |

| Micro | Value |
|---|---|
| `createRadarCamera` non-centered | 155–169 µs/call |
| `createRadarCamera` overview | 67–87 µs/call |
| `resolveMinimapSync` cold seed | 10–16 ms |
| raw `generateFromTemplate` first call (incl. JIT) | ~22 ms |
| rooms per map | 68 (HCZ 46, Entrance 22), 4 footprint corners each |

Experiment (scratch copy only): caching each zone's footprint points per geometry
(`WeakMap<MapGeometry, Map<zone, Float64Array>>`) and computing the rotated extent in one
allocation-free pass brought `createRadarCamera` non-centered to 5.2 µs and the worst
configuration to 0.66 ms per render. `minimap-model-smoke` and `minimap-integration-smoke`
passed on that copy.

### Production bundle (`VITE_CONTROL_PLANE_URL=… vite build`)

- Overlay chunk `App-*.js` 503 KB (66 KB gzip) contains mock fixtures (`map-demo-1`, mock
  chat lines) and the 345 KB map-generator template.
- Module top level runs `const ma=ea()` = `createMockMinimapInit()`
  (`src/mocks/minimapFixtures.ts:110`), i.e. a full map generation at production startup.
- `App.tsx:325-331` recomputes the debug shop / HUD states every 250 ms in production.

## Not measured here

- GPU raster / composite cost of the 70 filtered room `<g>` elements (`MinimapRadar.tsx:131-136`)
  and of `backdrop-filter` / `mix-blend-mode` in a transparent WebView2 window.
- Whether WebView2 reports the overlay page hidden after `ShowWindow(SW_HIDE)`
  (`src-tauri/src/lib.rs:243-249`); the controller's `IsVisible` is never changed.
- Rust polling (`lib.rs:522-538` every 2 s, `lib.rs:595-631` every 100 ms); estimated cheap.

## Environment note

`package-lock.json` resolves to `registry.npmmirror.com`, which this container's proxy
refuses. Install with the locked versions from npmjs instead:

```bash
npm ci --registry=https://registry.npmjs.org --replace-registry-host=always
```
