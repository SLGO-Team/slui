# Overlay performance baseline (2026-10-31, re-measured)

Measured on the cloud dev container (Linux, no GPU, headless Chromium from Playwright, Node 22)
against `SLGO-Team/slui` at `fb3f5ce` (0.11.0). Absolute numbers will differ in WebView2 on a
gaming PC; ratios between configurations are the acceptance evidence. Re-run the same scripts
after each child task.

> The first version of this file (planning commit `5a1cced`) was measured on a stale checkout
> (`23q3/slui` main, last commit 2026-10-03). Since then #33 (v6 plugin room layout), #53 (overlay
> clock out of `App`, memo panels), #54 (WOFF2 fonts), #55 (no mock code in packages) and the
> 10-21 backdrop tasks landed, so those numbers (47 commits/s fan-out, 8.4 ms camera frames,
> 503 KB `App` chunk, generator template) no longer describe the code. Do not compare against them.

## How to reproduce

```bash
npm ci --registry=https://registry.npmjs.org --replace-registry-host=always

# Minimap reducer + selector cost per render, map resolve, camera micro-benchmarks (Node, no browser)
node .trellis/tasks/10-31-overlay-perf/research/bench-minimap.mjs . --layout=0
node .trellis/tasks/10-31-overlay-perf/research/bench-minimap.mjs . --layout=1
#   --hz=144 simulates a 144 Hz display; --only="<label part>" runs one scenario

# React commits / re-renders, radar DOM writes, main-thread time in the mock overlay (headless Chromium)
npm run dev:mock -- --port 1420 --strictPort        # in another shell
node .trellis/tasks/10-31-overlay-perf/research/profile-overlay.cjs
#   OVERLAY_URL=http://127.0.0.1:1430/ points it at a static build instead (see "Production React" below)
```

`profile-overlay.cjs` installs a fake `__REACT_DEVTOOLS_GLOBAL_HOOK__` and counts a watched component
as rendered in a commit when its fiber holds a props or hook-state object no earlier commit held
(a bailout keeps both). The first version compared with `fiber.alternate`, which counts every commit
inside a subtree React skipped (stale alternates); that produced the old `PlayerSlot` 472/s figure.
Component names are minified in a production build, so per-component counts need the dev server.

## Results

### React re-render fan-out (`profile-overlay.cjs`, dev server, 10 s)

| Metric | default radar | dynamic zoom + heading-up + not centered |
|---|---|---|
| React commits/s | 75.3 | 75.4 |
| `LiveMinimapRadar` / `MinimapRadar` re-renders/s | 75.2 / 75.2 | 75.3 / 75.3 |
| `App` re-renders/s | 1.1 | 1.1 |
| `HudTeamCounter`, `ShopPanel`, `ChatInput`, `Scoreboard`, `KillFeed`, `WinPanel`, … | 0 | 0 |
| `PlayerSlot` re-renders/s | 10.0 (HUD seconds clock, 10 slots) | 10.0 |
| Radar DOM mutations/s: map layer (`.minimap-radar__map`) | 75.2 (one camera transform per frame) | 75.2 |
| Radar DOM mutations/s: markers and the rest | 1278 (~17 per frame) | 1239 |
| Main thread ms/s, dev build: Task / Script / Layout / RecalcStyle | 341 / 205 / 6.7 / 8.7 | 424 / 245 / 11.6 / 8.8 |

75 commits/s = the radar clock on every displayed frame (`requestAnimationFrame`, 60 Hz headless)
plus positions at 15 Hz. Only the radar subtree renders; on a 144 Hz monitor the radar renders
~159 times per second, so every per-render cost below scales by ~2.1×.

In the browser preview the worst-case scenario stayed at the selected scale (`data-map-scale=0.7`):
the mock targets fit, so dynamic zoom never runs its bisection there. The Node benchmark (far targets)
covers the bisecting case.

### Production React (`OVERLAY_URL`, static mock build, 10 s)

Built for profiling only, never packaged: `research/build-mock-profile.mjs` calls Vite's `build()` with
`configFile: false, mode: "mock"` and `@vitejs/plugin-react` (`vite.config.ts` refuses to build the mock
mode on purpose); serve the output with `python3 -m http.server 1430 --bind 127.0.0.1 --directory <out>`.

| Main thread ms/s | Task | Script | Layout | RecalcStyle |
|---|---|---|---|---|
| default radar | 171 | 51 | 7.1 | 9.0 |
| dynamic zoom + heading-up + not centered (no bisection, see above) | 184 | 55 | 8.2 | 9.9 |

### Where the main thread goes (CDP CPU profile, dev server, default radar, 8 s)

| Self time | ms/s | Note |
|---|---|---|
| React dev runtime (`jsxDEV`, `ReactElement`, dev validation) | ~100 | absent from production builds |
| `src/platform/backdrop.ts` `measure` | 12–15 | rAF loop: `getComputedStyle` up every ancestor + `getBoundingClientRect` per registered panel per frame, also while nothing moves |
| `src/features/minimap/model.ts` | 3.3 | |
| `src/features/minimap/MinimapRadar.tsx` | 2.0 | |
| `src/mocks/minimapProvider.ts` | 1.4 | mock only |

### Minimap model cost (`bench-minimap.mjs`, 10 s simulated, 15 Hz positions + 60 Hz clock = 75 renders/s)

| Configuration | per render, layout 0 (70 rooms) | layout 1 (60 rooms) | CPU at 75 renders/s |
|---|---|---|---|
| default (centered, fixed, no dynamic zoom) | 42 µs | 45 µs | ~3 ms/s |
| heading-up, centered | 39 µs | 41 µs | ~3 ms/s |
| heading-up, not centered | 220 µs | 173 µs | 13–17 ms/s |
| dynamic zoom, centered | 284–372 µs | 286 µs | 21–28 ms/s |
| **dynamic zoom + heading-up + not centered** | **1.30 ms** | **1.59 ms** | **97–120 ms/s** |

| Micro (layout 0 / layout 1) | Value |
|---|---|
| `createRadarCamera` follow, not centered | 146 / 123 µs per call |
| `createRadarCamera` follow, centered | 0.8 µs per call |
| `createRadarCamera` overview | 72 / 63 µs per call |
| `dynamicZoomTarget` heading-up, not centered | 154 µs (selected scale fits) – 1125 µs (bisects) per call |
| `resolveMinimapSync` cold | 0.1–0.9 ms |
| rooms per map | layout 0: 70 (HCZ 49, Entrance 21); layout 1: 60 (HCZ 38, Entrance 22); 4 footprint points each |

Profile of the worst configuration: `rotatePoint` 61%, the non-centered clamp's spread `Math.min/max`
and array callbacks most of the rest (`camera.ts:49-60`). The overview branch rebuilds `farthest` from
every room corner on each call (`camera.ts:64-67`). `dynamicZoomTarget` (`dynamicZoom.ts:14-33`) calls
`createRadarCamera` up to 22 times, and both the reducer (`model.ts:287`) and `selectMinimap`
(`model.ts:400`) run it every render. In the centered dynamic-zoom case the cost is
`normalizeRadarPreferences` inside each of those `createRadarCamera` calls plus target projection.

### Production bundle (`VITE_CONTROL_PLANE_URL=https://control.example.invalid npx vite build`)

- `App-*.js` 199 KB (64 KB gzip), `index-*.js` 270 KB (84 KB gzip), `HomeApp-*.js` 27 KB.
- No mock strings (`map-demo-1`, `Holding the west checkpoint`, `createMockMinimapInit`, `HudDebugPanel`).
- `dist` 19 MB: fonts 13 MB (WOFF2 since #54), shop item PNGs 4.3 MB (31 files, up to 837×930;
  previews draw at 420×470 CSS px). Pillow estimate for the shop PNGs: lossless WebP 2.85 MB,
  WebP q90 0.87 MB.

## Not measured here

- GPU raster / composite cost of the 70 per-room `filter` groups (`MinimapRadar.tsx:46-50`) while the
  camera transform changes every frame, and of `backdrop-filter` in a transparent WebView2 window.
- Whether WebView2 keeps running `requestAnimationFrame` after Rust hides the overlay with
  `ShowWindow(SW_HIDE)` (`src-tauri/src/lib.rs:396-402`); the controller's `IsVisible` is never changed,
  so the radar clock and the backdrop loop may keep running while the overlay is hidden.
- Rust polling; estimated cheap.

## Environment note

`package-lock.json` resolves to `registry.npmmirror.com`, which this container's proxy refuses.
Install with the locked versions from npmjs instead (command at the top).
