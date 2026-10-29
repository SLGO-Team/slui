# Implementation plan

1. `src/features/shop/diagnostics.ts` (pure): close reasons, shop key input text (with snapshot age and
   availability), command target text. Smoke-tested in `scripts/shop-model-smoke.mjs`.
2. `ShopPanel`: `onClose(reason)` (escape / button / blur); `onDiagnostic` for shown, hidden, focus, blur.
3. `App.tsx`: one `closeShopFor(reason)` that logs only when open; replace the `setShopOpen(false)` close
   sites; shop key line gets age and availability; input-queue outcome lines; command sent / result /
   no-result lines; session detail line.
4. `main.tsx` + `src/platform/pageErrors.ts`: window `error` / `unhandledrejection` and React root
   `onUncaughtError` / `onCaughtError` to `log_overlay_event` with the window label, capped.
5. `src-tauri/src/lib.rs`: foreground-left line (exe file name + class); per-key last-event-was-down
   tracking and `repeat_is_anomalous(last_was_down, gap_ms)` with unit tests.
6. Spec `system-boundaries.md` diagnostics paragraph.

Validation: `npm run lint`, `npm test`, `cargo test --workspace --manifest-path src-tauri/Cargo.toml`,
`cargo clippy --workspace --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings`.
