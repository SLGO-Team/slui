# Installer: one slui-setup build for installer and uninstaller

## Goal

`npm run installer:build` compiles the `slui-setup` crate in release once instead of twice, saving one
~80s release compile per installer build (CI release job and local `installer:build:local`).
Parent: `10-10-build-speed`.

## Background (verified)

- Today `scripts/build-installer.mjs` runs three release builds: `slui-setup --features uninstaller`
  (→ `slui-uninstall.exe`), `slui` + NSIS (embeds the uninstaller via `installer-hooks.nsh`), then
  `slui-setup` again with `SLUI_SETUP_PAYLOAD`. CI: 85s + 97s + 76s of the 309s job.
- The role is compile-time: `ROLE` from `cfg!(feature = "uninstaller")` (`installer/src-tauri/src/lib.rs`).
  It selects `main.rs` flow, window title, the `__SLUI_SETUP_ROLE__` init script and the command set.
- The payload is a Win32 RCDATA resource added by `build.rs` (not `include_bytes!`, which ran LLVM out of
  memory); `SLUI_SETUP_VERSION`, `SLUI_SETUP_REQUIRED_BYTES`, `SLUI_SETUP_PAYLOAD_BYTES` are `env!`
  constants. The payload contains `slui-uninstall.exe`, so the uninstaller must exist before the payload.
- The shell's manifest is `asInvoker`; the exe version info (FileDescription/ProductName) comes from the
  Tauri `productName` (`SLUI Setup`; the uninstaller build overrides it to `SLUI Uninstall`).

## Requirements

- R1 One release compile of `slui-setup` per installer build; `slui-uninstall.exe` and
  `SLUI-Setup-X.Y.Z.exe` are derived from that exe after compilation.
- R2 Role, payload, payload version and required disk space are read at runtime from data attached after
  compilation; a release exe without that data refuses to run with a clear message instead of guessing a
  role.
- R3 Installer and uninstaller behaviour is unchanged: same UI per role, same commands exposed per role,
  uninstaller relocation to %TEMP%, classic (no WebView2) paths, payload extraction to the session dir.
- R4 Dev flows keep working: `npm run installer:dev` (setup UI, no payload) and
  `npm run installer:dev -- --uninstall` (uninstall UI); `--reuse-payload` and `--theme-pack` keep their
  meaning; CI's payload-less `cargo test --workspace` still builds.
- R5 The build script still refuses inconsistent inputs (payload version ≠ SLUI version, missing or stale
  artifacts).
- R6 Exe version info: both exes keep the shell's `SLUI Setup` product name / file description (user
  decision 2026-10-10); the window title still follows the role (`SLUI 安装程序` / `SLUI 卸载程序`).

## Acceptance Criteria

- [ ] `npm run installer:build:local` logs exactly one `slui-setup` release compile and produces a working
      `SLUI-Setup-<version>.exe`.
- [ ] Live test on this PC: install over an existing SLUI, launch from the finish page, uninstall via
      Settings → Apps (keep and delete theme pack variants), as in `10-05-uninstaller`.
- [ ] Unit tests cover parsing of the attached data (valid, missing, truncated, wrong magic).
- [ ] Release job time drops by roughly one `slui-setup` compile (record before/after).
- [ ] `npm run lint`, `npm test`, `cargo test --workspace` pass.
