# PRD: 品牌化卸载器（可选删除主题包 / 用户数据）

## Background

- SLUI ships as `SLUI-Setup-<ver>.exe`, a branded Tauri shell (`installer/`) around the internal
  Tauri NSIS package. Uninstalling today goes through the NSIS default `uninstall.exe`
  (unbranded wizard, "Apps & features" → 卸载).
- The NSIS uninstaller only deletes files the package registered at build time. A theme pack
  (`<install dir>\theme-pack\`, fonts + sounds) installed by a themed build and later updated by a
  regular build, or copied in by hand, survives the uninstall and keeps the install dir alive.
  A themed build's uninstaller, on the other hand, always deletes it; there is no choice.
- User settings live in `%APPDATA%\com.slui.desktop`, WebView2 data in
  `%LOCALAPPDATA%\com.slui.desktop`; the NSIS checkbox that deletes them only exists in the
  interactive wizard.

## Requirements

- R1 A branded uninstaller (same look as the installer shell) is installed with SLUI and is what
  "Apps & features" → 卸载 opens.
- R2 The uninstaller shows the installed version and directory and asks for confirmation. Toggles:
  - 同时删除主题包 — default **off**; shown only when `<dir>\theme-pack` exists.
  - 删除用户设置和数据 — default **off**; shown only when either user data dir exists.
- R3 With 主题包 off, the theme pack and the install dir that holds it are kept (whatever build
  installed the pack). With it on, `theme-pack\` is removed and the install dir is removed when
  empty.
- R4 With 用户数据 on, both `com.slui.desktop` dirs of the user who runs the uninstaller are
  removed after the app files.
- R5 UAC appears only when 卸载 is clicked; declining returns to the confirmation screen with a
  notice and changes nothing. A running SLUI is closed (notice shown beforehand).
- R6 Success is decided from the machine state (uninstall entry gone, `slui.exe` gone, theme pack
  state matches the choice), not the exit code alone. Failures show a reason, the exit code and
  offer 重试 / 关闭.
- R7 After the uninstaller exits nothing of it remains in the install dir; its temp copy is removed
  at the next reboot (or by the next setup / uninstaller run).
- R8 Compatibility: NSIS keeps working as the engine. Silent / scripted uninstall
  (`QuietUninstallString`, `UninstallString /S`, the NSIS wizard's own "uninstall first" path)
  keeps working. Without WebView2 the uninstaller falls back to the classic NSIS uninstall wizard.
- R9 Plain `npm run tauri build` (no installer pipeline) still produces a working package with the
  default NSIS uninstaller; only `scripts/build-installer.mjs` adds the branded uninstaller.

## Out of scope

- Uninstalling HKCU (currentUser) installs of old builds.
- A "Modify / Repair" entry, code signing.

## Acceptance criteria

- [x] AC1 After install, `HKLM\…\Uninstall\SLUI` `UninstallString` = `"<dir>\slui-uninstall.exe"`,
      `QuietUninstallString` = `"<dir>\uninstall.exe" /S`; 应用和功能 → 卸载 opens the branded UI.
- [x] AC2 Defaults (both toggles off) with a theme pack present: app files, shortcuts and the
      uninstall entry are gone; `<dir>\theme-pack\` is intact; user data intact.
- [x] AC3 主题包 on: `<dir>` no longer exists (theme pack included).
- [x] AC4 用户数据 on: `%APPDATA%\com.slui.desktop` and `%LOCALAPPDATA%\com.slui.desktop` gone.
- [x] AC5 A theme pack installed by a themed build is kept when 主题包 is off (no build-time
      resource deletion).
- [ ] AC6 UAC declined → back to confirmation with notice; nothing removed.
- [x] AC7 After closing the uninstaller: no `slui-uninstall.exe` in `<dir>`; the temp copy is
      scheduled for deletion on reboot; no `%LOCALAPPDATA%\com.slui.setup`.
- [x] AC8 `"<dir>\slui-uninstall.exe" /S` uninstalls silently with no UI (forwarded to NSIS).
- [x] AC9 Installer flows (fresh / update / reinstall) unchanged; `npm run lint`, `npm test`,
      `cargo test --workspace` pass.

## Verification (2026-10-05, E2E on the dev PC with the themed local build)

- AC1–AC5, AC7, AC8 verified on the machine (install to `D:\SLUI-E2E`, uninstaller driven over
  WebView2 remote debugging): defaults kept `theme-pack\` + user data; both toggles removed the
  dir and both data dirs while SLUI was running; `PendingFileRenameOperations` listed only the temp
  copies; NSIS exit code stayed 0 with the reboot flag set; `slui-uninstall.exe /S` uninstalled
  silently and left no `slui-uninstall.exe`.
- AC6 not verifiable on this PC: `ConsentPromptBehaviorAdmin = 0` elevates without a prompt. The
  cancel path is the installer's (`ShellError::Cancelled`, verified there) and is covered by
  `scripts/uninstaller-model-smoke.mjs` and the `?state=cancel` mock.
- AC9: fresh install and same-version reinstall through the shell exercised; update (older →
  newer) not re-run, its args and code are unchanged.
