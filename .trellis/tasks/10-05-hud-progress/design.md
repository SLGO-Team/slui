# Design: progress card

- Reuses the shared `src/features/hudmessages/model.ts` reducer (see
  `10-05-hud-alerts/design.md`; created here if this task starts first).
- Selector `selectProgressCard(state, nowMs, viewerLoadout)` returns
  `{ messageId, text, icon, remainingMs, totalMs, animationKey }`;
  `animationKey` changes on a new message or a re-sync off by more than
  250 ms, and keys the CSS animation.
- `ProgressCard.tsx` + `ProgressCard.css`, class names after Panorama
  (`hud-progress-bar`, `-circle`, `-circle-animator`). Ring = SVG circle with
  `stroke-dashoffset` keyframes; colour keyframes red/yellow/green at 0/50/100%.
- Viewer loadout comes from the HUD model's viewer player
  (`has_generator_upgrade` in the `match.snapshot` loadout).
