# CS2 win panel with MVP

Parent: `10-05-cs2-hud-panels` (R1, R2, R4, R5; AC2, AC5). Depends on
`10-05-hud-data-channel` (protocol types and mock scenes) being merged first.

## Goal

Render CS2's `CSGOHudWinPanel` for SLGO round and match results from
`round.result`, and take over the plugin's win-panel Hint (`win-panel`).

## Requirements

- W1 Title box (400 wide, top at y 190 on the 1080 canvas): plugin title
  text, chevrons on both sides, side bars, subtitle line from `subtitle_text`
  (hidden when null).
- W2 Colours (R2): `won` and `observer` use the winner's `ROLE_COLORS` for
  title, bars, chevrons and a dark team-tinted fill; `lost` uses `#DB4437` for
  title/bars/chevrons and a neutral dark grey fill; `draw` uses neutral
  white/grey. SCP win vs loss are told apart by text and fill only (user
  decision 2026-10-05).
- W3 MVP strip (only when `mvp` is non-null): wider than the title box, fading
  at both ends, animated checker background in the winner colour; square
  avatar (from the latest `match.snapshot` `avatar_url`, side fallback as in
  the HUD), team-coloured label chip with `reason_text`, player name on its own
  line, music-kit row (SLUI-drawn note icon + name) only when
  `music_kit_name` is non-null.
- W4 Lifetime: appears on a new `result_id`, hides on `panel: null` or when
  the interpolated `visible_remaining_ms` reaches 0; CS2 enter/exit
  transitions; a replayed snapshot of the same `result_id` never re-animates.
- W5 Match end (`is_match_end`) uses the same panel with the plugin's title;
  CS2's full-screen end-of-match screen is out of scope.
- W6 Declare `win-panel` in `OVERLAY_CLIENT_FEATURES`.

## Acceptance Criteria

- [ ] Layout audit at 1920x1080 and one smaller 16:9 size: title box
      x 760-1160 / y 190-270, MVP strip y ~287-375, avatar ~72 px, no generated
      nodes or raw keys.
- [ ] Visual check of mock scenes against the local captures: win + most-kills
      MVP, ace MVP, win without MVP, lost, and the derived states (draw,
      observer, match end, NTF and SCP colour variants).
- [ ] Selector tests: appear/hide, replay without re-animation, local expiry,
      instance change clears.
- [ ] Live: plugin win-panel Hint hidden while SLUI shows the panel; restored
      when the overlay is disabled.
