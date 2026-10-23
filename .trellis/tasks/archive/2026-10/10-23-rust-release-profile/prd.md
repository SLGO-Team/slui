# Rust release profile

## Goal

`src-tauri/Cargo.toml` (the workspace root for SLUI, the installer shell and workspace-hack) has no
`[profile.release]`, so release builds use Cargo's defaults: no LTO, 16 codegen units, symbols kept.
Tune the profile for a smaller `slui.exe`, `slui-setup.exe` and installer, and measure the size and
build-time cost locally and in CI.

## Requirements

- One `[profile.release]` in the workspace root, so SLUI and the installer shell share it.
- Candidates measured on the same commit: Cargo defaults; `lto = "fat"`, `codegen-units = 1`,
  `strip = "symbols"`; the same with `opt-level = "s"`.
- `panic` stays `unwind`: `sidecar_socket.rs` awaits tokio `JoinHandle`s, which report a task panic as
  an error only with unwinding; `abort` would turn such a panic into a crash of the overlay.
- PR CI (`build-and-test`, dev profile via `cargo test`) is unaffected; the release workflow's
  `installer` job is the one that pays. Its build time is measured with a temporary benchmark
  workflow on the PR (both profiles, cold, same commit), removed before merge.
- No behaviour change: the built app runs (overlay, home window).

## Acceptance Criteria

- [x] Local sizes and build times for the three candidates recorded below.
- [x] CI cold `installer:build` time, defaults vs chosen profile, recorded below.
- [x] Chosen profile committed with the reason; the benchmark workflow is not in the merged diff.
- [x] `npm run lint`, `npm test`, `cargo test --workspace` pass; the tuned `slui.exe` starts and
      shows the home window. (Tests pass; starting the tuned exe was not possible next to the running
      installed SLUI, which is single-instance: left for the in-game test before the next release.)

## Measurements

Local, `npm run installer:build:local`, one commit, profile through `CARGO_PROFILE_RELEASE_*`:

| Profile | slui.exe | slui-setup.exe | NSIS payload | Installer | Build |
|---|---|---|---|---|---|
| Cargo defaults | 31.42 MB | 10.02 MB | 23.21 MB | 33.23 MB | 138 s (incremental) |
| fat LTO + cgu 1 + strip | 29.77 MB | 9.11 MB | 22.99 MB | 32.11 MB | 565 s (full) |
| + opt-level "s" (chosen) | 26.61 MB | 6.84 MB | 21.99 MB | 28.84 MB | 514 s (full) |

The local times are not comparable (the first reused compiled dependencies); CI below builds cold.

CI, `windows-latest`, cold (no Rust cache), `npm run installer:build`, one commit (run 39964722037):

| Profile | slui.exe | slui-setup.exe | NSIS payload | Installer | Build |
|---|---|---|---|---|---|
| Cargo defaults | 31.22 MB | 10.01 MB | 23.09 MB | 33.10 MB | 404 s |
| chosen | 26.44 MB | 6.71 MB | 21.87 MB | 28.58 MB | 566 s |

A release's installer build pays about 2.7 minutes more (+40% cold); PR CI is unchanged.

`cargo test --workspace --release` with the chosen profile: 74 passed, 1 ignored (release build 2m 43s).
