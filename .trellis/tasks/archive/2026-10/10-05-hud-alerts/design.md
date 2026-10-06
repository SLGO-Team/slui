# Design: alerts and hints

- Shared reducer for `hud.messages` in `src/features/hudmessages/model.ts`
  (created by whichever of alerts/progress starts first; the other reuses it):
  latest frame + `receivedAtMs`, per-slot "first seen" bookkeeping
  (`slotKey`, `appearedAtMs`) so animations restart only on key change.
- Selector `selectMessageZone(state, nowMs)` returns `{ alert, hintHigh,
  hintLow }` view models with formatted text (`{time_remaining}` to `m:ss`).
- `MessageZone.tsx` + `MessageZone.css`; class names follow Panorama
  (`HudAlerts`, `HudHintText--high/--low`). Geometry from `hudalerts.css`,
  `hudhinttext.css` and `hud.css` `.HudBottomCenter--float`, checked against
  the captures (the capture wins).
- Flash: CSS keyframe keyed by `appearedAtMs` (React `key`), so re-renders on
  the 250 ms clock never restart it.
