# Implement: perf-hidden-pause

1. Rust `src-tauri/src/lib.rs`: `OverlayVisibility` state + `publish_overlay_visibility` + `get_overlay_visibility` command (register in the
   invoke handler and `manage`); call it from `apply_overlay_input_mode`, `hide_overlay_window`, and the non-Windows branch of `apply_overlay_enabled`.
2. Page `src/platform/overlayVisibility.ts` (native source, shared store, `useOverlayVisible`).
3. `src/features/minimap/useMinimapView` gating; `src/platform/backdrop.ts` pause / resume.
4. `scripts/overlay-visibility-smoke.mjs` (native source race, revisions, fail open, browser default) and add it to `npm test`.
5. Checks: `npm run lint`, `npm test`, `npm run build:local`, `npm run minimap-visual-audit`;
   `cargo clippy --workspace --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --workspace --manifest-path src-tauri/Cargo.toml`.
6. Windows check with the dev app (mock mode, remote debugging): hidden → camera writes / backdrop ticks 0; native show → resume; CPU before / after.
7. Spec: `system-boundaries.md` 3.1 (event, pause rule, why not `IsVisible`).
