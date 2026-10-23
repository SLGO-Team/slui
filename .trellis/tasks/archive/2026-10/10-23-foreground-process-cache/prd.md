# Cache the game-process check per window

## Goal

`is_game_foreground` opened the foreground window's process and read its executable path every
time it was asked: from the foreground thread every 100 ms and from the keyboard events on every
key. A window never changes process, so the answer only needs reading when the foreground window
changes.

## Requirements

- Remember the verdict for the last foreground window, keyed by window handle and process id (a
  reused handle belongs to a new process id).
- A failed query (process not openable, path not readable) is not remembered, so it is retried.
- Same answers as before; no process memory or game input is read (unchanged).

## Acceptance Criteria

- [x] `ForegroundProcessCache` unit tests: one query per window, a reused handle with a new process
      is queried, a failed query is retried.
- [x] `cargo test --workspace` and `cargo check --workspace` (no warnings) pass.
- [ ] Live check of the overlay following the game: not possible here (the installed SLUI is running
      and single-instance); part of the in-game test before the next release.
