# Implement: 品牌化卸载器

Node is not on the agent PATH: prefix commands with
`export PATH="/c/Users/23q3/AppData/Roaming/fnm/node-versions/v24.4.1/installation:$PATH"`.

## Checklist

1. **NSIS hooks** — `src-tauri/windows/installer-hooks.nsh`: install-side `!ifdef` blocks,
   PRE/POSTUNINSTALL. Keep the existing shortcut hook unchanged. (rollback point A)
2. **Rust (installer/src-tauri)**
   - `Cargo.toml` feature `uninstaller`; `build.rs` role handling.
   - `detect.rs`: uninstall entry reader not requiring `slui.exe`; user data dirs
     (`FOLDERID_RoamingAppData` / `LocalAppData` + `com.slui.desktop`).
   - `uninstall.rs`: entry classification (forward / classic / relocate / ui), raw command-line tail,
     relocation, forward, args builder, run + verify + user data cleanup, outcome types.
   - `lib.rs`: role const, per-role window title / init script / commands; `main.rs` dispatch.
   - Unit tests: args (`_?=` last, unquoted, flag combos), raw tail parsing (quoted / unquoted
     argv0, spaces), entry classification, outcome JSON.
3. **Frontend** — `installer/src/uninstall/*`, shared `Check`, `main.tsx` role switch,
   `scripts/uninstaller-model-smoke.mjs` in `npm test`.
4. **Build pipeline** — `scripts/build-installer.mjs` steps 1–4, `--dev --uninstall`; theme pack
   via define instead of resources.
5. **Docs** — README installer section; spec (directory structure + installer contract).

## Validation

```
npm run lint
npm test
cargo test --workspace --manifest-path src-tauri/Cargo.toml
npm run installer:build:local          # with and without --theme-pack <dummy dir>
```

Browser visual check of every uninstall screen through the `?role=uninstall&state=` mock.

E2E on this PC (needs the user at UAC prompts):
- U1 install via shell → registry `UninstallString` / `QuietUninstallString`; `slui-uninstall.exe`
  in `<dir>`.
- U2 themed install, uninstall with defaults → app gone, `theme-pack\` kept, user data kept.
- U3 uninstall with 主题包 on → `<dir>` gone.
- U4 uninstall with 用户数据 on (SLUI running) → app closed, both data dirs gone.
- U5 UAC declined → back to confirm, nothing changed.
- U6 after exit: no `slui-uninstall.exe` in `<dir>`; `PendingFileRenameOperations` lists the temp
  copy; NSIS exit code still 0 with the reboot flag set.
- U7 `"<dir>\slui-uninstall.exe" /S` from an elevated prompt → silent uninstall.
- U8 regular installer update over a themed install keeps the theme pack.

## Risky files / rollback

- `src-tauri/windows/installer-hooks.nsh` — affects every install; keep plain-NSIS behaviour
  identical when no defines are present.
- `scripts/build-installer.mjs` — release pipeline; production mode must still produce
  `SLUI-Setup-<ver>.exe` with the same name.
