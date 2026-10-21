# World blur under shaped and small HUD panels

Parent: `10-21-backdrop-blur`. Starts after `10-21-backdrop-core` has merged.

## Goal

The non-rectangular or many-small HUD panels that CS2 draws on `hudWorldBlur` blur the game in
SLUI.

## Panels

- Bottom HUD centre circle (`.hud-HA-center`) and kill cards (`.kill-flag-bg-blur`).
- Radar viewport, round and square (`#Radar__Round--Inner`, `#Radar__Square--Inner`); no blur
  while scoped, as in CS2. Replaces the current `backdrop-filter` on the radar viewport, which can
  only blur the page.
- Team counter equipment backgrounds (`.equipinfo__blurbg`); replaces the current page-only
  `backdrop-filter: blur(3px)`.

## Requirements

- First step: check whether a backdrop can be clipped to a circle (per-pixel-alpha layered window,
  `DwmEnableBlurBehindWindow` region). Record the result in `research/`. If neither works, ask the
  user how the circle and the round radar should look before building them.
- Region count stays within the core's limit with ten players' equipment boxes and the kill cards.
- Blur-on fills from Panorama; blur-off keeps today's fills.

## Acceptance criteria

- [ ] Each panel blurs the game in SCP:SL with the right shape and follows its animation.
- [ ] Blur off / unavailable → today's look, unchanged.
- [ ] No FPS drop with all regions shown at once (scoreboard closed, full HUD).
- [ ] User approves the in-game look.
