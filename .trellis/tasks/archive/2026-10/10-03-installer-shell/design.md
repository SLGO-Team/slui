# Design: 安装器外壳

NSIS facts used below (switches, registry view, exit codes, sizes) are in
`research/nsis-payload-facts.md`.

## Boundaries

```
SLUI-Setup-x.y.z.exe  (installer/src-tauri, crate slui-setup, asInvoker, bundle.active=false)
 ├─ main(): WebView2 present? ── no ──► extract payload → ShellExecuteExW(open, no args) → exit
 │                              (classic NSIS wizard; NSIS installs WebView2 itself)
 ├─ React UI (installer/src) ── invoke ──► Rust commands
 └─ install: extract payload → ShellExecuteExW("runas", "/S [/NS /SLUI-STARTMENU [/SLUI-DESKTOP] | /UPDATE] /D=<dir>") → wait → verify
                                         │
                       SLUI_x.y.z_x64-setup.exe (unchanged NSIS payload, embedded)
```

- The shell never writes into the install dir, the registry or shortcuts. NSIS stays the only
  installer engine, so the uninstaller, "Apps & features" entry and a future Tauri updater keep
  working unchanged.
- The shell is not elevated. Only the payload is started with `runas`, so UAC appears when the
  user clicks 安装 / 更新, and SLUI launched from the finish page runs as the normal user.
- Downgrade protection lives in the shell (UI + command guard). The NSIS payload keeps
  `allowDowngrades: true` so the internal package can still be used for manual rollback.

## Layout

```
installer/
├── index.html, vite.config.ts (root=installer, port 1440, outDir installer/dist)
├── tsconfig.json                 # included in npm run lint / build:local
├── src/
│   ├── main.tsx, App.tsx         # screen switch only
│   ├── model.ts                  # pure: classify(detect) + step reducer + validation helpers
│   ├── platform.ts               # the only file calling invoke / dialog; browser mock when !Tauri
│   ├── screens/*.tsx             # Welcome, Location, Progress, Done, Error
│   └── installer.css             # imports shared tokens, own @font-face (bundled Latin fonts)
└── src-tauri/
    ├── Cargo.toml, build.rs, tauri.conf.json, capabilities/default.json, icons → reuse SLUI icon
    └── src/{main.rs, lib.rs, detect.rs, payload.rs, install.rs, webview2.rs}
src/shared/brand-tokens.css       # :root --home-* tokens moved out of home.css (names unchanged)
scripts/build-installer.mjs       # orchestrates payload build + shell build + copy
scripts/installer-model-smoke.mjs # added to npm test
```

- `.taurignore` at repo root lists `installer/` so `npm run tauri …` from the root keeps
  resolving `src-tauri/`. `scripts/build-installer.mjs` runs the Tauri CLI with `cwd=installer`
  **and** `TAURI_APP_PATH=installer/src-tauri` / `TAURI_FRONTEND_PATH=installer` (the ignore file
  also hides the shell from a CLI started inside `installer/`). Verified with `npx tauri info`:
  root → devUrl 1420 (SLUI), with the env vars → devUrl 1440 (shell).
- Tauri crates in `installer/src-tauri/Cargo.lock` are pinned to the main app's versions
  (`tauri` 2.11.5 and its runtime crates; `tauri-plugin-dialog` 2.7.1, which pulls
  `tauri-plugin-fs` 2.5.1 transitively). The Tauri CLI refuses to build when `tauri` and
  `@tauri-apps/api` differ in major/minor. The shell grants no `fs:` or `dialog:` capability;
  the folder picker runs inside the Rust `pick_dir` command.
- `installer/src-tauri/app.manifest` (`asInvoker`, Common-Controls dependency) must be pure
  ASCII: a non-ASCII comment makes the exe fail to start with side-by-side error 14001.
- Fonts: the installer bundles Chakra Petch + Barlow via relative CSS `url()` (~275 KB). CJK uses
  the system Microsoft YaHei; Noto Sans SC (8.6 MB) is not bundled. Only OFL fonts.
- `home.css` keeps its own `@font-face` (absolute `/assets/fonts` paths); only the `:root` token
  block moves to `src/shared/brand-tokens.css`. Home rendering must be pixel-identical.

## Payload embedding

- `scripts/build-installer.mjs [--local]`:
  1. `npm run tauri:build:local` (or production `tauri build --bundles nsis`).
  2. Reads version from `src-tauri/tauri.conf.json`, payload path
     `src-tauri/target/release/bundle/nsis/SLUI_<ver>_x64-setup.exe` (rejected unless written by
     this run), and `slui.exe` size. Required bytes = `slui.exe` size + 4 MiB (uninstaller and
     NSIS bookkeeping).
  3. Runs `tauri build --config {"version":<ver>}` in `installer/` with env `SLUI_SETUP_PAYLOAD`,
     `SLUI_SETUP_VERSION`, `SLUI_SETUP_REQUIRED_BYTES`.
  4. Copies `src-tauri/target/release/slui-setup.exe` (shared target dir, `installer/src-tauri/.cargo/config.toml`) →
     `src-tauri/target/release/bundle/setup/SLUI-Setup-<ver>.exe`.
- `build.rs`: if `SLUI_SETUP_PAYLOAD` is set, checks the file exists, is non-empty and its name
  contains `_<SLUI_SETUP_VERSION>_`, emits `rerun-if-env-changed` / `rerun-if-changed`, records
  the file size as `SLUI_SETUP_PAYLOAD_BYTES`, and embeds the file as the Win32 resource
  `SLUI_PAYLOAD RCDATA "<path>"` via `WindowsAttributes::append_rc_content`. If unset: debug
  builds compile with `cfg(slui_setup_no_payload)` (UI dev; install returns `no_payload`),
  release builds fail with a message pointing to `npm run installer:build:local`.
- **Deviation:** not `include_bytes!` — a ~100 MB byte constant made LLVM run out of memory in
  release builds. `payload.rs` reads the resource with `FindResourceW` / `LoadResource` /
  `LockResource` (module-lifetime mapping, no free needed) and refuses it unless its size equals
  `SLUI_SETUP_PAYLOAD_BYTES`. Signing later works on the final exe.

## Rust commands (contract)

```ts
type Detect = {
  payloadVersion: string;                    // SLUI_SETUP_VERSION
  requiredBytes: number;
  defaultDir: string;                        // FOLDERID_ProgramFiles + "\\SLUI"
  installed: null | { version: string; dir: string; relation: "older" | "same" | "newer" };
                                             // HKLM 64-bit Uninstall\SLUI; relation = installed vs payload (Rust semver)
  appRunning: boolean;                       // slui.exe in process snapshot
};
detect(): Detect
check_dir(dir: string): { normalized: string; freeBytes: number | null;
  error: null | "not_absolute" | "invalid_chars" | "not_local" | "drive_root" | "not_directory" }
pick_dir(current: string): string | null     // tauri-plugin-dialog folder picker; appends "\\SLUI" unless last segment is already SLUI
install(req: { dir: string; mode: "fresh" | "update" | "reinstall"; startMenuShortcut: boolean; desktopShortcut: boolean }, onStage: Channel<"extracting"|"elevating"|"installing">)
  : { kind: "ok"; dir: string }              // dir = registry InstallLocation after the install
  | { kind: "cancelled" }
  | { kind: "failed"; code: number | null; detail: string | null;
      reason: "downgrade" | "mode_mismatch" | "invalid_dir" | "insufficient_space" | "no_payload"
            | "extract_failed" | "launch_failed" | "exit_code" | "verify_failed" | "busy" }
                                             // the frontend adds "internal" for a rejected invoke
launch(): void                               // spawn <registry InstallLocation>\slui.exe non-elevated, then destroy the window
```

- **Deviations from the first draft:** the semver comparison lives only in Rust
  (`installed.relation`), so the UI never compares versions; `check_dir` also reports
  `drive_root` (bare `X:\`) and `not_directory` (a file is in the way); `ok` carries the
  installed dir; `failed` carries machine-readable reason codes plus a system `detail` for
  extract / launch errors; `launch` takes no argument and reads the install dir from the
  registry, so the webview can never make the shell start an arbitrary exe.
- `installed`: read `DisplayVersion` and `InstallLocation` (strip quotes) from
  `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\SLUI` with `RegGetValueW` +
  `RRF_SUBKEY_WOW6464KEY` (no key handle kept open).
  Missing key, missing value or missing `<dir>\slui.exe` → `null` (treated as fresh install).
  HKCU entries (old currentUser builds) are ignored.
- Version compare uses the `semver` crate on both strings; unparsable installed version →
  treated as older (offer update).
- `install` guard: re-runs detect; refuses if installed > payload (`downgrade`); `update`
  requires an older install, and `fresh` / `reinstall` are refused over an older install
  (`mode_mismatch`: an older install is only updated in place). `fresh` / `reinstall` re-run
  `check_dir` and the free-space check on the requested dir.
  Args: fresh/reinstall → `/S /NS` + `/SLUI-STARTMENU` if startMenuShortcut + `/SLUI-DESKTOP` if desktopShortcut + `/D=<normalized dir>`; update →
  `/S /UPDATE /D=<installed.dir>` (the request's dir is ignored). `/D=` last, unquoted. The
  normalized dir never contains `/` or `"`, so NSIS `GetOptions` cannot find a switch inside it.
- Shortcuts: NSIS `/NS` turns off **both** the start-menu and the desktop shortcut (E2E found
  the first draft's `/NS`-for-desktop-only left no start-menu shortcut). The shell always
  passes `/NS` and asks for each shortcut with its own switch; `NSIS_HOOK_POSTINSTALL` in
  `src-tauri/windows/installer-hooks.nsh` (wired via `bundle.windows.nsis.installerHooks`)
  clears `$NoShortcutMode` and calls the template's `CreateOrUpdateStartMenuShortcut` /
  `CreateOrUpdateDesktopShortcut` for `/SLUI-STARTMENU` / `/SLUI-DESKTOP`. Nothing is created
  and then removed. Without `/NS` the hook is a no-op, so plain NSIS runs and a future updater
  behave as before. None of the template's `GetOptions` names (`/ARGS /NS /P /R /UPDATE`) is a
  prefix of the new switches.
- NSIS `.onInit` only applies `RestorePreviousInstallLocation` when no `/D=` was given, so
  `$INSTDIR` (and the `InstallLocation` it writes) is exactly the `/D=` value.
- Elevation: `ShellExecuteExW` verb `runas`, `SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC`,
  owner = shell window; `ERROR_CANCELLED` (1223) → `cancelled`. Runs on a blocking worker thread
  with COM initialised (and uninitialised) around the call; waits on the handle,
  `GetExitCodeProcess`, closes the handle on drop.
- Success is decided by the source of truth, not the exit code alone: exit code 0 **and**
  re-detected `installed.version == payloadVersion` **and** `installed.dir` equals the target dir
  (case-insensitive) **and** `<dir>\slui.exe` exists. Otherwise `failed` with the exit code.
- Temp: one dir `%TEMP%\slui-setup-<pid>\` holds the payload and the WebView2 user data
  (`data_directory`), so the shell leaves nothing under `%LOCALAPPDATA%`. After the event loop
  ends, `main` waits up to 10 s for the shell's own `msedgewebview2.exe` descendants (they hold
  the user data folder; SLUI launched from the finish page is not waited for), then removes the
  dir. Anything left (timeout, crash, classic mode) is removed by the next run: only real
  directories (not links) directly in `%TEMP%` named `slui-setup-<digits>` whose pid is not alive.
- Every way out of the shell must destroy the window (close button → `CloseRequested`,
  `launch` → `window.destroy()`), never `AppHandle::exit`. E2E trace: with `app.exit(0)` the
  six WebView2 processes stayed alive through the whole 10 s wait and the 26 MB user data was
  left in `%TEMP%`; with `destroy()` the shell exits in < 1 s and the dir is removed.

## WebView2 gate

- `main()` calls `tauri::webview_version()` before building the app. `Err` (or env
  `SLUI_SETUP_FORCE_CLASSIC=1`, kept for testing) → extract payload, `ShellExecuteExW("open")`
  with no arguments (payload manifest triggers UAC; user sees the classic wizard), exit 0.
  If extraction or launch fails → native `MessageBoxW` with the error, exit 1; a declined UAC
  prompt exits 1 silently. The extracted package stays in the session dir while the wizard
  runs from it; the next shell run removes it.

## Frontend state

- `classify(detect)` → `fresh | update | same | newerInstalled`.
- Steps: `welcome → location? → progress → done | error`. `location` only reachable from
  fresh/reinstall via "自定义安装位置". Update never shows location.
- Welcome shows the running-app notice "安装时会关闭正在运行的 SLUI" when `appRunning` and the
  mode will install.
- Location: install button disabled while `check_dir` reports an error or
  `freeBytes < requiredBytes`; free space shown in GB.
- Progress: indeterminate bar + stage text (准备安装文件 / 等待授权 / 正在安装). Close button
  disabled while installing.
- `cancelled` returns to the previous screen with an inline notice; `failed` → Error screen
  (summary + exit code, 重试 / 关闭).
- Browser preview (no Tauri): `platform.ts` returns a mock selected by
  `?state=fresh|update|same|newer|fail|cancel` (`&running=1` adds the running-app notice) for
  visual checks; `isTauri()` picks the real platform, so the mock is never reachable inside Tauri.

## Compatibility / rollback

- Main app, NSIS config and release flow are unchanged except: `home.css` token extraction,
  root `.taurignore`, new npm scripts. Rolling back = delete `installer/`, the scripts and the
  token file move.
- Not signed (no certificate today); SmartScreen warning is the same as for the NSIS package.
