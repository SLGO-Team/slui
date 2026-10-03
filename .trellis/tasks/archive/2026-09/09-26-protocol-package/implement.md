# Implement — @slgo/protocol extraction

## Checklist

1. `git mv protocol/v0 packages/protocol/v0`; delete empty `protocol/`.
2. Create `packages/protocol/package.json` and `tsconfig.json` per design.md.
3. Create `packages/protocol/src/index.ts` by moving the wire-contract symbols
   (and their private helpers) out of `src/contracts/index.ts` verbatim.
4. Rewrite `src/contracts/index.ts` as `export * from "@slgo/protocol";` plus the
   client-only definitions (importing any protocol types they reference).
5. Root `package.json`: add `"workspaces": ["packages/*"]` and dependency
   `"@slgo/protocol": "*"`; run `npm install` to update the lockfile.
6. Update fixture paths in `scripts/minimap-contract-smoke.mjs` and
   `scripts/minimap-integration-smoke.mjs`; grep for any other `protocol/v0`
   reference (README, spec, codegraph config) and fix.
7. Update `.trellis/spec/frontend/directory-structure.md` (+ other spec mentions).

## Validation

```bash
npm install
npm run lint
npx tsc -p packages/protocol
npm test
npm run build
grep -rn "@slgo/protocol" src   # only src/contracts/index.ts
```

Backend-consumability smoke (scratch dir outside the repo, then delete):
`bun init -y`, add `"@slgo/protocol": "file:./packages/protocol"`,
`bun install`, run a script that `parseEvent`s `v0/match-snapshot.example.json`
wrapped in a valid envelope (or an envelope fixture) and prints `ok: true`.

Browser: `preview_start` the mock config, load the HUD/minimap page, check
console for errors, screenshot.

## Risk points

- Node type-stripping under workspace symlink (see design.md fallback).
- `package-lock.json` churn from adding workspaces — expected, review once.
- `tsconfig.json` `include: ["src"]` — package files are checked via import;
  the separate `tsc -p packages/protocol` guards ES-only compatibility.
