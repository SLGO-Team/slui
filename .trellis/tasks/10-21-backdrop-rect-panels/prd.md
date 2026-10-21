# World blur under rectangular HUD panels

Parent: `10-21-backdrop-blur`. Starts after `10-21-backdrop-core` has merged.

## Goal

The rectangular HUD panels that CS2 draws on `hudWorldBlur` blur the game in SLUI.

## Panels

- Message zone alerts (`CSGOHudAlerts`) and hints (`.hud-hint.low-priority/.high-priority`).
- Progress card (`.hud-progress-bar`).
- Killfeed rows (`.DeathNoticeBG`, plain / victim / killer), one region per visible row, following
  their slide and fade.
- Win panel result (`.WinPanel__Result`).

## Requirements

- Each panel registers through `useBackdropRegion` with its CS2 corner (3 px boxes → `small`).
- Blur-on fills from Panorama (`hud-blur-bg-color` `#000000a0` and the per-state colours), checked
  against the existing captures; blur-off keeps today's dense fills.
- Replace the "overlay cannot blur" comments in these panels' CSS with the blur-on/blur-off note.

## Acceptance criteria

- [ ] Each panel blurs the game in SCP:SL and follows its animation without a visible lag or
      leftover backdrop.
- [ ] Blur off / unavailable → today's look, unchanged.
- [ ] Mock captures with the stand-in reviewed against the CS2 recordings.
- [ ] User approves the in-game look.
