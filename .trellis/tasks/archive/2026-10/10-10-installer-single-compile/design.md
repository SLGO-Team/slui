# Design: one slui-setup build, role and payload attached afterwards

## Idea

Compile `slui-setup` once, with no feature and no payload. `build-installer.mjs` then writes two files from
that exe by appending data after the PE image (an "overlay", as NSIS itself does):

```
slui-uninstall.exe   = slui-setup.exe + meta{role:"uninstall"}                 + trailer
SLUI-Setup-X.Y.Z.exe = slui-setup.exe + payload bytes + meta{role:"setup",...} + trailer
```

Windows ignores data after the last section when loading the exe, so the binary runs unchanged; the shell
reads the overlay from `current_exe()` at startup.

## Overlay format (contract between build-installer.mjs and payload.rs)

```
[ payload (payloadBytes) ][ meta: UTF-8 JSON (metaBytes) ][ metaBytes: u32 LE ][ magic: b"SLUISETUP\0v1\0\0\0\0" (16 bytes) ]
```

- `meta` = `{"role":"setup"|"uninstall","version":"X.Y.Z","payloadBytes":N,"requiredBytes":N}`;
  `payloadBytes` and `requiredBytes` are 0 for `uninstall`.
- Reader (`overlay.rs`, pure parsing over a `Read + Seek`, unit-tested): read the last 20 bytes, check magic,
  `metaBytes` ≤ 64 KiB, parse JSON, require `version == env!("CARGO_PKG_VERSION")`,
  `payload offset = len − 20 − metaBytes − payloadBytes` must be ≥ 0. Any failure → no overlay.
- Writer (`build-installer.mjs`): copies the shell exe and appends the pieces; no in-place edits.

## Role resolution (`lib.rs`)

`ROLE` becomes a runtime value resolved once in `main` (`OnceLock`/passed down):

1. Valid overlay → its role.
2. No overlay, debug build → `SLUI_SETUP_ROLE=uninstall` env selects uninstall, else setup without payload
   (today's `--dev` / `--dev --uninstall`; `build-installer.mjs --dev --uninstall` sets the env var instead
   of `--features uninstaller`).
3. No overlay, release build → message box ("安装程序文件不完整，请重新下载 SLUI 安装程序。") and exit 1.

Everything that matched on the const `ROLE` (main flow, window title, `__SLUI_SETUP_ROLE__` init script,
`generate_handler!` per role) matches on the runtime role instead; both command sets are compiled in, each
role still registers only its own.

## Payload access (`payload.rs`)

- `embedded_payload() -> &'static [u8]` (FindResourceW) is replaced by an overlay range of the exe file;
  `Session::extract_payload` streams it with `io::copy(&mut file.take(n), &mut out)` into the session dir.
- `detect::payload_version()` → `env!("CARGO_PKG_VERSION")` (release-please keeps it equal to the SLUI
  version; the overlay check enforces it). `detect::required_bytes()` → overlay `requiredBytes`, or the
  128 MiB dev placeholder without one.
- The relocated uninstaller copies `current_exe()` whole, overlay included — unchanged.

## build.rs / Cargo

- `build.rs` keeps only the manifest + `tauri_build`; drops `SLUI_SETUP_*` env handling, the RCDATA line
  and `cfg(slui_setup_no_payload)`. Release builds of `installer/` no longer refuse to compile; an exe
  without overlay refuses at runtime instead (role rule 3).
- `Cargo.toml`: remove the `uninstaller` feature.
- Version info: `productName` stays `SLUI Setup` for both exes (user decision); the uninstaller's
  `SLUI Uninstall` override goes away.

## build-installer.mjs flow

1. `tauri build --config {version}` in `installer/` → `slui-setup.exe` (fresh-mtime check as today).
2. Unless `--reuse-payload`: write `slui-uninstall.exe` (role uninstall), generate the hooks wrapper,
   build the SLUI NSIS package (unchanged).
3. Write `bundle/setup/SLUI-Setup-<version>[-theme-pack].exe` = shell + payload + meta(setup).
`--dev` runs `tauri dev` as before (`--uninstall` → env `SLUI_SETUP_ROLE=uninstall`). Sizes and the
theme-pack rename stay as they are.

## Trade-offs / risks

- Code signing (not used today): signing must happen after appending (appending breaks a signature), and
  Authenticode then puts its certificate table after the trailer. If signing is added, the reader must end
  at the PE security directory offset instead of EOF. Recorded in the spec; not implemented now.
- Overlay data can draw AV heuristics; NSIS and most installers use the same layout, so no new class of risk.
- Rollback: revert the PR; the format is internal to one build.

## Spec updates

`directory-structure.md` (installer bullets: feature, RCDATA payload) and the release/installer contracts in
`quality-guidelines.md` describe the overlay format and role resolution instead.
