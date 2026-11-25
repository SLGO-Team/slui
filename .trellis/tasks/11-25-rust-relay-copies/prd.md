# Rust relay and blur: drop per-frame copies

Source: item 2 of the 2026-11-25 cloud review follow-ups; proposals in
`.trellis/tasks/archive/2026-11/11-25-overlay-perf-pass/research/rust-perf-proposals.md` (cloud could
not compile Rust). Behaviour and output stay identical.

## Requirements

1. `src-tauri/src/backdrop.rs` `Engine::render` runs on every captured game frame and cloned the whole
   `Plan` (`Vec<Placed>`) each time. Move it out with `std::mem::take`, draw from a helper, and put it
   back on every exit path (the helper's `?` returns included).
2. `src-tauri/src/sidecar_socket.rs` relay: `SidecarSocketEvent::Message { data }` held a `String`
   copied from the received frame (`text.to_string()`, up to 16 MiB for a baseline). Hold the frame's
   `tungstenite::Utf8Bytes` and serialise it with `serialize_str`, so the channel JSON is byte-identical.
3. `src-tauri/src/game_log.rs`: `from_utf8_lossy(..).into_owned()` always copied the chunk (up to
   1 MiB). Truncate the buffer and convert it in place; only invalid UTF-8 falls back to the lossy copy.

## Acceptance Criteria

- [x] A unit test shows the relayed message serialises exactly like the former `String` field
      (escapes, control characters, non-ASCII, empty).
- [x] A unit test covers a chunk with invalid UTF-8 (replacement characters, byte offset unchanged).
- [x] `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings` pass.
- [ ] Live check on Windows: world blur draws and the HUD renders with these changes (done together
      with item 3 in one run; see the session journal).
