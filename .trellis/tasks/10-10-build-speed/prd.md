# Speed up CI and release builds

## Goal

Cut the wall time of the required PR check (`build-and-test`) and of the release installer job without
changing what SLUI or the installer do at runtime. Source: user request 2026-10-10 ("还能再让构建速度更快吗").

## Background (measured 2026-10-10)

- `build-and-test` (run 38053440487): ~3m10s. npm steps ~40s, `Swatinem/rust-cache` restore 54s (cache
  ~836 MB), cargo-hakari check 27s (1.8s locally), `cargo test --workspace` 38s.
- Release `installer` job (run 38053440517): `npm run installer:build` 309s with every dependency restored
  from cache. Release compiles of the three final crates dominate: uninstaller (`slui-setup`, `uninstaller`
  feature) 85s, `slui` 97s, installer shell (`slui-setup` again, with payload) 76s; makensis 15s.
- `rustc -Z time-passes` on the `slui` lib (local, 24 cores, 34s): ~30s is LLVM optimisation of the Tauri
  code monomorphised in the final crate. Measured with no meaningful gain (rejected): rlib-only crate type,
  `build-override opt-level = 3`, dropping the 17 MB of fonts from `dist`, `codegen-units = 256`
  (slower), `opt-level = 1` (slower) / `"s"` (34s → 30s).

## Children

| Child | Deliverable |
|---|---|
| `10-10-ci-build-speed` | Faster `build-and-test`: measured CI-only changes (hakari step, debug info / cache size) |
| `10-10-installer-single-compile` | One release build of `slui-setup` serves as both `slui-uninstall.exe` and `SLUI-Setup-X.Y.Z.exe` |

The children are independent; each lands as its own PR.

## Cross-child acceptance criteria

- [ ] `build-and-test` still gates the same things (lint, tests, production build, hakari freshness,
      `cargo test --workspace`); no check is dropped, only made cheaper or skipped when provably unaffected.
- [ ] Before/after wall times from real CI runs are recorded in each child PR.
- [ ] Installed SLUI and the installer/uninstaller behave as before (child 2 live test).
