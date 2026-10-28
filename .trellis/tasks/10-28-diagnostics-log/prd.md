# SLUI release diagnostics log (shop hotkey path)

## Problem

Players report that B does not open the shop while SLUI runs and works again once SLUI is closed; the developer
never reproduces it. While the overlay is enabled the plugin ignores its own shop key for that player
(`shop-menu` client feature), and SLUI opens its shop only when its `WH_KEYBOARD_LL` hook sees the key, the
game holds the foreground at the press, and the last `shop.snapshot` has `window_open`. Any failing link is
silent. Server logs (2026-10-24 competitive match) show one reporter closing SLUI
twice during buy phases but cannot tell which link failed: a release SLUI writes its diagnostics to a stderr
nobody reads.

Ruled out by reading: client clock skew (availability never compares clocks) and stale snapshots (the plugin
rebuilds every second and publishes every second while the window is open).

Remaining hypotheses the log must separate:
1. The game runs elevated and SLUI does not: the low-level hook sees no key while the game is foreground.
2. Windows silently removed the hook after a callback timeout: keys stop reaching SLUI mid-session.
3. The async key state reports B as already down, so a fresh press is treated as auto-repeat.
4. A settings or page-side cause: another shop key, team menu or chat open, no snapshot, window closed.

## Requirements

- Release and debug builds append timestamped (UTC, matching the server logs) lines to
  `app_log_dir()/slui.log`; each launch rotates the previous two sessions (`slui.1.log`, `slui.2.log`).
  A size cap per session stops runaway logging. Lines written before the file opens are kept and flushed.
  A second instance (single-instance exit) never rotates or writes.
- Every existing `eprintln!` diagnostic goes to the log (still to stderr for `tauri dev`); panics are logged.
- Start line: SLUI version, Windows build, whether SLUI runs elevated, log path.
- When the game process first holds the foreground: its process id and whether it runs elevated (or why
  that could not be read).
- Hook liveness: while the game was foreground during the last minute, one line with the minute's key and
  mouse event counts seen by the hooks and the foreground time. No key codes, no text: counts only.
- A handled key (shop, chat, scoreboard) whose key-down the async state reports as already down although the
  hook saw no fresh press since its last key-up is logged once per press.
- A shop or chat key ignored because the overlay is disabled is logged.
- Page side (through `log_overlay_event`): each shop key decision with its inputs (opened / closed / not
  opened with game foreground, session, snapshot, window open), shop availability changes, the client
  features reported, the applied hotkeys.
- Tray menu item 「打开日志文件夹」 reveals `slui.log` in Explorer, so a player can attach it to a report.

## Non-goals

- No upload: the player sends the file.
- No behaviour change to the shop, chat or scoreboard paths. The fix follows once logs name the cause.

## Acceptance criteria

- [ ] A release build writes `slui.log` with the start line, game elevation, hook liveness and shop key
      decisions; a relaunch rotates the files; a second launch leaves them alone.
- [ ] No typed text or non-hotkey key codes are ever logged.
- [ ] The tray item reveals the log file.
- [ ] `npm test`, `npm run lint`, CI clippy (`-D warnings`) and `cargo test --workspace` pass.
- [ ] Spec `system-boundaries.md` documents the log file, its contents and the no-keystroke rule.
