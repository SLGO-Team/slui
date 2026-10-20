# Auto-update — implementation plan

Branch: `feat/auto-update`. One PR (UI changes → waits for the user's visual review before merge).

## 0. User prerequisites (before step 6 / before the first release with the updater)

- [x] Generate the updater key pair outside the repo (password-protected):
      `npx tauri signer generate -w <path outside the repo>\slui-updater.key`
- [x] Backup: skipped by the maintainer's choice (10-20). Losing the key only means a new key pair and one
      manual reinstall for every player.
- [x] Add `release` environment secrets `TAURI_SIGNING_PRIVATE_KEY` (key file contents) and
      `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- [x] Public key committed to `tauri.conf.json` (10-20). The key was generated and the secrets were
      uploaded by the maintainer's own script; the private key never passed through the agent.

## 1. Contract — `packages/protocol`

- [x] `UpdateManifest` type, `UPDATE_PATH`, `UPDATE_PLATFORM`, `parseUpdateManifest`, `compareReleaseVersions`; `v0/update-manifest.{schema,example}.json`; README "Update manifest".
- [x] Example fixture + rejection cases (min_version > version, pre-release, unknown key, other platform, http URL, empty signature, bad date) in
      `scripts/contract-smoke.mjs`.

## 2. SLUI updater — `src-tauri`

- [x] Add `tauri-plugin-updater = "2"`; re-check the published API against
      `research/tauri-updater-plugin.md` (research read the main branch).
- [x] `tauri.conf.json`: `plugins.updater { pubkey, endpoints: [] }`;
      `tauri.local.conf.json`: `dangerousInsecureTransportProtocol: true`.
- [x] `updater.rs`: state, loop with jitter, `updater_start`, `updater_check_now`,
      `get_update_state`, `updater_install`, event emission, temp cleanup, tray item.
- [x] Unit tests: `min_version` comparison from raw JSON, state transitions (same version stays
      Ready, failure keeps `required`), temp path naming, shell argument line.
- [x] `cargo hakari generate && cargo hakari manage-deps`.

## 3. Branded shell — `installer/`

- [x] `main.rs`: parse `--update --after-pid <pid>`; `wait_for_pid`.
- [x] `lib.rs`: unattended flag via `initialization_script`.
- [x] `App.tsx` / `model.ts`: unattended path (detect → Progress or Failure), Cancelled screen with
      retry / open SLUI, Failure + open SLUI.
- [x] `scripts/installer-model-smoke.mjs`: unattended classification cases; Rust tests for args.

## 4. Frontend — `src/`

- [x] `src/platform/updater.ts` adapter (+ browser no-op).
- [x] `src/app/updateModel.ts` + `scripts/update-model-smoke.mjs` (added to `npm test`).
- [x] Update UI (revised 10-20 after visual review): title-bar button (`TitleBar.tsx`), 关于 group
      (`AboutSettings.tsx`), required banner (`UpdateBanner.tsx`); `HomeApp.tsx` start + subscribe.
      The first cut's 「版本」 tile in `StatusBar.tsx` was removed.
- [x] `src/App.tsx`: gate the client session on `required`; home server tile 「需要更新」.

## 5. Release workflow

- [x] `release.yml`: key presence check, `tauri signer sign`, upload exe + `.sig`.

## 6. Spec / docs

- [x] `.trellis/spec/frontend/system-boundaries.md`: update manifest contract, endpoint, fail-open
      rule, Rust-owned update state.
- [x] README: short "updates" note if user-facing docs mention installation.

## Validation

```bash
npm run lint
npm test
cargo test --workspace --manifest-path src-tauri/Cargo.toml
(cd src-tauri && cargo hakari generate --diff && cargo hakari manage-deps --dry-run)   # as in ci.yml
```

Local end-to-end (manual, not committed):

1. Build and install version V locally with the updater (`npm run installer:build:local`,
   throwaway key), run the local control plane.
2. Temporarily bump the version to V+1 in the release-please `extra-files` (do not commit), build
   again, sign with `npx tauri signer sign`, serve the exe over `http://127.0.0.1`, point a
   manifest at it (local control plane endpoint or a stub server on 7800 if the backend task is
   not done yet).
3. Walk AC1–AC6: background download, tile + tray, update via tile and via tray, UAC decline →
   retry / open SLUI, `min_version` gating, tampered signature, endpoint down / 204.
4. `git checkout` the version files.

## Review gates / rollback points

- After step 2: `cargo test` + a dry check against a stub manifest (no install).
- After step 4: screenshots of the home window states for the user's visual review.
- Each step is a separate commit; reverting the frontend + updater commits removes the feature.

## Follow-up sessions (other repos)

- `../slgo-backend`: `GET /v0/update`.
- `../slgo-deploy`: `publish-slui` + static download route.

## Handoff (10-19)

Worktree used: `<main checkout>/.claude/worktrees/auto-update` (branch `feat/auto-update`).

**Changed (WIP commit, never compiled):**
- `src-tauri/Cargo.toml` / `Cargo.lock`: `tauri-plugin-updater = { version = "2", default-features = false,
  features = ["rustls-tls", "system-proxy"] }` (resolved 2.12.0, the newest compatible with the locked
  tauri 2.11.5; `zip` only reads Tauri v1 archives), `semver = "1"`, `base64 = "0.22"`.
- `src-tauri/tauri.conf.json`: `plugins.updater { pubkey, endpoints: [] }`. **The pubkey is a throwaway dev
  key** whose private half is not in the repo (for local e2e generate a new throwaway pair with
  `npx tauri signer generate` and swap the pubkey); replace it with the user's key (step 0) before merge. *(Done 10-20.)*
- `src-tauri/tauri.local.conf.json`: `plugins.updater.dangerousInsecureTransportProtocol: true`.
- `src-tauri/src/updater.rs` (new): pure `Machine` (state transitions), `Updater` managed state, `TrayItem`
  (「更新到 X.Y.Z」 inserted at menu index 2 while Ready), commands `updater_start` / `updater_check_now` /
  `get_update_state` / `updater_install`, event `slui://update-state`, loop (check, then 6 h + 0–30 min
  jitter, `Notify` wake for check-now), download with progress throttled to 250 ms, temp dir
  `%TEMP%\slui-update-<16 hex>\SLUI-Setup-<v>.exe`, spawn `--update --after-pid <pid>` then `app.exit(0)`,
  startup cleanup `remove_old_installers`, and 13 unit tests.
- `src-tauri/src/lib.rs`: `mod updater`, plugin registered (`tauri_plugin_updater::Builder::new().build()`),
  `Updater` managed in `setup` (version from `package_info()`), cleanup thread, tray item + menu event,
  four commands in `invoke_handler`.

**Half-done: step 2, `updater.rs` + unit tests + hakari.** Code is written but `cargo test --workspace` was
never run (first compile in the fresh worktree target was stopped). Next: compile, fix errors, run tests,
then `cargo hakari generate && cargo hakari manage-deps`, then tick the remaining step-2 boxes.

**Differences from design.md / research note (published 2.12.0):**
- `Update::download()` does not inherit the check's `timeout` (`Update.timeout` is `None`). `updater.rs`
  sets `configure_client(connect_timeout 15 s, read_timeout 60 s)`, which applies to check and download,
  plus `timeout(30 s)` for the check only.
- 2.12 adds `require_signed_version` (signature's trusted comment must carry `version:`), but
  `tauri signer sign` (CLI 2.11.4) writes only `timestamp:<n>	file:<name>`, so it cannot be enabled.
  Instead `updater.rs` rejects (as `signature`) a manifest whose signature's trusted `file:` is not
  `SLUI-Setup-<manifest version>.exe` — the comment is covered by the verified signature, so this blocks a
  manifest pairing a higher version with an older signed installer. Consequence: the signed file must keep
  the exact name `SLUI-Setup-X.Y.Z.exe` (CI and slgo-deploy must sign/copy that name; theme-pack variants are
  not update artifacts).
- Non-2xx endpoint responses (e.g. 404 before the backend endpoint ships) come back as
  `Error::ReleaseNotFound` → `failed { network }` (quiet tile failure), not idle.
- `.target("windows-x86_64")` is set explicitly so the plugin looks up exactly `UPDATE_PLATFORM`.
- Design details chosen: a re-check while Ready keeps showing Ready (no flicker, tray item stays); a failed
  re-check keeps Ready; 204 / not-newer drops a verified update (withdrawal); a launch failure keeps the
  verified bytes so 「重试」 → check → same version → Ready without re-download.

**Step 3 notes (not started):** plan was `main.rs` parses `--update --after-pid <pid>` for the setup role;
wait for the pid inside the `install` command (Progress screen visible meanwhile) via
`payload::ProcessSet::open(vec![pid]).wait(15 s)`, only if that pid's name is `slui.exe`
(`detect::process_names`); `initialization_script("window.__SLUI_SETUP_UNATTENDED__ = true;")`; model gets
`unattended`, screens `cancelled` (重试 / 打开 SLUI) and `unavailable` (same / newer / not installed), Ok →
auto `launch`.

**Next concrete action:** in the worktree, `cd src-tauri && cargo test --workspace` and fix compile errors in
`updater.rs` / `lib.rs`.


## Status (10-19, second session)

Steps 1–6 done (commits on `feat/auto-update`). Validation commands above all pass.

**Signing key (done 10-20):** `plugins.updater.pubkey` is the maintainer's real key; the `release`
environment has `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Local end-to-end walk (throwaway key pair outside the repo, stub control plane on
`http://127.0.0.1:7800`, `npm run installer:build:local` at 0.7.1 then 0.7.0, the 0.7.0 `slui.exe`
run uninstalled, DevTools protocol on its WebView2 for state and screenshots):

- AC1: background download + verify; tile 「0.7.1 可用 · 更新并重启」. Tray item not inspected
  visually (no desktop automation); its sync code ran without errors.
- AC4 gating: `min_version` 0.7.1 → home server tile and version tile 「需要更新」, the overlay stops
  route requests; back to `min_version` 0.6.0 → the overlay reconnects.
- AC5: altered bytes, another key, and an older installer signed under its own name all end as
  `failed { signature }`; nothing written to `%TEMP%`.
- AC6: 204 → 已是最新版本; connection refused and 404 → quiet 检查更新失败 + 重试; the session keeps
  routing throughout.
- Hand-over without UAC: a 0.7.0 payload served as 0.7.1 → 「更新并重启」 writes
  `%TEMP%\slui-update-<hex>\SLUI-Setup-0.7.1.exe`, starts it with `--update --after-pid`, SLUI exits 0,
  the shell opens unattended on 「无法更新 · 已安装此版本的 SLUI」.
- **AC2 / AC3 / AC4 install: passed 10-20 on the dev PC, with the user at the UAC prompt.** These were
  local test builds of the current PR code (f22057a) signed with a throwaway key, served by a local stub on
  `127.0.0.1:7800`:
  - AC2: 0.7.0 → 0.7.1. The title-bar button appeared after the background download; one UAC prompt;
    SLUI reopened as 0.7.1.
  - AC4 + AC3: the stub required 0.7.2. The red home banner appeared; declining UAC showed 重试 / 打开 SLUI;
    重试 installed 0.7.2 without a second download.
  - These runs replaced the installed SLUI with a local-backend test build. Reinstall a release build afterwards.
