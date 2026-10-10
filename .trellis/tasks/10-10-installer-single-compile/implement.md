# Implement: one slui-setup build

Branch `perf/installer-single-compile` from an up-to-date `main` (after the CI child has merged).

## Checklist

1. `installer/src-tauri/src/overlay.rs`: `Role`, `Overlay { role, payload_offset, payload_bytes,
   required_bytes }`, `read(reader, len, expected_version) -> Option<Overlay>`; unit tests: valid setup,
   valid uninstall, no trailer, wrong magic, truncated meta, oversized meta, version mismatch, payload range
   before file start.
2. `lib.rs` / `main.rs`: runtime role resolution (design "Role resolution"), replace every `ROLE` use;
   release exe without overlay → message box + exit 1.
3. `payload.rs`: extract from the overlay range (streamed copy); drop the RCDATA reader and the
   `slui_setup_no_payload` cfg. `detect.rs`: `payload_version()` = `CARGO_PKG_VERSION`,
   `required_bytes()` from the overlay or the dev placeholder.
4. `build.rs`: manifest + `tauri_build` only. `Cargo.toml`: remove the `uninstaller` feature.
5. `scripts/build-installer.mjs`: one shell build, `appendOverlay(src, dest, meta, payload?)`, flow from
   design; `--dev --uninstall` via `SLUI_SETUP_ROLE`. Update the header comment.
6. Specs: `directory-structure.md`, `quality-guidelines.md` (overlay contract, role resolution, signing
   note); fix comments that mention the feature / RCDATA (`installer/src/uninstall/*.ts` if they do).

## Validation

- `npm run lint`, `npm test`, `cargo test --workspace --manifest-path src-tauri/Cargo.toml`.
- `npm run installer:build:local`: one `slui-setup` release compile in the log; outputs exist; sizes sane.
- Live test (user's PC): install over the existing SLUI, launch from finish page; uninstall from Settings →
  Apps (keep theme pack, then delete theme pack); `npm run installer:dev` and `-- --uninstall` show the
  right UIs.
- Release job time: compare the next release run with 309s.

## Rollback

Revert the PR. No persisted format outside one build.
