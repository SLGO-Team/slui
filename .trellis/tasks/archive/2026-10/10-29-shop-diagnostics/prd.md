# Shop and shop-key diagnostics (slui.log, second round)

## Problem

Two field reports, neither reproduced on the developer PC, no logs collected yet:

1. With SLUI running, B does not open the shop; closing SLUI makes the in-game shop work again.
2. Opening the shop and buying something closes the shop, so buying does not work.

Reporters' answers (2026-10-29) for report 1: the player was inside the buy zone and window and had not
rebound keys; while B is dead the SLUI HUD keeps updating and Y/U chat and the CapsLock scoreboard work; the
failure persists across repeated presses and a server rejoin, and sometimes clears after several SLUI restarts.
The plugin and sidecar side is clean: the game host's logs since 10-16 hold no `shop.snapshot` build error and
no `invalid-payload` diagnostic for a shop frame.

That leaves two client-side links for report 1, and SLUI 0.10.0's log (task `10-28-diagnostics-log`) cannot
always tell them apart:

- Rust drops the B press before emitting it: the auto-repeat check reports the key as already down. 0.10.0
  logs this only when the key's previous event is older than 1.5 s, so quick repeated presses after a lost
  key-up go unlogged.
- The page opens the shop and it disappears at once. 0.10.0 logs `shop key: open` but no close reason, no
  window focus/blur while the shop is open, and not who took the foreground.

Report 2 needs the same close reasons plus the purchase command's round trip, the session's failure detail
and uncaught page errors (a render error unmounts the whole overlay and is logged nowhere today).

## Requirements

All lines go through the existing `log_overlay_event` / `diag!` path into `slui.log`.

- Every path that closes an open shop logs one line with its reason: shop key, chat key (Y/U), Escape, the
  返回 button, window blur, shop no longer available (with the availability inputs), team menu opening,
  overlay disabled. Nothing is logged when the shop was already closed.
- The shop being drawn and hidden is logged, with whether the page had focus when it was drawn; while it is
  drawn, the overlay window's focus and blur events are logged with the time since it was drawn.
- Each shop key decision also logs the age of the last `shop.snapshot` and the shop availability.
- Each overlay input switch (interactive and keyboard on / off) logs its outcome and duration, not only its
  failure.
- Each shop command (purchase, request, fulfil, refund, refund all) logs when it is sent (kind and target
  item or request), its result (status, reason, latency), a send failure, and the absence of any result
  5 s after sending.
- The session's failure detail is logged when it changes (close reasons such as a rejected stream).
- Uncaught errors in either window (window `error`, unhandled promise rejections, React uncaught / caught
  render errors) are logged with the window label, message and a short stack, capped in length.
- Rust: when the foreground leaves both the game and the overlay (the overlay is hidden), log the new
  foreground window's executable file name and window class. Never its title.
- Rust: a handled key's key-down that the async state reports as already down is logged whenever the hook's
  own last event for that key was a key-up (or it saw none), whatever the gap; the line says which event the
  hook saw last and how long ago. True auto-repeat (down after down) stays unlogged.

## Non-goals

- No behaviour change to the shop, chat, scoreboard, hooks or session. Fixes follow once logs name a cause.
- No upload; the player sends the file.

## Acceptance criteria

- [x] Each close path above produces exactly one `shop closed: <reason>` line; an already closed shop logs none.
- [x] A shop key press logs the snapshot age and availability with its decision.
- [x] Shop commands log sent / result / no result in 5 s.
- [x] Uncaught page and render errors reach `slui.log` from both windows.
- [x] The foreground-left line names only an executable file name and a window class.
- [x] The repeat-anomaly rule is a pure function with unit tests: logged after a seen key-up or no event,
      not after a seen key-down within the auto-repeat gap.
- [x] No typed text, window title, player name or non-hotkey key code is logged.
- [x] `npm run lint`, `npm test`, CI clippy (`-D warnings`) and `cargo test --workspace` pass.
- [x] Spec `system-boundaries.md` lists the new log contents and the no-title rule.
