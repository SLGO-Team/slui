# Rust small defects: settings fsync, registry retry, reload frees sockets

Source: item 3 of the 2026-11-25 cloud review follow-ups (low severity; needs a Windows Rust build).

## Problems (confirmed on main 29af2b5)

1. `src-tauri/src/settings.rs` `save` wrote the temporary file with `fs::write` and renamed it without
   `sync_all`, so the comment "a crash never leaves a half-written settings file" did not hold: after a
   power cut the renamed file could be empty or short.
2. `src-tauri/src/game_conditions.rs` `DisplaySettingWatch::poll` recorded the file's modified time
   before reading. A failed read (the game holding `registry.txt` while writing) or a half-written file
   left the mode unknown until the file changed again.
3. `src-tauri/src/sidecar_socket.rs`: a page reload or navigation left the old document's sockets
   running and in the table (2 slots in total), with their events going to a channel nobody reads.

## Requirements

- `save` writes the temporary file, `sync_all`s it, then renames; a failed write removes the temp file.
- `poll` keeps the modified time only after a read that found the display-mode line; otherwise the
  next poll (every 2 s while the game runs) reads again.
- Every socket records the label of the webview that opened it. On `on_page_load` `Started` (a new
  document starts loading, before its scripts run) that webview's sockets leave the table and their
  command senders drop, which closes them through the run loop's existing queue-ended path.

## Acceptance Criteria

- [x] Unit tests: a half-written registry with an unchanged modified time is read again; a page load
      drops only that page's sockets and frees their slots; dropping a socket's handle closes it promptly.
- [x] `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings` pass.
- [x] Live check in a debug SLUI: an overlay page reload closes the socket it opened (diag line and the
      server sees the close); relayed messages arrive unchanged (also covers item 2's `Utf8Bytes` relay).

## Result (2026-11-25)

Debug SLUI (mock mode, own identifier) against a minimal local WebSocket server, driven over CDP:
the overlay page opened a socket and received a 48-byte message with escapes / non-ASCII and a 300 KB
message, both identical to what the server sent; `Page.reload` made the client send its close frame
within ~15 ms (`overlay reloaded: closed 1 sidecar socket(s)`); the reloaded page opened 2 sockets and a
third was refused. World blur frame output was not checked live here (needs the game in the foreground).
