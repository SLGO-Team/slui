# Implement: backdrop core and scoreboard blur

Design: `../10-21-backdrop-blur/design.md` (revised 2026-10-21, own blur). Branch:
`feat/backdrop-blur`. The first implementation (DWM accent windows, commits fd16504, bae7e51) keeps
its page side; the Rust engine is replaced.

## Steps

1. **Rust engine** `src-tauri/src/backdrop.rs` (Windows; stub elsewhere), ported from the spike's
   `wgc` mode (`spike/backdrop-blur:spikes/backdrop-blur/src/wgc.rs`):
   - device + shaders + blur window + DirectComposition swap chain at startup (main thread);
   - capture session per game HWND, lazy start, 5 s idle stop;
   - per-frame multi-region blur with rounded-rect mask and opacity, premultiplied output;
   - pure, unit-tested helpers: CSS → blur-window → capture rects, margin clamping, σ per strength
     and height, region sanitising.
2. **Wiring in `lib.rs`**: commands, game HWND from the foreground thread, refresh from the overlay
   visibility/alignment paths, idle tick.
3. **Frontend**: region radius from CSS, `strength` option, settings rename
   (`worldBlurStrength`), mock stand-in σ, scoreboard fill 0.6.
4. **Checks**: `npm test`, `npm run lint`, `npm run build` (placeholder control-plane URL),
   `cargo clippy --all-targets`, `cargo test`, `cargo hakari generate`.
5. **In-game test with the user**: look, smoothness (`measure`), same-spot FPS A/B, Alt+Tab,
   switch/strength, shop mask.
6. **Spec update** (system-boundaries, cs2-visual-replication), memory, commit, PR (visual: wait
   for the user's review before merge).
