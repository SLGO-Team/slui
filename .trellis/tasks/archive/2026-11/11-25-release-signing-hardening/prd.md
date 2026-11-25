# Harden the release workflow: verify updater signature, isolate signing

Source: follow-ups left by the 2026-11-25 cloud review (item 1). Done on Windows because the result
must be checked against the real `tauri signer` output.

## Problems (confirmed on main 96b09e8)

a) `.github/workflows/release.yml` only checks that `SLUI-Setup-<v>.exe.sig` is non-empty. A
   signing key in the `release` environment that does not match `plugins.updater.pubkey` in
   `src-tauri/tauri.conf.json` would publish a release every installed SLUI rejects
   (`failed { signature }`).
b) One job holds `contents: write`, the checkout token persisted in `.git/config`, and
   `TAURI_SIGNING_PRIVATE_KEY`, and runs `npm ci` (dependency install scripts) and the whole build.
   Third-party actions (`googleapis/release-please-action@v5`, `Swatinem/rust-cache@v2`) are
   referenced by movable tags.
c) The release does not wait for CI on the release commit and runs no tests or version check of
   its own. ci.yml also cancels an in-progress main run when the next commit lands, so the
   release commit's CI result could be lost.

## Requirements

- A Node script (built-in modules only) verifies a `tauri signer sign` signature the way SLUI does:
  minisign key id and Ed25519 signature (BLAKE2b-512 prehash for `ED`) against the pubkey from
  `src-tauri/tauri.conf.json`, the global signature over the trusted comment, and the trusted
  comment (third decoded line, as `updater.rs::signed_file_name` reads it) carrying
  `file:SLUI-Setup-<version>.exe` and `version:<version>`. Any mismatch exits non-zero.
- `npm test` covers the script with a committed fixture signed by a throwaway test key
  (pass case plus wrong key, tampered file, wrong version, wrong file name).
- release.yml split into jobs:
  - `build`: `contents: read`, checkout with `persist-credentials: false`, `npm ci`, `npm run lint`,
    `npm test` (includes `version-check`), a check that `package.json` has the released version,
    the installer build; uploads the exe as an artifact. Never references the signing key.
  - `sign`: own job, `contents: read`, `persist-credentials: false`, `npm ci --ignore-scripts`
    (no dependency code runs; only the Tauri CLI), signs, verifies against the pubkey, uploads
    the `.sig` artifact. Fails early when the key secret is missing.
  - `ci-gate`: waits for the `ci` workflow run of the tagged commit and fails unless it succeeded.
  - `publish`: `contents: write`, no environment secrets; re-verifies the exe/sig pair, uploads both
    to the draft release and publishes it. Needs `build`, `sign`, `ci-gate`.
- Every third-party action in release.yml and ci.yml pinned to a full commit SHA with the version
  as a comment (Dependabot keeps SHA pins current). GitHub-owned `actions/*` stay on tags.
- ci.yml cancels superseded runs only for pull requests; every main commit's run completes.
- CONTRIBUTING.md and the CI/release spec describe the new jobs and re-run instructions.

## Out of scope / residual risk

- `build` and `sign` still share the `release` environment (it holds `CONTROL_PLANE_URL` and the
  key). `build` never references the key; a hard split needs a second environment and moving a
  secret whose password only the maintainer knows.

## Acceptance Criteria

- [x] Script passes on a real `tauri signer sign` signature and fails on each mismatch case.
- [x] `npm run lint` and `npm test` pass; workflows parse as YAML.
- [x] No job both runs dependency install scripts and sees the signing key; no job with
      `contents: write` holds environment secrets; no persisted checkout credentials.
- [x] Publishing requires a successful CI run on the release commit.

## Result (2026-11-25)

- `scripts/verify-updater-signature.mjs` verified the published v0.13.0 installer and `.sig` against
  `tauri.conf.json`'s key; the fixture smoke covers wrong key, tampered file, wrong version, wrong
  file name, edited trusted comment and a comment moved out of the third line.
- The release jobs themselves run for the first time on the next release PR merge; a failure there
  leaves the draft unpublished. The Linux `sign` job's `npm ci --ignore-scripts` was not run locally.
