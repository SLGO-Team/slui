# CS2 bottom-centre alerts and hints

Parent: `10-05-cs2-hud-panels` (R1, R5; AC3, AC5). Depends on
`10-05-hud-data-channel`.

## Goal

Render the `alert`, `hint_high` and `hint_low` slots of `hud.messages` as
CS2's `CSGOHudAlerts` and `CSGOHudHintText` (high/low).

## Requirements

- A1 Positions on the 1080 canvas (captures): all boxes 300 wide centred
  (x 810-1110); alert y ~750-790; high hint y ~803-860 (grows for two lines);
  low hint y ~868-907. Slots are fixed, not stacked; any combination can be
  visible at once.
- A2 Alert: dark translucent box, thin gold side bars (CS2 default HUD
  colour), centred white 18 px text; a slot that goes from empty to showing
  plays CS2's enter (opens from the centre under white, glitch). Recording
  (2026-10-06): a replacement in a showing slot swaps the text in place without
  animation, so neither a new key nor a countdown rewrite re-runs it; match
  point / final round play CS2's `FlashAnim` (restarted on a key change).
- A3 High hint: red left bar, white text, wraps to two lines.
- A4 Low hint: gold side bars like the alert, white text.
- A5 `{time_remaining}` renders as `m:ss` from the interpolated
  `countdown_remaining_ms`, ticking locally every second.
- A6 Messages with `visible_remaining_ms` hide locally when it runs out even
  if the clearing frame is late.
- A7 Tones: text stays white as in every capture; tones are carried for
  future use (no colour mapping in this task).
- A8 If `10-05-hud-progress` is already merged, add `hud-messages` to
  `OVERLAY_CLIENT_FEATURES`; otherwise leave it to that task.

## Acceptance Criteria

- [ ] Layout audit at 1920x1080 and 1600x900 for each slot alone and all
      three together.
- [ ] Visual check against the captures: match point, final round, paused,
      timeout countdown, paused + high hint, low hints, two-line bomb-planted
      high hint, flash frame.
- [ ] Selector tests: replacement, expiry, countdown formatting, flash only on
      key change, instance change clears.
- [ ] Live: plugin message-zone Hint hidden only once `hud-messages` is
      declared (A8).
