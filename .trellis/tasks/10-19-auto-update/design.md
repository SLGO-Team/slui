# Auto-update — design

## Overview

```text
GitHub Release (CI)                    ../slgo-deploy (ops PC)             central host
SLUI-Setup-X.Y.Z.exe + .sig  ──fetch──► publish-slui ──upload exe──► static download route
                                                     ──write──────► manifest file ──► control plane GET /v0/update

SLUI (tray app)                                                   branded shell (SLUI-Setup-X.Y.Z.exe)
updater.rs: check ─► download + minisign verify ─► ready ─click─► write to %TEMP% ─► spawn --update ─► SLUI exits
                                                                   wait for SLUI pid ─► RunAs NSIS /S /UPDATE ─► verify ─► launch SLUI
```

Rust owns the update state (it survives hidden windows and drives the tray); the home window
renders it; the overlay only reads `required` to gate the client session.

## 1. Manifest contract (`packages/protocol`, MIT)

The Tauri updater **static** format plus one extension field, so `tauri-plugin-updater` parses it
directly and the control plane can validate it with the shared parser.

```json
{
  "version": "0.8.0",
  "min_version": "0.7.0",
  "notes": "optional plain text",
  "pub_date": "2026-10-20T08:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://<central host>/<path>/SLUI-Setup-0.8.0.exe",
      "signature": "<contents of SLUI-Setup-0.8.0.exe.sig>"
    }
  }
}
```

- Endpoint: `GET {controlPlaneUrl}/v0/update` → `200` manifest, or `204` when nothing is
  published. The plugin compares versions itself, so the endpoint needs no query parameters.
- `@slgo/protocol` gets `UpdateManifest`, `UPDATE_PATH = "/v0/update"`,
  `UPDATE_PLATFORM = "windows-x86_64"`, and `parseUpdateManifest(raw)` (strict keys, semver strings,
  `min_version <= version`, https URL, non-empty signature). SLUI itself does not need the TS parser
  (Rust parses); it exists for the control plane and the contract smoke test with fixtures.
- Versions are plain `X.Y.Z` (release-please); no pre-release channels.

## 2. SLUI updater (`src-tauri/src/updater.rs`)

Dependencies: `tauri-plugin-updater = "2"` (Rust API only; no JS package, no capability needed for
our own commands). `tauri.conf.json` gets `plugins.updater.pubkey` (public, committed) and
`"endpoints": []`. `cargo hakari generate && cargo hakari manage-deps` afterwards.

State (serialized to the frontend, camelCase):

```text
UpdateState {
  current: String,                  // app version
  phase: Idle | Checking | Downloading { version, received, total? } | Ready { version, notes? }
       | Installing | Failed { reason: "network" | "signature" | "launch" }
  required: Option<String>,         // min_version when current < min_version
  lastChecked: Option<epoch ms>,
}
```

- `updater_start(control_plane_url)` command: called by the home window on startup with the URL
  from `readBackendConfig` (mock mode does not call it). Idempotent; the first call spawns the loop.
  Endpoint = `{url}/v0/update`, built with `app.updater_builder().endpoints(..).timeout(30s)`.
- Loop: check now, then every 6 h + random 0–30 min jitter. `check()`:
  - `None` → `Idle` (and `required = None`: remote ≤ current implies min ≤ current).
  - `Some(update)` → `required` from `update.raw_json["min_version"]` (semver compare); if the same
    version is already `Ready`, keep it; otherwise `Downloading` → `update.download()` (signature
    verified inside the plugin) → bytes kept in memory (`Arc<Vec<u8>>`, ~34 MB) → `Ready`.
  - Errors → `Failed`, logged with `eprintln!("SLGO: update …")`; next tick retries. `required`
    keeps its last known value within the process; at startup it starts as `None` (fail-open).
- `updater_check_now()` command: triggers an immediate check (used by the tile's retry).
- `get_update_state()` command + event `slui://update-state` emitted to all windows on change.
- `updater_install()` command and the tray item share one function:
  1. only in `Ready`; set `Installing`;
  2. create a fresh `%TEMP%\slui-update-<random>\` directory, write `SLUI-Setup-<version>.exe`;
  3. spawn it as the current user with `--update --after-pid <own pid>`;
  4. `app.exit(0)` (tray icon removed cleanly).
  A spawn failure → `Failed { launch }`, SLUI keeps running.
- Startup housekeeping: best-effort delete of `%TEMP%\slui-update-*` left by earlier updates.
- Tray: a menu item 「更新到 X.Y.Z」 inserted when `Ready`, removed otherwise.
- Plugin transport: production requires https (plugin default). `tauri.local.conf.json` sets
  `plugins.updater.dangerousInsecureTransportProtocol: true` so local e2e can use
  `http://127.0.0.1:7800`.

## 3. Branded shell unattended update (`installer/`)

- CLI: `slui-setup.exe --update --after-pid <pid>` (parsed in `installer/src-tauri/src/main.rs`).
  Ignored for the uninstall role. Passed to the webview through `initialization_script`
  (`window.__SLUI_SETUP_UNATTENDED__ = true`), like the existing role flag.
- Rust: a `wait_for_pid(pid, 15 s)` before installing (NSIS closes a leftover `slui.exe` anyway).
- Frontend flow (`installer/src/App.tsx`, `model.ts`): `detect()` → if `installed.relation ===
  "older"` go straight to Progress with `mode: "update"` (no Welcome/Options); otherwise the
  Failure screen ("已是最新版本" / "未检测到已安装的 SLUI") with a button to open SLUI.
- Outcomes: `Ok` → existing `launch` (non-elevated SLUI) and close; `Cancelled` (UAC declined) →
  screen with 「重试」 and 「打开 SLUI」 (relaunch current); `Failed` → existing Failure screen plus
  「打开 SLUI」.
- No visual redesign: existing Progress/Failure components; one new small cancelled state. Visual
  review at PR time.

## 4. Frontend

- `src/platform/updater.ts`: Tauri adapter (`invoke`/`listen`) + a browser no-op for vite dev.
- `src/app/updateModel.ts` (pure, node-smoke-tested): `UpdateState` → tile view
  `{ tone, value, detail?, action?: "install" | "retry" }`, e.g.
  - Idle: `0.8.0` · 「已是最新」 (muted/ok)
  - Downloading: 「正在下载 0.9.0 · 45%」
  - Ready: 「0.9.0 可用」 + 「更新并重启」
  - Required: tone error, 「需要更新到 0.9.0」 + action when ready
  - Failed: 「检查更新失败」 + 「重试」 (muted, no dialog)
- `StatusBar.tsx`: fourth tile 「版本」 (`.home-status` grid gains a column; layout checked at
  960×620 and the 820 min width).
- `HomeApp.tsx`: calls `updater_start` once with the real backend URL; subscribes to state.
- Overlay gating (`src/App.tsx`): while `required` is set the client session is not started (or is
  stopped); the home server tile shows 「需要更新」 instead of a connection error. Implemented in the
  app layer (`clientSession` dependencies), not in `@slgo/protocol`'s `ConnectionStatus`.

## 5. Release signing (`.github/workflows/release.yml`)

After `npm run installer:build`:

```bash
npx tauri signer sign "src-tauri/target/release/bundle/setup/SLUI-Setup-$VERSION.exe"
# env: TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD (release environment secrets)
gh release upload "$TAG" "…/SLUI-Setup-$VERSION.exe" "…/SLUI-Setup-$VERSION.exe.sig" --clobber
```

The job fails with `::error::` when the key secret is empty (same pattern as `CONTROL_PLANE_URL`).
`createUpdaterArtifacts` stays off: we sign the branded exe, not the internal NSIS package, and
local / slgo-deploy builds need no key (they are just not update-eligible).

## 6. Cross-repo follow-ups (separate tasks)

- `../slgo-backend`: control plane `GET /v0/update` serving a manifest file (path from env),
  validated with `parseUpdateManifest` on load; `204` when absent/invalid (logged).
- `../slgo-deploy`: `deploy publish-slui <version> [--min-version X.Y.Z]` — on the ops PC download
  the release's exe + `.sig` from GitHub, upload the exe to the central host's static route, write
  the manifest; plus the Caddy download route. Order: backend endpoint and deploy step can ship
  any time after the contract lands; SLUI tolerates 404/204.

## Compatibility and risks

- ≤ 0.7.x: no updater → one manual install of the first updater release.
- The public key is baked into every release. **Losing the private key means no further verified
  updates** (manual reinstall needed); keep an offline backup. Rotation = ship a new pubkey inside
  an update signed with the old key.
- No downgrades (plugin comparator). Bad release → publish a fixed higher version, or withdraw the
  manifest (204) to stop distribution.
- UAC still shows "unknown publisher" (no Authenticode), as with manual installs today.
- Central host bandwidth: every player downloads ~34 MB per release; the 6 h interval + jitter
  spreads the load. If it becomes a problem, the manifest URL can point elsewhere without a client
  change.
- Mid-game update: SLUI and the overlay disappear for ~20 s; only on the player's own click.
- Memory: ~34 MB held while `Ready`; negligible next to the two WebView2 processes.

## Rollback

Each part is additive. Disabling distribution needs no client release (manifest 204). Reverting
the client change removes the plugin, commands and tile; the shell's `--update` flag is ignored by
older SLUI versions.
