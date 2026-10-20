# tauri-plugin-updater on Windows (source read 2026-10-19)

Source: `tauri-apps/plugins-workspace`, `plugins/updater/src/updater.rs` (main branch).

## Check

- `Updater::check()` requests the configured endpoints (`{{current_version}}`, `{{target}}`,
  `{{arch}}` placeholders), accepts the static (`platforms` map) or dynamic
  (`version`/`url`/`signature`) JSON format, 204 = no update.
- The full response is kept as `Update::raw_json`, so extra fields (e.g. `min_version`) are
  readable without forking the plugin. `Updater::restore_update(raw_json)` rebuilds an `Update`
  without a request.
- Default comparator: an update exists when the remote version is greater than the current one;
  a custom `version_comparator` can replace it.

## Download

- `Update::download(on_chunk, on_finish) -> Vec<u8>` streams the artifact into memory and then
  calls `verify_signature` (minisign, public key from `plugins.updater.pubkey`) before returning.
  A bad signature is an error; no bytes reach the caller.
- Signing: `bundle.createUpdaterArtifacts: true` makes `tauri build` emit `<artifact>.sig` using
  `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`); the build fails when the key is missing, so it must
  only be enabled where the key exists. `tauri signer sign <file>` signs an arbitrary file.

## Install (Windows, NSIS)

- `Update::install(bytes)` writes the NSIS exe to temp, runs the optional `on_before_exit` hook,
  then `ShellExecuteW("open", setup.exe, args)` and **`std::process::exit(0)`** right away.
- Args: `/P` (passive) or `/S` (quiet) per `windows.installMode`, then `/UPDATE`, then (restart
  enabled) `/R /ARGS <current args>`, then custom `installer_args`.
- With a perMachine package the NSIS manifest requests elevation, so `open` raises UAC. A declined
  UAC makes `ShellExecuteW` fail; `install` returns an error and the app keeps running.
- Passive mode shows the stock NSIS progress window, not our branded shell.
- The Tauri NSIS template relaunches the app un-elevated after a silent/passive install when `/R`
  is passed.

## Consequence for SLUI

Two viable install paths:

1. Plugin end to end: artifact = the internal NSIS package (~25 MB, already carries
   `slui-uninstall.exe` via the hooks wrapper). Least code; unbranded NSIS progress window.
2. Plugin for check + download + signature only; SLUI writes the verified bytes of the branded
   `SLUI-Setup-X.Y.Z.exe` (~34 MB) to temp and starts it in an unattended update mode; the shell
   does UAC, install, verification, error UI and relaunch with its existing Update-mode code.
