# Implement: backdrop core and scoreboard blur

Design: `../10-21-backdrop-blur/design.md`. Branch: `feat/backdrop-blur`.

## Steps

1. **Rust module** `src-tauri/src/backdrop.rs` (Windows; stub elsewhere)
   - Port the accent call, window class and corner/border attributes from the spike
     (`spike/backdrop-blur:spikes/backdrop-blur/src/blur.rs`), trimmed to BLURBEHIND.
   - Pool + layers + region → physical rect mapping; placement under the overlay HWND.
   - Availability: registry `EnableTransparency`, energy saver, SWCA resolvable.
   - Unit tests for the CSS → physical mapping, clamping and pool sizing (pure functions).
2. **Wiring in `lib.rs`**
   - Register the commands and manage the backdrop state before the windows are built (same rule
     as the updater fix in #45).
   - Call into the module from `align_overlay_to`, `apply_overlay_input_mode`,
     `sync_overlay_visibility`, `hide_overlay_window`; availability poll on the foreground thread.
3. **Frontend platform**
   - `src/platform/backdrop.ts`: registry, rAF loop, diffing (pure function, unit-tested), Tauri and
     browser implementations (browser: no-op).
   - `data-world-blur` on the overlay root from availability × settings.
   - Settings fields + normalisation tests; home system settings controls (switch + 1-3 strength).
4. **Mock stand-in**: `backdrop-filter: blur(30px)` layer for registered panels in `dev:mock`.
5. **Scoreboard**: register the panel; blur-on/blur-off fills; update the CSS comment.
6. **Checks**: `npm test`, `npm run build`, `npm run tauri:check`,
   `cargo clippy --manifest-path src-tauri/Cargo.toml`; trellis-check pass.
7. **In-game test with the user** (debug build via `npm run tauri dev`): the core PRD's
   acceptance list, PresentMon/FPS numbers into this task's notes.
8. **Spec update** (system-boundaries, cs2-visual-replication), memory note, commit, PR (visual:
   wait for the user's review before merge).

## Review gates

- After step 2: overlay behaviour unchanged with the setting off (shop, chat, cursor mode,
  Alt+Tab) before any panel registers.
- After step 5: mock screenshot of the scoreboard with the stand-in, then the in-game test.

## Rollback points

- Each step is a separate commit on the branch; the setting default can be flipped to off without
  removing code.
