# Refresh dependencies and enable GitHub security scanning

## Goal

The 10-24 health check found two high npm advisories (vite 7.3.6, source-map-js), npm and Cargo
dependencies one minor release behind (Tauri 2.11 -> 2.12, React 19.2 -> 19.3), and the public
repository's GitHub security scanning switched off. Bring the dependencies current within their
existing ranges and turn the scanning on.

## Requirements

- `npm audit` reports no vulnerabilities.
- npm and Cargo dependencies at their latest versions inside the ranges `package.json` and the
  `Cargo.toml` files already declare. No major upgrades (vite 8, @vitejs/plugin-react 6,
  TypeScript 7 stay out of scope).
- The `@tauri-apps/*` npm packages and the Tauri crates stay on the same minor version.
- The direct `windows` dependency keeps matching the version tao builds, so the crate compiles
  once (`src-tauri/Cargo.toml` comment).
- workspace-hack regenerated so `cargo hakari generate --diff` stays clean.
- GitHub (SLGO-Team/slui): dependency graph, secret scanning and push protection enabled.

## Acceptance Criteria

- [x] `npm audit` (registry.npmjs.org): 0 vulnerabilities.
- [x] `npm run lint`, `npm test`, `npm run build`, `npm run installer:vite:build` pass.
- [x] `cargo test --workspace`, `cargo clippy --workspace --all-targets` (no warnings) and the
      hakari checks pass.
- [x] The app starts on the new Tauri (`npm run tauri:mock`) without errors: the mock session goes
      live and borderless capture is granted through the renamed `IAsyncOperation::join`.
- [ ] In-game check of the overlay and world blur on the new Tauri: part of the in-game test before
      the next release.
- [x] The repository's `security_and_analysis` reports secret scanning and push protection enabled,
      and the dependency graph answers.

## Notes

- windows 0.62 renamed `IAsyncOperation::get` to `join` (same blocking wait); `backdrop.rs` had the
  one call.
- GitHub has no REST switch for the dependency graph; `PUT /repos/{repo}/vulnerability-alerts`
  turns it on with Dependabot alerts (the SBOM endpoint went 404 -> 200, dependency review
  403 -> 200). Manifests are indexed on the next push to `main`.
- The direct `windows-sys` 0.59 dependency is now the only 0.59 copy (Tauri's stack is on 0.61);
  moving it is a 0.x major and stays out of this task.
