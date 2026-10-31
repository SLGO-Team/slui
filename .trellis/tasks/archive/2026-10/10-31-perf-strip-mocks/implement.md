# Implement: strip mocks / lazy template

Dependencies: install with `npm ci --registry=https://registry.npmjs.org --replace-registry-host=always`
in this container (see parent `research/perf-baseline.md`).

## Checklist

1. **Baseline capture** (before any edit)
   - `VITE_CONTROL_PLANE_URL=https://control.example.invalid npx vite build --outDir /tmp/…/dist-before`;
     record chunk list and sizes, grep results for `map-demo-1`, `Holding the west checkpoint`,
     `HczCheckpointToEntranceZone`.
   - Start `npm run dev:mock`; try `MINIMAP_BROWSER_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npm run minimap-visual-audit`
     and the HUD/chat audits; record pass/fail as the baseline for this environment.
2. **Lazy template** (rollback point A — own commit)
   - Add `src/features/minimap/mapGeometry.ts`; move types, `mapDescriptorKey`, `assertSupportedMap`; add async `resolveMinimap`.
   - `resolver.ts`: import from and `export *` the new module; keep `resolveMinimapSync` and cache.
   - Switch `model.ts`, `useMinimapFeature.ts` value imports.
   - Verify: `npm run lint`, `npm test`, `dev:mock` radar reaches `live`.
3. **Harness** (rollback point B — own commit)
   - Add `RadarOverlayOptions` + `DEFAULT_RADAR_OVERLAY_OPTIONS` to `preferences.ts`.
   - Add `src/mocks/overlayHarness.ts`.
   - `main.tsx`: mock-mode dynamic import, pass `harness` to the overlay root.
   - `App.tsx`: remove value imports from `./mocks/*`; thread `harness`/`debug` per design table;
     gate debug memos; render debug panels from `debug`.
   - Verify: `npm run lint`; `dev:mock` with default URL, `?hudDebug=0&shopDebug=0`, `?shopOpen=1`,
     `minimap*` params; `window.__SLUI_MINIMAP_DEBUG__` present; home window (`?window=home`) loads.
4. **Bundle verification**
   - Rebuild production as in step 1; confirm acceptance criteria (no mock strings/top-level mock
     init in entry + static chunks; template only in a lazy chunk; `App-*.js` ≤ 251 KB).
   - Check the lazy chunk is referenced only through a dynamic import (Vite `__vitePreload`).
5. **Regression**
   - `npm test`, `npm run build:local`, audits from step 1 (same environment, compare with baseline).
   - Re-run parent `research/profile-overlay.cjs` to confirm the mock overlay still renders and commits as before.
6. **Spec update** (Phase 3)
   - `quality-guidelines.md`: mock harness rule (R1/R2).
   - `minimap.md`: `mapGeometry.ts` light module + lazy `resolveMinimap`; Node test path note still holds for `resolver.ts`.

## Validation commands

```bash
npm run lint
npm test
npm run build:local
VITE_CONTROL_PLANE_URL=https://control.example.invalid npx vite build --outDir <scratch>/dist-after
grep -l "map-demo-1\|Holding the west checkpoint" <scratch>/dist-after/assets/*.js   # expect none
grep -l "HczCheckpointToEntranceZone" <scratch>/dist-after/assets/*.js               # expect one lazy chunk
```

## Risky files

- `src/App.tsx` (many debug branches; keep each change mechanical, one use site at a time).
- `src/main.tsx` (root selection; home window must not change).
