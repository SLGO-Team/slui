# Drop unused library crate types

## Goal

`slui_lib` is built as `staticlib`, `cdylib` and `rlib`, the Tauri template's mobile default. The
desktop `slui.exe` links only the `rlib` (`main.rs` calls `slui_lib::run()`); nothing uses
`slui_lib.dll` or `slui_lib.lib`. With the release profile's fat LTO (PR #56) each extra artifact runs
its own LTO pass (in the local release build `slui_lib.dll` was written after `slui.exe`).
Build the library as `rlib` only, as the installer shell already does.

## Requirements

- `src-tauri/Cargo.toml`: `crate-type = ["rlib"]`.
- `slui.exe` unchanged in size and behaviour.

## Acceptance Criteria

- [x] Release rebuild of slui (dependencies built) timed with and without the extra crate types.
- [x] `slui.exe` size practically identical (26,612,736 -> 26,611,200 bytes).
- [x] `cargo test --workspace` passes (74 passed, 1 ignored); `npm run lint` / `npm test` and CI `build-and-test` run on the PR.

## Measurements

`npx tauri build --no-bundle` (local config) after touching `src-tauri/src/lib.rs`, dependencies
already built with the release profile:

| | seconds | slui.exe |
|---|---|---|
| warm-up (staticlib + cdylib + rlib) | 279 | 26,612,736 |
| staticlib + cdylib + rlib | 291 | 26,612,736 |
| rlib only | 234 | 26,611,200 |

About a minute (-20%) per release rebuild of slui; less than the three minutes the timestamps
suggested, which also covered slui's own recompile.
