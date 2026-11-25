# Toolchain checks and silent install guards

Source: item 7 of the 2026-11-25 cloud review follow-ups (low).

## Problems (confirmed on main)

1. `scripts/mock-boundary-check.mjs` matched only `import ... from` and `import()`: an `export ... from` re-export
   or a side-effect `import "..."` of mock code passed. (The review's line numbers referred to an older file.)
2. The same script built its root from `URL.pathname`, which keeps `%20` and percent-encoded non-ASCII, so it
   crashed in a checkout under such a path.
3. `scripts/generate-licenses.mjs` kept the first version seen per package name: another installed version
   with a different license (or license text) was neither checked nor listed.
4. `SLUI-Setup.exe /S` passed the caller's arguments straight to NSIS, bypassing the wizard's downgrade guard,
   its "already installed elsewhere" guard and its post-install verification.

## Requirements

- Mock check: catch value imports, `export ... from`, side-effect imports and dynamic imports of `src/mocks`
  (type-only forms allowed); the matcher asserts itself on each form; root via `fileURLToPath`.
- Licenses: one entry per name + license expression + license text; every installed version checked; output
  unchanged while no package has two variants; extraneous packages skipped.
- Silent install: refuse (exit 2) when a newer SLUI is installed or `/D=` names another directory than the
  installed one; without `/D=` keep going back to `InstallLocation`; after NSIS exits 0, run the wizard's
  `verify` (payload version in the registry for that directory, `slui.exe` present), else exit 2.

## Acceptance Criteria

- [x] The mock check passes here and, copied into a path with spaces and CJK characters, flags `export * from`.
- [x] `npm run licenses:check` reports the committed file up to date.
- [x] Installer unit tests cover downgrade and other-dir refusal, same-dir spellings and `/D=` parsing;
      `cargo test --workspace` and clippy `-D warnings` pass.

## Notes

- The silent install was not run on the dev PC (it would replace the installed SLUI); its decisions are unit
  tested and the post-install check is the wizard's own `verify`.
