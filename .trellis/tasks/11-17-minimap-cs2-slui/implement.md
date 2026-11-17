# Implement: 小地图 CS2 对齐（SLUI 侧）

Branch `feat/minimap-cs2-parity` (created 11-17 from main; the parent/children planning artifacts are on it).
Run `trellis-before-dev` for the frontend layer first. Check after every step: `npm test` (fast fail) and the step's own
check; Rust is untouched, so clippy is not needed.

## Steps

1. **Research closure (no code).** In `client.dll` check whether `RI_BombDefuserPackage` / BombZone positioning
   (`0x180e9ddc0` and the bomb function) multiplies by the icon scale; append the answer to
   `research/cs2-radar-client-re.md` and settle R1's keycard / ring / bombsite sizes. Also extract frames around the
   plant (`D:/Media/Videos/NVIDIA/Counter-strike 2/2026.10.05 - 22.45.00.03.mp4`, 120-130 s) to confirm both rings and
   the red border pulse on a planted bomb; note the result. Media stays local (public repo).
2. **R9 status text removal.** Model (`STATUS_LABELS`, `statusLabel`, `zoneLabel`), component, CSS, provider/mock and
   smoke/audit expectations move to `data-availability`. Check: `npm test`, grep for the removed names.
3. **R2 + R6 + R8.** Remove zone dim, square border, add 0.1 s mount fade. Check: visual audit updated (square has no
   border pixels; both zones equal; first frames fade).
4. **R3 dynamic zoom.** Rewrite `dynamicZoom.ts`, wire `radarContext` / `minimapReducer` / `selectMinimap`.
   Replace the old dynamic-zoom cases in `scripts/minimap-model-smoke.mjs` (immediate expand, 4 s hold, 13.208 m/s shrink,
   95 % fill, clamps, no zone filter, fading + keycard included, identity reset); remove the bit-exact
   `dynamicZoomTarget` comparison that only existed for the binary search, keep the camera comparison.
   Update the mock `dynamicTargets` fixture if it relied on zone filtering.
5. **R1 icon scale.** `radarIconScale`, overview-equivalent scale, `iconScale` in the view model, CSS variable and
   native base sizes. Model tests for the formula at 0.25 / 0.7 / 1 and overview; audit measures a marker's box at two
   scales.
6. **R4 + R5 keycard and border.** Observer wash, double ring, red glow keyframes, `generatorActive` prop from App,
   border pulse. Mock: `?minimapKeycard=planted` turns on the generator clock in the HUD mock (or a preview flag) so the
   border pulses; observer preview via the existing team-less viewer fixture.
7. **R7 label.** Compare with a Steam screenshot (`.../760/remote/730/screenshots/20261005*.jpg`) at matched scale;
   set size/colour; record the screenshot name in this file's notes.
8. **Spec + checks.** Update `.trellis/spec/frontend/minimap.md` (icon scale, dynamic zoom rules and costs, zones as one
   level, keycard colours/rings/glow, border pulse, square border, label, removed status text; delete the obsolete
   "constants are SLUI behavior" sentence). Then `npm test`, `npm run lint`, `npm run build:local`, mock server +
   `npm run minimap-visual-audit`; capture before/after 1920x1080 crops for the user.

## Review gates

- After step 4: dynamic zoom behaviour reviewed in mock with `dynamicTargets=near|far` before styling work.
- Before PR: user looks at the mock captures (visual PR, waits for review per merge rule).

## Rollback points

Each step is its own commit on the branch; revert the step's commit. No settings or wire format change.

## Notes

- (filled during implementation: screenshot used for R7, research step 1 answers)
