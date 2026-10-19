# Auto-update

## Goal

Players run the latest SLUI without hunting for installers: SLUI finds a newer release, downloads
and verifies it in the background, and installs it after one click and one UAC prompt, reopening
on its own. Releases that break compatibility can require the update.

## Background (repository evidence)

- Windows-only Tauri 2 app; the NSIS package is `installMode: perMachine`
  (`src-tauri/tauri.conf.json`) under Program Files, so **every update needs one UAC elevation**.
- Distribution artifact: the branded installer `SLUI-Setup-<version>.exe` (~34 MB) = shell
  `slui-setup.exe` + overlay with the NSIS package (~25 MB) (`scripts/build-installer.mjs`,
  `installer/src-tauri/src/overlay.rs`). The shell runs `asInvoker` and already has an Update mode:
  installed version from the HKLM uninstall entry (`installer/src-tauri/src/detect.rs`), package run
  elevated with `/S /UPDATE /D=<existing dir>` (`installer/src-tauri/src/install.rs:88`),
  result verification, and a non-elevated SLUI launch (`launch` command).
- `$INSTDIR\theme-pack` is not a Tauri resource, so updates keep it
  (`src-tauri/windows/installer-hooks.nsh`).
- Releases: release-please → draft GitHub Release; `.github/workflows/release.yml` builds and
  attaches `SLUI-Setup-X.Y.Z.exe` (environment `release`); a maintainer publishes the draft.
  `../slgo-deploy` can also build production installers locally. The repo is public: no
  production domain or ops details may be committed (`scripts/public-content-check.mjs`).
- The control plane (`../slgo-backend/apps/control-plane`) serves only `POST /v0/route` and
  `/healthz`; SLUI reads its URL from `VITE_CONTROL_PLANE_URL` via `readBackendConfig`
  (`src/platform/backend.ts`; `mock` mode has none). Protocol mismatch is already rejected with
  `unsupported-protocol`, shown as 「版本不兼容」 (`src/app/home/status.ts:22`).
- Players and the central host are in mainland China, where GitHub downloads are unreliable.
- SLUI lives in the tray; the home window hides on close; the client session runs in the overlay
  window (`src/App.tsx:169`); the home window shows three status tiles (`src/app/home/StatusBar.tsx`).
- No Authenticode signing exists; SLUI ≤ 0.7.x has no updater.
- `tauri-plugin-updater` verifies a minisign signature during `download()` and exposes the raw
  manifest JSON; see `research/tauri-updater-plugin.md`.

## Requirements

- **R1 One-click update.** A newer release is downloaded and signature-verified in the background.
  When it is ready, one click on "update and restart" → SLUI exits → the branded installer runs
  the update unattended (one UAC prompt) → SLUI reopens in the same directory with the same
  shortcuts and theme pack. The install mode stays perMachine (notify-only and a perUser migration
  were rejected).
- **R2 Update source.** The control plane serves the update manifest (version, download URL,
  signature, optional notes and `min_version`) at a new endpoint. The installer file is served by
  the central host. A `../slgo-deploy` publish step copies `SLUI-Setup-X.Y.Z.exe` and its
  signature from the published GitHub Release to the central host and writes the manifest. GitHub
  Releases stay the canonical public artifact, not the update download path.
- **R3 Minimum version.** When the running version is below the manifest's `min_version`, SLUI
  does not connect to servers; the home window shows "update required" and the update action
  (enabled once the download is verified). The server-side hard gate stays `protocol_version`;
  the route request carries no client version.
- **R4 Timing and surfaces.** Check at startup and every 6 hours (with jitter) while running.
  Surfaces: a version tile in the home window's status section and a tray menu item
  「更新到 X.Y.Z」 when ready. The in-game overlay never shows update UI. Installation starts only
  on a user click.
- **R5 Branded install UI.** The update installs through the branded shell, not the stock NSIS
  window: it skips the wizard, shows its progress screen, and on UAC decline or failure offers
  retry or reopening the current SLUI, so the user is never left without SLUI.
- **R6 Integrity.** Only an installer whose minisign signature matches the public key built into
  SLUI is ever written to disk and run. The release workflow signs the branded installer with a
  key held in the `release` environment and attaches the `.sig` to the release.
- **R7 Failure tolerance.** An unreachable or empty update endpoint never blocks SLUI (fail-open):
  no error dialogs, the version tile shows the failure quietly, and the next check retries. A
  signature or download failure never installs anything.

## Acceptance Criteria

- [x] AC1 (R1, R4) With a manifest offering a higher version, a fresh SLUI start downloads it
      without user action; the home version tile then shows the new version with
      「更新并重启」, and the tray menu shows 「更新到 X.Y.Z」.
- [ ] AC2 (R1, R5) Clicking either action closes SLUI, the branded installer shows its progress
      screen, UAC appears once, and afterwards the new version runs (non-elevated) from the same
      directory; shortcuts and `theme-pack` are unchanged.
- [ ] AC3 (R5) Declining UAC leaves the installer on a screen offering retry and reopening SLUI;
      reopening starts the old version.
- [ ] AC4 (R3) With `min_version` above the running version, the overlay's client session does not
      connect, the home window shows the update as required, and the update action works as in AC2.
- [x] AC5 (R6, R7) A manifest whose signature does not match (wrong key or altered file) never
      installs; the tile shows a quiet failure and SLUI keeps working.
- [x] AC6 (R7) With the endpoint unreachable or answering 204, SLUI connects and plays normally and
      shows no update UI beyond the version tile.
- [ ] AC7 (R6) The release workflow fails when the signing key secret is missing and otherwise
      attaches `SLUI-Setup-X.Y.Z.exe.sig` next to the installer.
- [x] AC8 `npm run lint`, `npm test`, `cargo test --workspace` (in `src-tauri`) and the hakari
      check pass; the manifest contract has parser fixtures in the smoke tests.

## Out of Scope

- The control-plane endpoint (`../slgo-backend`) and the publish command + static download route
  (`../slgo-deploy`): separate tasks in those repos, built against this task's manifest contract.
- Authenticode code signing; a user setting to turn auto-update off; delta updates; downgrades or
  rollback through the updater (rollback = publish a fixed higher version or withdraw the manifest);
  update UI inside the in-game overlay; non-Windows platforms.
- Updating SLUI ≤ 0.7.x: those versions have no updater and need one manual install.
