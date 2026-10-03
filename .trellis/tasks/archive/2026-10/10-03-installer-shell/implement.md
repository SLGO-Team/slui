# Implement: 安装器外壳

Node is not on the agent PATH: prefix commands with
`export PATH="/c/Users/23q3/AppData/Roaming/fnm/node-versions/v24.4.1/installation:$PATH"`.

## Checklist

1. **Scaffold + CLI resolution** (rollback point A)
   - `installer/` per design layout; `installer/src-tauri/.gitignore` (`/target/`, `/gen/schemas`).
   - Root `.taurignore` with `installer/`.
   - Verify: `npx tauri info` from repo root reports `src-tauri` app; from `installer/` reports
     `installer/src-tauri`. If `.taurignore` does not isolate them, stop and revisit design.
2. **Shared tokens**: move `:root` block of `src/app/home/home.css` to
   `src/shared/brand-tokens.css`, import it from `home.css`. Verify home window screenshot is
   unchanged (`npm run dev:mock`, home route) before/after.
3. **Rust core** (`installer/src-tauri/src`)
   - `detect.rs` (registry 64-bit view, semver, process snapshot, Program Files via
     `SHGetKnownFolderPath`), `payload.rs` (temp dir, extract, stale cleanup), `install.rs`
     (args builder, `ShellExecuteExW runas`, wait, verify), `webview2.rs` (gate), `lib.rs`
     commands + window with temp `data_directory`.
   - `build.rs` payload env handling; `cfg(slui_setup_no_payload)` for debug UI dev.
   - Unit tests: args builder (`/D=` last, unquoted, `/NS /SLUI-STARTMENU [/SLUI-DESKTOP]`, `/UPDATE`), quote stripping,
     dir normalization (`\SLUI` append), version classification incl. unparsable.
4. **Frontend**: `model.ts` (pure), `platform.ts` (invoke + browser mock), screens, CSS.
   `scripts/installer-model-smoke.mjs` covers classify + reducer + free-space gate; add to `npm test`.
   Add `installer/tsconfig.json` to `lint`, `build`, `build:local`.
5. **Build pipeline**: `scripts/build-installer.mjs`; npm scripts `installer:dev`,
   `installer:build:local`, `installer:build`. Output
   `src-tauri/target/release/bundle/setup/SLUI-Setup-<ver>.exe`.
6. **Docs/spec**: README packaging section (installer is the distributed artifact; NSIS internal);
   `.trellis/spec/frontend/directory-structure.md` add `installer/` and `src/shared/brand-tokens.css`.

## Validation

```
npm run lint
npm test
cargo test --manifest-path installer/src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run installer:build:local
```

Browser visual check of every screen via `?state=` mock (preview, screenshots).

Manual E2E on this PC (real installer, needs the user at UAC prompts):
- E1 fresh install to `D:\Program Files\SLUI` with desktop shortcut off → no desktop shortcut,
  start-menu shortcut present, HKLM uninstall entry version matches, launch works.
- E2 same version → 启动 / 重新安装 offered; reinstall succeeds.
- E3 update: bump version to 0.1.1 in a throwaway build → "更新到 0.1.1", no install options,
  installs into the existing dir; SLUI running beforehand gets closed.
- E4 downgrade: run the 0.1.0 setup with 0.1.1 installed → only 启动.
- E5 UAC declined → back to previous screen with notice, nothing installed.
- E6 `SLUI_SETUP_FORCE_CLASSIC=1` → classic NSIS wizard appears, shell exits.
- E7 after closing the shell: no `%LOCALAPPDATA%\com.slui.setup`, temp dir removed.
- Cleanup: uninstall via 应用和功能, restore version to 0.1.0.

## Risky files / rollback

- `src/app/home/home.css` (token move) — revert alone if home visuals change.
- `package.json` scripts (`lint`/`test` additions) — keep existing script order.
- `.taurignore` — if it disturbs `tauri dev` watching, fall back to running the root CLI with an
  explicit cwd as well.
