# Design: pause per-frame work while the overlay is hidden

## Contract (Rust → overlay page)

- State `OverlayVisibility { visible: bool, revision: u64 }` (managed `Mutex`, default `{ false, 0 }`: the overlay window is created hidden).
- `publish_overlay_visibility(app, visible)`: on a change, bump `revision` and emit `slgo-overlay-visibility` to the overlay window only (no diag line: the foreground changes that cause it are already logged).
- Windows: called at the end of `apply_overlay_input_mode` and `hide_overlay_window` with `IsWindowVisible(hwnd) != 0`, i.e. the Win32 truth after
  the native show / hide, the same source `backdrop.rs` already reads. Both run on the main thread.
- Other platforms: `apply_overlay_enabled` publishes `enabled` after `show()` / `hide()`.
- Command `get_overlay_visibility` returns the snapshot (listen-then-query, as `get_game_foreground` / `get_game_conditions`).

## Page

- `src/platform/overlayVisibility.ts`
  - `createNativeOverlayVisibilitySource(bridge)` → `subscribeOverlayVisible(listener: (visible: boolean) => void)`: starts with `true` (fail open),
    registers the event listener first, then queries; accepts a revision only if it is newer (the first accepted revision may be 0); a malformed
    payload or a failed listen / query calls `listener(true)` once and stops (R4).
  - A shared module-level store over that source: one native subscription for the page, started by the first subscriber.
    `subscribeOverlayVisible(listener)`, `useOverlayVisible()` (`useSyncExternalStore`). Outside Tauri: always `true`, no subscription.
- `useMinimapView` (radar): `shown = useOverlayVisible()`; the radar subscribes to the store only while shown (a no-op subscribe otherwise; React
  re-subscribes on show and renders the latest snapshot); `clockRunning` additionally requires `shown`.
- `backdrop.ts`: subscribes to overlay visibility when the first panel registers (Tauri only). Hidden: cancel the frame, never request one; registry
  changes still flush (measure + send) through the existing microtask, register included. Shown: `send(performance.now())`, then resume the loop.

## Trade-offs

- While hidden the store still reduces every event, so state is current on show; only rendering stops.
- On show, DWM first presents the page's last frame (from before the hide) until the page renders again, at most a frame or two at the display rate;
  the overlay itself already appears up to 100 ms after the game takes the foreground (foreground poll), so this is below what the show path adds.
- Native blur regions changed while hidden (a resize while hidden, a panel mid-animation at hide) are re-sent on the visibility event, so the blur
  can show the previous regions for the same frame or two.

## Rollback

Revert the commit: the event is additive, nothing else reads it.
