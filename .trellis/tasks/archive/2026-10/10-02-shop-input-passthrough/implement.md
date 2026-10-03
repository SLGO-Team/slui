# Implement plan

1. [x] Phase-0 spikes (capture, key forwarding) run and removed; results in `research/`.
2. [x] Temporary diagnostics, marked `DIAG(10-02-shop-input-passthrough)`:
   - `src-tauri/src/lib.rs` keyboard hook: every shop-hotkey down/up with the
     `GetAsyncKeyState` repeat flag, foreground hwnd, game-foreground, overlay enabled.
   - `src/App.tsx` shop shortcut branch: visible / game foreground / page focus / available.
3. [x] User runs `npm run tauri dev`, opens the shop with B, presses B again; sends the log.
4. [x] Root cause (from the log): while the overlay holds the foreground the hook receives
       no keys at all (Sogou IME, Chinese mode); the page gets `keydown KeyB`. Fix:
       `subscribeShortcut` also reports the shop key and Y/U from page `keydown` in Tauri
       (`gameForeground: false`); `App` opens the shop only when `gameForeground` is true
       (or null in preview), so a press reported by both page and hook stays idempotent.
5. [x] Remove diagnostics; update `.trellis/spec/frontend/system-boundaries.md` if the
       hotkey contract changes.
6. [x] `npm run lint`, `npm test`, `npm run tauri:check`,
       `cargo test --manifest-path src-tauri/Cargo.toml`; user re-runs AC1/AC2.
