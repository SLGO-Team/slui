# Backdrop core and scoreboard blur

Parent: `10-21-backdrop-blur` (read its `prd.md` and `design.md` first).

## Goal

The native backdrop module, the region contract, settings and fallback, and the mock stand-in,
proven end to end on the scoreboard.

## Requirements

- `src-tauri/src/backdrop.rs` as in the parent design (revised 2026-10-21): game-window capture,
  GPU blur, one click-through DirectComposition blur window under the overlay, coordinates,
  visibility tied to the overlay, availability and event.
- Commands `set_backdrop_regions`, `set_backdrop_options`, `get_backdrop_available`; event
  `slgo-backdrop-available`.
- `src/platform/backdrop.ts` region registry with `useBackdropRegion`, send-on-change.
- `data-world-blur` root attribute; settings `overlay.worldBlur` (default on) and
  `overlay.worldBlurStrength` (default 1) with controls in the home window's system settings.
- Mock stand-in for the native blur.
- Scoreboard registers its panel (its 5 px radius is read from CSS) and uses
  `rgba(0,0,0,0.6)` with the blur on, `rgba(14,16,19,0.84)` with it off. Cursor mode and both
  pages keep working.
- Shop mask registers a full-window region; its page `backdrop-filter` stays for
  the HUD panels under it. Veil tuned with the user in game.

## Acceptance criteria

- [ ] Holding CapsLock in SCP:SL shows the scoreboard on a live blur; release hides both together.
- [ ] Alt+Tab, overlay disable, and windowed-mode moves behave as in the parent PRD.
- [ ] Turning the camera with the scoreboard held is smooth (measure: blur updates ≈ game frames).
- [ ] Strength setting 1-3 changes the blur live; switch off restores today's look.
- [ ] Same-spot FPS A/B (blur on/off) recorded in the task notes.
- [ ] `npm test`, `npm run build`, `npm run tauri:check`, clippy clean; unit tests for the region
      diffing and the settings normalisation.
- [ ] Spec: system-boundaries (backdrop windows, command, event), cs2-visual-replication (blur-on
      and blur-off fills, mock stand-in rule).
- [ ] User approves the in-game look (visual PR waits for review).
