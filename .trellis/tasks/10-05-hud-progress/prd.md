# CS2 generator progress card

Parent: `10-05-cs2-hud-panels` (R1, R3, R5; AC4, AC5). Depends on
`10-05-hud-data-channel`.

## Goal

Render the `progress` slot of `hud.messages` as CS2's defuse progress card
(`CSGOHudProgressBar`) for both generator start and shutdown (R3).

## Requirements

- P1 Card 500x120 centred, top at y ~630 on the 1080 canvas; bright side bars;
  left a ~95 px ring with the icon inside, right the plugin text with a
  `mm:ss.mmm` countdown under it (captures).
- P2 The ring fills by `1 - remaining/total`, and ring plus background wash
  move red, yellow, green over the progress (`circle-full-to-empty` in
  `hudprogressbar.css`). Driven by a CSS animation whose duration and negative
  delay are fixed from the interpolated values when the message (or a re-sync
  that changes the remaining time by more than 250 ms) arrives.
- P3 Icons (SLUI-drawn, no CS2 files): start
  (`SLGO_Progress_Generator_Start`) uses `KeycardNTFCommander.svg`; shutdown
  uses `wire-cutters.svg` when the viewer's `match.snapshot` loadout has the
  generator upgrade, otherwise `KeycardNTFCommander.svg` (CS2: defuse kit vs
  C4 icon). Icon pulse animation per CS2 (0.8 s).
- P4 Countdown text interpolated locally; at 0 the card waits for the clearing
  frame (it does not disappear on its own).
- P5 The card hides when the slot clears; CS2's finished zoom is not required
  (the plugin does not distinguish success from cancel).
- P6 If `10-05-hud-alerts` is already merged, add `hud-messages` to
  `OVERLAY_CLIENT_FEATURES`; otherwise leave it to that task.

## Acceptance Criteria

- [ ] Layout audit at 1920x1080 and 1600x900.
- [ ] Visual check against the two defuse captures (with/without kit) and a
      start-generator mock scene.
- [ ] Selector tests: progress interpolation, re-sync tolerance, icon choice,
      countdown formatting, clear.
- [ ] Live: start and shut down a generator with the overlay on; plugin
      progress Hint hidden only once `hud-messages` is declared (P6).
