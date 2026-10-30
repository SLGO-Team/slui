# Implement: elevated game and exclusive fullscreen

## Checklist (in order)

1. Rust diagnostics (R7): `release_keyboard_focus` outcome lines; exit-reason lines (tray quit, relaunch).
2. Rust detection (R1, R2): `DisplayModeLatch` (pure, with unit tests from the probe sequences), sampling in the
   foreground thread, game-window minimized/restored logging, `GameConditions` state + event + `get_game_conditions`,
   reset on game exit / new process.
3. Rust relaunch (R5): `relaunch_elevated` command, `--after-pid` parse (unit-tested) and wait before the
   single-instance plugin.
4. Page platform: `gameConditions.ts` source (listen-then-query, revision, shape check) + smoke in
   `scripts/game-foreground-smoke.mjs` or a new smoke added to `npm test`.
5. Overlay hand-back (R3): `claimedFeatures` helper + smoke; App wiring (features, closes, shortcuts, interactive).
6. In-game hint (R6): notice composition into `hint_high`, once per condition per run; smoke for the composition.
7. Home banners (R4): `gameConditionBanners` model + smoke; banner component with the relaunch action.
8. Live test on this PC: exclusive vs borderless SL (AC1, AC2, AC5, AC6); elevated case by starting SL from an
   elevated shell (AC3, AC4).

## Validation

```bash
npm test
npm run lint
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings   # match ci.yml exactly
cargo test --workspace --manifest-path src-tauri/Cargo.toml                       # match ci.yml exactly
```

Check `.github/workflows/ci.yml` for the exact clippy/test invocations before pushing.

## Risky points / rollback

- `run()` start order: the `--after-pid` wait must run before `tauri_plugin_single_instance::init` is registered.
- `overlayInteractive` and the shortcut handler in `src/App.tsx`: keep the existing shop/chat/team logic intact when
  not blocked.
- Visual PR: wait for the user's visual review (home banners, in-game hint) before merge; no auto-merge until then.
