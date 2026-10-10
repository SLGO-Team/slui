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

- [x] At least two PR runs after the change (the first one builds a new cache) show the per-step timings;
      the PR description lists before/after for cache restore, hakari and `cargo test`.
- [x] Total `build-and-test` time is lower than the ~3m10s baseline on a warm cache.
- [x] A deliberately stale `workspace-hack` would still fail CI (reasoned from the workflow, or tested on the
      branch).
- [x] `npm run lint`, `npm test`, `cargo test --workspace` pass.

## Outcome (PR #27, run 38057136470)

| Step | Before (run 38053440487) | After, warm (attempts 2 / 3) |
|---|---|---|
| rust-cache restore | 54s (836 MB) | 33s / 21s (399 MB) |
| dependency unpack (`cargo metadata`, own step) | inside hakari, 27s | 61s / 27s |
| hakari check | 27s | < 3s |
| `cargo test --workspace` | 38s | 28s / 29s |
| job total | 187s (main runs 154–210s) | 184s / 142s |

- R2: the hakari check itself costs < 3s; its 27s was the first cargo command unpacking every dependency's
  sources (rust-cache does not keep `registry/src`). Skipping it would move that cost to `cargo test`, so
  the check stays unconditional.
- Remaining biggest Rust step is that unpack (many small files of the `windows*` crates); its 27–61s spread
  is runner disk variance.
