# CI: cheaper hakari check and Rust cache

## Goal

Lower the wall time of the required `build-and-test` job (~3m10s) by trimming its Rust overhead, keeping
every check it performs. Parent: `10-10-build-speed`.

## Background (measured)

- `Swatinem/rust-cache` restore: 54s for an ~836 MB cache (debug `target` of SLUI, the installer shell and
  their dependencies, with full debug info).
- `cargo hakari generate --diff && cargo hakari manage-deps --dry-run`: 27s in CI, 1.8s locally. Likely
  cause: the first `cargo metadata` of the job unpacks every dependency source from `registry/cache`
  (rust-cache does not keep `registry/src`). If so, skipping the step moves that cost into `cargo test`
  instead of removing it. Must be confirmed from CI timings before relying on it.
- `cargo test --workspace`: 38s (debug build of `slui`, `slui-setup`, `workspace-hack` + tests).

## Requirements

- R1 Reduce debug info for the CI dev/test build (e.g. `CARGO_PROFILE_DEV_DEBUG` set in the workflow only;
  local builds keep full debug info). Expected: smaller cache, faster restore/save and link.
- R2 The hakari freshness check keeps failing CI whenever `workspace-hack` is stale. Only change how or when
  it runs if CI timings show a real net saving (see Background); otherwise leave it as is and record why.
- R3 No path filters on the workflow or job: `build-and-test` must always report (ruleset requirement).

## Acceptance Criteria

- [ ] At least two PR runs after the change (the first one builds a new cache) show the per-step timings;
      the PR description lists before/after for cache restore, hakari and `cargo test`.
- [ ] Total `build-and-test` time is lower than the ~3m10s baseline on a warm cache.
- [ ] A deliberately stale `workspace-hack` would still fail CI (reasoned from the workflow, or tested on the
      branch).
- [ ] `npm run lint`, `npm test`, `cargo test --workspace` pass.
