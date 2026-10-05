# Design: 品牌化卸载器

NSIS facts this relies on (from the generated `src-tauri/target/release/nsis/x64/installer.nsi`
and `utils.nsh`, Tauri 2.11 template):

- Uninstall section order: `NSIS_HOOK_PREUNINSTALL` → `CheckIfAppIsRunning` (silent: kills
  `slui.exe`) → delete `slui.exe`, registered resources, `uninstall.exe` → `RMDir "$INSTDIR"`
  (non-recursive) → shortcuts (unless `/UPDATE`) → `DeleteRegKey` uninstall entry → app data if
  `$DeleteAppDataCheckboxState = 1` (template variable, only set by the wizard checkbox) →
  `NSIS_HOOK_POSTUNINSTALL`.
- Install section writes `UninstallString = "$INSTDIR\uninstall.exe"` before
  `NSIS_HOOK_POSTINSTALL`, so the hook can override it.
- The wizard's "uninstall before installing" path runs `UninstallString [/UPDATE] [/P] _?=<dir>`;
  silent installs (the shell always passes `/S`) skip that page.
- An NSIS uninstaller started without `_?=` copies itself to `%TEMP%` and returns at once; with
  `_?=<dir>` (last, unquoted) it runs where it is and the caller can wait for the real exit code.

## Boundaries

```
installer/src-tauri (crate slui-setup)
 ├─ default features  → slui-setup.exe      (role Setup, embeds the NSIS payload)   [unchanged]
 └─ --features uninstaller → slui-uninstall.exe (role Uninstall, no payload, ~small)
        installed as <dir>\slui-uninstall.exe by NSIS_HOOK_POSTINSTALL
        registered as UninstallString

<dir>\slui-uninstall.exe  (asInvoker)
  args present (not --relocated)  → forward: ShellExecuteEx(open, <dir>\uninstall.exe, <raw args>), wait, exit with its code
  no WebView2                     → ShellExecuteEx(open, <dir>\uninstall.exe) (classic NSIS wizard), exit
  running from the installed dir  → copy self to %TEMP%\slui-setup-<pid>\slui-uninstall.exe, spawn it with --relocated, exit
  otherwise (relocated / dev)     → UI
UI 卸载 → copy <dir>\uninstall.exe next to the running exe → ShellExecuteEx(runas,
          "/S [/SLUI-THEME-PACK] [/SLUI-APPDATA] [/SLUI-CLEANUP] _?=<dir>") → wait → verify → user data
```

- NSIS stays the only engine that touches Program Files, the registry and shortcuts. The UI process
  is never elevated; it only deletes the invoking user's own data dirs.
- Same crate, one Cargo feature: all detection / ShellExecute / session / WebView2-gate code is
  shared. `const ROLE` comes from `cfg!(feature = "uninstaller")`; both code paths always compile,
  so `cargo test --workspace` covers them. `build.rs`: with the feature, a payload env var is an
  error, and release builds are allowed without a payload (`cfg(slui_setup_no_payload)`).

### Why relocate

The UI waits for NSIS; a process running from `<dir>\slui-uninstall.exe` would lock that file and
keep `<dir>` alive. Running a temp copy (the same thing NSIS does for `uninstall.exe`) leaves
nothing locked inside `<dir>`. NSIS is started from a temp copy of `uninstall.exe` with `_?=<dir>`
so the UI gets the real exit code. Both temp copies sit in the relocation dir; with
`/SLUI-CLEANUP` the elevated NSIS schedules `$EXEDIR\slui-uninstall.exe`, `$EXEDIR\uninstall.exe`
and `$EXEDIR` for deletion at reboot (`/REBOOTOK`, fixed file names only, never `$INSTDIR`). The
non-elevated UI cannot schedule reboot deletions itself. A cancelled run's copy is removed by the
existing stale-session sweep (`slui-setup-<pid>`, pid dead) of the next setup / uninstaller run.

### Forward mode

Any command line other than `--relocated` is passed verbatim (raw tail of `GetCommandLineW`, so
`_?=<dir with spaces>` keeps its unquoted form) to `<own dir>\uninstall.exe`. This keeps
`UninstallString /S` (tools), and the NSIS wizard's `UninstallString /UPDATE _?=<dir>` working.
Semantics equal calling `uninstall.exe` directly, including its immediate return without `_?=`.
`QuietUninstallString` points at `uninstall.exe /S` directly.

## NSIS hooks (`src-tauri/windows/installer-hooks.nsh`)

Install side, compiled in only when `scripts/build-installer.mjs` defines the sources (it writes a
wrapper `.nsh` into `target/release` that `!define`s them and `!include`s the base file, and points
`bundle.windows.nsis.installerHooks` at the wrapper via `--config`; plain `tauri build` is
unchanged):

```nsis
!ifdef SLUI_THEME_PACK_SOURCE      ; theme pack is user content, not a registered resource
  SetOutPath "$INSTDIR\theme-pack"
  File /r "${SLUI_THEME_PACK_SOURCE}\*.*"
  SetOutPath "$INSTDIR"
!endif
!ifdef SLUI_UNINSTALLER_SOURCE
  File "/oname=$INSTDIR\slui-uninstall.exe" "${SLUI_UNINSTALLER_SOURCE}"
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\slui-uninstall.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
!endif
```

- **Theme pack moves from `bundle.resources` to the hook.** Registered resources are deleted by
  every uninstall, so "keep the theme pack" would be impossible for a themed build. Installed by
  the hook, the pack is only ever removed on `/SLUI-THEME-PACK`. The app still reads it from
  `resource_dir()\theme-pack` (= `<dir>\theme-pack`); `tauri-build` no longer copies the pack into
  `target/release`.

Uninstall side (always compiled in):

- `PREUNINSTALL`: `/SLUI-APPDATA` → `StrCpy $DeleteAppDataCheckboxState 1` (template then removes
  the elevated user's data dirs and the `Software\SLUI` install-location keys).
- `POSTUNINSTALL`, only when `$UpdateMode <> 1`: `Delete "$INSTDIR\slui-uninstall.exe"`;
  `/SLUI-THEME-PACK` → `RMDir /r "$INSTDIR\theme-pack"`; `RMDir "$INSTDIR"`; `/SLUI-CLEANUP` and
  `$EXEDIR != $INSTDIR` → the three `/REBOOTOK` deletions above.
- New switch names are not prefixes of each other nor of template switches
  (`/P /R /NS /ARGS /UPDATE`).

## Rust commands (uninstall role)

```ts
uninstall_detect(): {
  installed: null | { version: string; dir: string };  // HKLM entry + <dir>\uninstall.exe present
  themePack: boolean;   // <dir>\theme-pack is a directory
  userData: boolean;    // %APPDATA% or %LOCALAPPDATA% \com.slui.desktop exists
  appRunning: boolean;
}
uninstall(req: { themePack: boolean; userData: boolean },
          onStage: Channel<"preparing" | "elevating" | "uninstalling" | "cleaning">)
  : { kind: "ok"; dir: string; themePackKept: boolean; userDataError: string | null }
  | { kind: "cancelled" }
  | { kind: "failed"; code: number | null; detail: string | null;
      reason: "not_installed" | "copy_failed" | "launch_failed" | "exit_code" | "verify_failed" | "busy" }
                                     // the frontend adds "internal" for a rejected invoke
```

- The dir always comes from the registry, never from the webview.
- Work dir for the `uninstall.exe` copy: the exe's own dir when started with `--relocated` and that
  dir is a `slui-setup-<digits>` session dir (then `/SLUI-CLEANUP` is passed); otherwise the
  session dir (dev runs), without `/SLUI-CLEANUP`.
- Args: `/S [/SLUI-THEME-PACK] [/SLUI-APPDATA] [/SLUI-CLEANUP] _?=<dir>`; `_?=` last, unquoted.
- Before starting NSIS, open SYNCHRONIZE handles to running `slui.exe` processes and their
  `msedgewebview2.exe` descendants (they lock `%LOCALAPPDATA%\com.slui.desktop`).
- Verify: exit 0 **and** uninstall entry `DisplayVersion` gone **and** `<dir>\slui.exe` gone
  **and** (theme pack requested → `<dir>\theme-pack` gone). Else `exit_code` / `verify_failed`.
- User data (`cleaning`, only when requested and verify passed): wait (≤ 10 s) on the handles
  opened above, then `remove_dir_all` both dirs for the current user. Failures do not fail the
  uninstall; they come back as `userDataError`.
- `themePackKept` = `<dir>\theme-pack` still exists.
- Window: title "SLUI 卸载程序", same size / chrome; an initialization script sets
  `window.__SLUI_SETUP_ROLE__ = "uninstall"`. The close guard (`Installing`) is shared.

## Frontend

- `installer/src/main.tsx` renders `UninstallApp` when the role is `uninstall`
  (Tauri: injected global; browser preview: `?role=uninstall`).
- `installer/src/uninstall/`: `model.ts` (pure reducer), `platform.ts` (invoke + mock
  `?role=uninstall&state=installed|theme|none|fail|cancel|userdatafail&running=1`),
  `UninstallApp.tsx`, `screens/` (Confirm, Progress, Done, Error). `Hero`, `WindowControls` and the
  checkbox (moved from `Options.tsx` to `screens/Check.tsx`) are shared.
- Screens: confirm (version chip, 安装于 dir, toggles, running notice, 卸载 / 取消) → progress
  (准备卸载 / 等待授权 / 正在卸载 [/ 清理用户数据]) → done (卸载完成; notices: theme pack kept at
  path, user data error) | error (summary, 退出码, 重试 / 关闭). Not installed → message + 关闭.
  UAC declined → confirm with "已取消授权，未卸载任何内容。".

## Build pipeline (`scripts/build-installer.mjs`)

1. Uninstaller: `tauri build --features uninstaller --config {version, productName: "SLUI Uninstall"}`
   in `installer/` (no payload env) → copy `slui-setup.exe` to `target/release/slui-uninstall.exe`
   (rejected unless written by this run).
2. Write `target/release/slui-installer-hooks.nsh` (UTF-8 BOM; `$` escaped as `$$`).
3. NSIS payload: as today plus `--config {bundle.windows.nsis.installerHooks: <wrapper>}`;
   `--theme-pack` now only adds the define (no `bundle.resources`).
4. Shell: as today; required bytes += uninstaller size + theme pack size.

`--reuse-payload` skips 1–3. `--dev --uninstall` runs `tauri dev --features uninstaller`.

## Compatibility / rollback

- Existing installs (default NSIS uninstaller) get the branded uninstaller on their next update /
  reinstall through the shell (POSTINSTALL rewrites `UninstallString`).
- A plain-NSIS build installed over a branded install resets `UninstallString` to `uninstall.exe`;
  the orphaned `slui-uninstall.exe` is deleted by the always-on POSTUNINSTALL.
- Rollback: revert the hooks, the build script and the feature; installed machines keep working
  because `uninstall.exe` is always present.
- Known gap: `EstimatedSize` is computed before POSTINSTALL, so it excludes the theme pack and the
  uninstaller (cosmetic).
