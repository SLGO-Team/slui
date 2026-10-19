# SLUI 16:10 and 4:3 aspect ratio support

## Goal

Overlay panels follow CS2 Panorama's height-based scaling so 16:10 and 4:3 screens lay out like the game.

## Background

Every overlay panel draws on a 1920x1080 design canvas scaled by `min(width / 1920, height / 1080)` and
pinned to the top centre. On a screen narrower than 16:9 the scale is width-limited, so the canvas does not
reach the bottom: at 1920x1200 the bottom 120 px stay empty and the bottom HUD, alerts, progress card
float above where the game draws them.

Panorama lays the HUD out in a space that is always 1080 units tall and `1080 * (width / height)` units
wide, with one uniform scale `height / 1080` (CS2 `endofmatch-characters.js` centres a 1440 band with
`1080 * (w / h) * 0.5 - 720`; scripts use `actualuiscale_x` and `_y` interchangeably). HUD styles carry no
aspect-ratio-specific rules; panels keep their place through their horizontal anchors (left, right,
centre).

## Requirements

- On viewports narrower than 16:9 (16:10, 4:3, 5:4) every overlay panel uses scale `height / 1080` and a
  design canvas `1080 * aspect` units wide, centred.
- Each panel keeps its Panorama horizontal anchor on that canvas: radar and chat to the left, killfeed to
  the right, team counter, bottom HUD, alerts / hints, progress card, win panel and buy menu centred.
- 16:9 viewports are unchanged (same scale, same canvas, pixel-identical output).
- Viewports wider than 16:9 keep today's behaviour (scale `height / 1080`, 1920-wide canvas centred).
- Non-positive viewport dimensions keep the stable scale of 1.

## Acceptance Criteria

- [x] At 1920x1200 (16:10) the bottom HUD sits 16 design px above the screen's bottom edge, scaled by
      1200/1080, horizontally centred; killfeed hugs the right edge, radar the left.
- [x] At 1440x1080 / 1024x768 (4:3) the same holds with a 1440-wide canvas; the buy menu is centred as in
      Panorama (its 1348-wide content row plus the -50 px shift may clip ~4 design px on the left, as in game).
- [x] At 1920x1080 and 1280x720 the overlay matches the current build.
- [x] `npm run lint` and `npm test` pass.
- [x] The frontend spec's viewport contract describes the new rule.

## Out of scope

- Ultrawide (21:9) layouts that spread to the screen edges.
- CS2's `safezonex` / `safezoney` HUD edge settings.
- Team counters with more players than fit in the narrower half-width (existing overflow behaviour).
