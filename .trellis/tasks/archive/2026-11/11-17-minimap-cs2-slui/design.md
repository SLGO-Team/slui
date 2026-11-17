# Design: 小地图 CS2 对齐（SLUI 侧）

Scope: `src/features/minimap/*`, `src/App.tsx` (one prop), mocks, smoke/audit scripts, `minimap.md`.
No protocol, plugin or backend change.

## 1. Icon scale (R1)

- `camera.ts` gains `radarIconScale(mapScale: number): number` =
  `ICON_SCALE_MIN + (1.25 - ICON_SCALE_MIN) * clamp(mapScale, 0, 1)` with `ICON_SCALE_MIN = 0.6`.
- The "current scale" in mapScale units:
  - follow camera: `activeMapScale` (already the dynamic / alternate / base scale in use);
  - overview camera: the equivalent mapScale of its pixel scale, `camera.scale * RADAR_NORMAL_WORLD_RADIUS * 0.70 / RADAR_RADIUS`
    (the inverse of the follow-camera formula), so a full map reads as zoomed out like CS2's.
- `selectMinimap` exposes `iconScale` on the view model. `MinimapRadar` sets `--radar-icon-scale` on
  `.minimap-radar__markers`; `.minimap-marker` gets `transform: scale(var(--radar-icon-scale))`. A marker is a 0x0 box
  at the marker point, so `transform-origin: 0 0` scales every child about the marker point; positions (left/top) are
  unaffected, so edge clamping stays in unscaled radar pixels like CS2 (it clamps the panel position, then scales the icon).
- Base sizes in CSS become CS2 native panorama sizes (OnMap 11, EnemyOnMap 13, OffMap 22, Death 19, Ghost 9x15,
  ViewFrustrum 128x64 with its y offset -12). Heading tip and its offsets are divided by the old 0.73 factor so its ratio
  to the dot is unchanged. The comments that justify the old "~0.73" calibration are replaced by the formula.
- Keycard, rings and bombsites keep their current sizes unless implement step 1 finds CS2 scaling them.

## 2. Zones as one level (R2)

Delete the `data-active` dim rule. `MapRooms` keeps `data-active` only if a test still needs it; otherwise remove the
attribute and the `activeZone` prop (it then no longer re-renders on zone change).

## 3. Dynamic zoom (R3)

`dynamicZoom.ts` is rewritten around a smoothed distance; the reducer/selector wiring keeps its shape.

```ts
export type DynamicZoomState = { identity: string; distance: number; shrinkAtMs: number | null; updatedAtMs: number };
export const DYNAMIC_ZOOM_HOLD_MS = 4000;            // CS2 4.0 s
export const DYNAMIC_ZOOM_SHRINK_M_PER_S = 520 * 0.0254; // 13.208 m/s, CS2 520 units/s
export const DYNAMIC_ZOOM_FILL = 0.95;               // farthest element at 95 % of the radius

dynamicZoomDistance(viewpoint, points: WorldPoint[]): number           // max hypot(dx, dz), 0 when empty
advanceDynamicZoom(previous, { identity, target, nowMs }): DynamicZoomState
dynamicZoomScale(distance, viewSize, selectedScale): number
  // pxPerMeter(mapScale) = RADAR_RADIUS * mapScale / (45 * 0.70); solve distance * pxPerMeter = 0.95 * viewSize / 2
  // distance 0 -> selectedScale; clamp [0.25, selectedScale]
```

- `advanceDynamicZoom`: new identity or `nowMs < updatedAtMs` -> `{ distance: target, shrinkAtMs: null }`.
  `target >= distance` -> `{ distance: target, shrinkAtMs: null }`. Else `shrinkAtMs ??= nowMs + 4000`; while
  `nowMs < shrinkAtMs` hold; after it, `distance = max(target, distance - 13.208 * elapsed)` where `elapsed` is the time
  since `max(updatedAtMs, shrinkAtMs)` (so the first shrinking step starts exactly at the hold's end, like the existing
  recovery). CS2 clamps per frame by `ft`; integrating over elapsed time is the same rate without depending on frame
  rate. The CS2 timer does not restart while the target keeps shrinking; it is cleared only by `target >= distance`.
- Points (`radarContext`): live interpolated positions + `fading` positions + the keycard item when its opacity is not
  null. The followed viewpoint itself contributes 0. No zone filter.
- `selectMinimap` uses `state.dynamicZoom.distance` when its identity matches, else the instantaneous target distance,
  then `dynamicZoomScale`. The current `Math.min(target, state)` combination is dropped: expansion is already instant
  in the state and the selector only needs the instantaneous target when the reducer has not run for this identity.
- The `targets` string identity (used for the old 2 s recovery) is removed; the binary-search fit and the 22-camera
  cost note in `minimap.md` go with it.
- Square radar: CS2 uses the half size with no corner logic; we use `viewSize / 2` (125 or 145).

## 4. Keycard (R4)

- The view model gains `observer: boolean` (viewer has no team). Pack wash, CS2 `CreateBombPack` order: hostile -> enemy
  red; observer -> new `ColorWash` `${id}-observer` = `#ff9b25`, both on the ground item and on a carrier's dot (CS2 keeps
  the default orange whenever the viewer is on neither side); own side -> carrier slot colour while carried, none
  (white) on the ground, as today.
- Planted: render both `.minimap-keycard-drop__pulse--dropped` (80px #880000) and `--planted` (51px #D10000).
- Planted icon gets class `minimap-keycard-drop__icon--planted` with a `@keyframes` on `filter: drop-shadow(...)` using
  the PlantedBombAnimateRed stops. The drop-shadow list keeps the existing black outline after the red one; the wash var
  stays first with its empty fallback (spec rule: never `none drop-shadow`).

## 5. Border pulse (R5)

- `MinimapRadar` / `LiveMinimapRadar` take `generatorActive?: boolean`; App passes
  `hud.clockMode === "generator"` (already computed for the HUD clock; no new subscription). It is HUD knowledge every
  player has, matching CS2 where the planted state comes from game rules, not radar visibility.
- `.minimap-radar[data-generator-active="true"][data-shape="circle"] .minimap-radar__border` gets
  `border-color: #ff0000` and `animation: minimap-plant-pulse 0.65s linear infinite` (opacity stops 0.1/0.6/0.8/0.6/0.1).
  CS2's border also has `hud-colorize-wash`, which would multiply red by the HUD colour; the wash is not applied (red
  over the team colour stays red for every SLGO team colour with a high red channel; record in spec).

## 6. Square border, label, fade-in, status text (R6-R9)

- R6: `.minimap-radar[data-shape="square"] .minimap-radar__border { display: none; }`.
- R7: `.minimap-radar__location` 22px, weight 500 (Stratum2 medium; the font stack is unchanged), colour
  `var(--radar-accent)`, width 300px, line box adjusted so the 300px panel + label keep their current top. Final pixel
  values come from the screenshot comparison in implement step 6.
- R8: `.minimap-radar { animation: minimap-radar-in 0.1s linear both; }` (mount happens on connect).
- R9: remove `statusLabel`, `STATUS_LABELS`, `zoneLabel`, `showStatus`, the status/empty elements and their CSS.
  `data-availability` stays. Mock/provider/audit checks that read the status text switch to `data-availability`.

## 7. Compatibility and rollback

- Settings: no new preference; saved files are unchanged (A4 is out of scope).
- The radar is purely presentational; each requirement is an isolated commit-sized change, so a regression is
  reverted per commit. No wire/schema change, so mixed plugin/backend versions are unaffected.
