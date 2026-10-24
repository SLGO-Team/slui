# Move windows-sys to 0.61

## Goal

After the Tauri 2.12 update (#59) Tauri's own stack builds windows-sys 0.61; SLUI's and the
installer's direct `windows-sys` 0.59 dependency was the only 0.59 left, so the crate compiled
twice. Move both to 0.61.

## Requirements

- `src-tauri/Cargo.toml` and `installer/src-tauri/Cargo.toml` depend on windows-sys 0.61 with the
  same features.
- No windows-sys 0.59 left in the Windows dependency tree; workspace-hack regenerated.
- Same behaviour: the FFI declarations SLUI and the installer use are unchanged.

## Acceptance Criteria

- [x] `cargo check --workspace --all-targets` passes without source changes.
- [x] `cargo clippy --workspace --all-targets -- -D warnings` (Rust 1.99), `cargo test --workspace`
      (39 + 37) and the hakari checks pass.
- [x] `npm run tauri:mock` starts and the overlay session goes live.

## Notes

- windows-sys 0.60 stays: `rfd` 0.16 (tauri-plugin-dialog 2.8, installer only) still builds it.
