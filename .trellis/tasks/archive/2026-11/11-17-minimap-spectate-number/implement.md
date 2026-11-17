# Implement: spectate selection box and observer numbers

Branch `feat/minimap-spectate-number` from main 54d14f0. PR title
`feat(minimap): CS2 spectate selection box and observer player numbers`. Visual PR: wait for the user's review.

1. Asset: draw `public/assets/minimap/selected.svg` (white teardrop ring + forward glow, see design.md); add a row
   to `public/assets/minimap/SOURCE-MAP.md`.
2. Model: `RadarMarker.selected` in `camera.ts` / `model.ts` `decorate`; `radarMarkerNumber` helper.
3. HUD presentation: `playerObserverNumbers(teams)`.
4. Rendering: `PlayerMarker` selection span + number label; `MinimapRadar` / `LiveMinimapRadar` `playerNumbers`
   prop; `App` wiring; CSS for `__selected` and `__number`.
5. Mock: `minimapViewer=observer` preview option (fixtures + provider change detection).
6. Tests: `scripts/minimap-model-smoke.mjs` (selection conditions: alive self, dead following teammate, observer
   following, free viewpoint, edge, dead marker; number gating), `scripts/hud-model-smoke.mjs`
   (`playerObserverNumbers`: 5v5, 6+5, 7+7 cap and the 0), visual audit assertions in
   `scripts/minimap-visual-audit.mjs`.
7. Spec: `.trellis/spec/frontend/minimap.md` marker rules (selection, numbers).

## Validation

- `npm run build` (tsc + vite), `npm test`, `npm run lint` if present.
- `npm run minimap-visual-audit` against the mock dev server on 1420 (Edge via `MINIMAP_BROWSER_PATH` if needed).
- Screenshots of dead-spectate and observer captures for the user's visual review.
- No Rust change, so no clippy run.

## Rollback

Revert the PR; no data or protocol migration.
