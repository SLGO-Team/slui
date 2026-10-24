# Gate clippy and npm audit in CI, pin Rust, Dependabot for npm

## Goal

The 10-24 health check found its results only by running them by hand: CI runs neither clippy
nor `npm audit`, the local Rust (1.91) was eight releases behind CI's floating stable, and
Dependabot only watched GitHub Actions. Make CI hold the line so the next problems surface on the
pull request that causes them.

## Requirements

- `rust-toolchain.toml` at the repository root pins one Rust (1.99, minimal profile + clippy) for
  local, CI and release builds. A denied-warnings clippy on a floating stable would fail unrelated
  pull requests whenever a Rust release adds lints; moving Rust becomes a pull request of its own.
- CI installs the pinned toolchain before rust-cache keys on it, runs
  `cargo clippy --workspace --all-targets -- -D warnings` and `npm audit --audit-level=high`.
- The release workflow installs the same toolchain.
- Code is clippy-clean under 1.99 without changing behaviour (it already was: 0 warnings, no code
  change needed; `-W clippy::pedantic` reports 240 warnings, so clippy does lint our crates).
- Dependabot also updates npm monthly: minor and patch grouped into one pull request, majors and
  `@tauri-apps/*` ignored (Tauri's npm packages must stay on the crates' minor version), titles in
  Conventional Commits form (`fix(deps)` runtime, `build(deps-dev)` tooling). Cargo stays manual
  (workspace-hack needs regenerating).
- Dependabot security updates enabled on SLGO-Team/slui.

## Acceptance Criteria

- [x] `cargo clippy --workspace --all-targets -- -D warnings` passes on 1.99.
- [x] `cargo test --workspace`, hakari checks, `npm run lint`, `npm test`, `npm run build` pass.
- [ ] CI on the pull request runs the new steps green; its duration is reported.
- [x] `security_and_analysis.dependabot_security_updates` is enabled.

## Notes

- `rustup toolchain install` with no arguments installs the toolchain file's Rust (rustup 1.28+).
- `cargo clean --profile dev` freed 37.8 GiB locally (the 1.91 artifacts were stale anyway);
  `target/release` (11 GB of 1.91 artifacts) was kept for the user's local release builds.
