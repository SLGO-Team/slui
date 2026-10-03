# Extract @slgo/protocol package

## Goal

Make the SLUI ↔ sidecar/control-plane wire contract a standalone, dependency-free
TypeScript package inside the slui repo, so the future private `slgo-backend`
(TypeScript on Bun, sibling directory `..\slgo-backend`) can
import the exact same parsers and validators the client uses. Client and server
then share one executable definition of protocol v0 instead of two hand-kept
copies aligned by fixtures.

This task is a pure relocation: no protocol, parser, or client behavior changes.

## Background / Confirmed Facts

- Repo split agreed 2026-09-26: plugin (`SLGO\`, C#), `slui\` (public), new
  private `slgo-backend\` (sidecar + control plane, TS on Bun). Public protocol
  lives in slui; the backend depends on it, never the reverse.
- `src/contracts/index.ts` (544 lines) has zero imports and uses only ES
  built-ins (`JSON`, `Date`, `Number`) — no DOM, React, or Tauri.
- It mixes two kinds of content:
  - wire contract: version constants, envelope/payload/command types,
    `parse*` functions, `EventSequenceGuard`, `canOpenPlayerScopedStream`,
    `IdentityMode`, `ServerRoute` + `parseRoute`;
  - client-only state: `ConnectionStatus`, `SteamIdentity`,
    `SteamIdentityProof`, `VerificationState`, `MinimapDiagnostic`,
    `canUsePlayerScopedFeatures`, `createCommandId`.
- 28 files under `src/` plus 3 scripts import `contracts` via 5 different
  relative specifiers (`../contracts`, `../../contracts/index.ts`, …).
- `protocol/v0/` holds README, 8 JSON Schemas and 8 example fixtures;
  `scripts/minimap-contract-smoke.mjs` and `scripts/minimap-integration-smoke.mjs`
  read fixtures via `../protocol/v0/…`.
- slui has no `workspaces` field today; tests run via
  `node --experimental-strip-types`; `npm run lint` is `tsc --noEmit` with
  `include: ["src"]`.
- `.trellis/spec/frontend/directory-structure.md` documents `src/contracts/` as
  the home of versioned payload types.

## Requirements

- R1. Create `packages/protocol/` as npm workspace package `@slgo/protocol`
  (private, zero runtime and dev dependencies, ESM, `exports` pointing at the
  TS source — no build step).
- R2. Move `protocol/v0/*` (README, schemas, fixtures) into
  `packages/protocol/v0/` unchanged; remove the old `protocol/` directory.
- R3. Move the wire-contract portion of `src/contracts/index.ts` into
  `packages/protocol/src/index.ts` with identical code and exported names.
- R4. `src/contracts/index.ts` becomes the client facade: re-exports
  `@slgo/protocol` and keeps the client-only definitions listed above. Existing
  `src/` imports keep working unchanged.
- R5. The package type-checks on its own under strict settings with ES-only libs
  (no DOM), so a Bun/Node backend can consume it as-is.
- R6. Scripts that read fixtures use the new path; all existing tests and the
  build stay green.
- R7. Update `.trellis/spec/frontend/directory-structure.md` (and any spec text
  that names `protocol/v0` or the contracts location) to describe the package vs
  facade split and the rule that wire-contract code goes in the package.
- R8. Licensing (decided 2026-09-27): repository is GPL-3.0-or-later (root
  `LICENSE`, `package.json`, `src-tauri/Cargo.toml`); `packages/protocol` is MIT
  (own `LICENSE` + `package.json`) so the closed-source `slgo-backend` can depend
  on it without GPL obligations, including for outside contributions. README
  documents the split and that third-party game assets are not covered.

## Acceptance Criteria

- [x] `npm install` creates the workspace link; `npm run lint`, `npm run build`
      and `npm test` all pass.
- [x] `packages/protocol` has its own `tsconfig.json` (lib ES2022, no DOM,
      strict) and `npx tsc -p packages/protocol` passes.
- [x] `git diff` of the moved parser code shows a move, not a rewrite (exports,
      logic and error codes identical).
- [x] `packages/protocol/src/index.ts` contains no client-only symbol from the
      list above; `src/contracts/index.ts` contains no wire parser logic.
- [x] No file in `src/` other than `src/contracts/index.ts` imports
      `@slgo/protocol` directly (facade rule).
- [x] `bun -e "import('@slgo/protocol')…"`-style smoke from a scratch directory
      depending on `file:<slui>/packages/protocol` can call `parseEvent` on a v0
      fixture (proves backend consumability).
- [x] Browser mock preview (`npm run dev:mock`) still renders HUD/minimap with no
      console errors.
- [x] Spec updated per R7.
- [x] Root `LICENSE` is the canonical GPLv3 text; `packages/protocol/LICENSE` is
      MIT; license fields set in both `package.json` files and `Cargo.toml` (R8).

## Out of Scope

- Creating the `slgo-backend` repo/skeleton (next task, outside slui).
- Any protocol change, new message type, envelope builder/serializer for the
  sidecar, or JSON-Schema-vs-parser conformance tests.
- Publishing to an npm registry.
- Rewriting the 28 consumer imports to a single specifier style.
