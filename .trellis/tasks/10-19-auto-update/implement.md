# Auto-update — implementation plan

Branch: `feat/auto-update`. One PR (UI changes → waits for the user's visual review before merge).

## 0. User prerequisites (before step 6 / before the first release with the updater)

- [ ] Generate the updater key pair outside the repo (password-protected):
      `npx tauri signer generate -w <path outside the repo>\slui-updater.key`
- [ ] Back it up offline (losing it ends verified updates).
- [ ] Add `release` environment secrets `TAURI_SIGNING_PRIVATE_KEY` (key file contents) and
      `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- [ ] Hand over the **public** key (`.key.pub` contents) for `tauri.conf.json`. Until then a
      throwaway dev key pair is used locally and must be replaced before merge.

## 1. Contract — `packages/protocol`

- [x] `UpdateManifest` type, `UPDATE_PATH`, `UPDATE_PLATFORM`, `parseUpdateManifest`, `compareReleaseVersions`; `v0/update-manifest.{schema,example}.json`; README "Update manifest".
- [x] Example fixture + rejection cases (min_version > version, pre-release, unknown key, other platform, http URL, empty signature, bad date) in
      `scripts/contract-smoke.mjs`.

## 2. SLUI updater — `src-tauri`

- [ ] Add `tauri-plugin-updater = "2"`; re-check the published API against
      `research/tauri-updater-plugin.md` (research read the main branch).
- [ ] `tauri.conf.json`: `plugins.updater { pubkey, endpoints: [] }`;
      `tauri.local.conf.json`: `dangerousInsecureTransportProtocol: true`.
- [ ] `updater.rs`: state, loop with jitter, `updater_start`, `updater_check_now`,
      `get_update_state`, `updater_install`, event emission, temp cleanup, tray item.
- [ ] Unit tests: `min_version` comparison from raw JSON, state transitions (same version stays
      Ready, failure keeps `required`), temp path naming, shell argument line.
- [ ] `cargo hakari generate && cargo hakari manage-deps`.

## 3. Branded shell — `installer/`

- [ ] `main.rs`: parse `--update --after-pid <pid>`; `wait_for_pid`.
- [ ] `lib.rs`: unattended flag via `initialization_script`.
- [ ] `App.tsx` / `model.ts`: unattended path (detect → Progress or Failure), Cancelled screen with
      retry / open SLUI, Failure + open SLUI.
- [ ] `scripts/installer-model-smoke.mjs`: unattended classification cases; Rust tests for args.

## 4. Frontend — `src/`

- [ ] `src/platform/updater.ts` adapter (+ browser no-op).
- [ ] `src/app/updateModel.ts` + `scripts/update-model-smoke.mjs` (added to `npm test`).
- [ ] `StatusBar.tsx` version tile, `home.css` grid; `HomeApp.tsx` start + subscribe.
- [ ] `src/App.tsx`: gate the client session on `required`; home server tile 「需要更新」.

## 5. Release workflow

- [ ] `release.yml`: key presence check, `tauri signer sign`, upload exe + `.sig`.

## 6. Spec / docs

- [ ] `.trellis/spec/frontend/system-boundaries.md`: update manifest contract, endpoint, fail-open
      rule, Rust-owned update state.
- [ ] README: short "updates" note if user-facing docs mention installation.

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
