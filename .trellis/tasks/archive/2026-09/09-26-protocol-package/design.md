# Design — @slgo/protocol extraction

## Layout

```
slui/
├─ package.json                 + "workspaces": ["packages/*"], + dep "@slgo/protocol": "*"
├─ packages/protocol/
│  ├─ package.json              name @slgo/protocol, private, type module,
│  │                            exports { ".": "./src/index.ts",
│  │                                      "./v0/*": "./v0/*" }
│  ├─ tsconfig.json             strict, lib ES2022, noEmit, allowImportingTsExtensions
│  ├─ src/index.ts              wire contract (moved verbatim)
│  └─ v0/                       README + *.schema.json + *.example.json (moved)
└─ src/contracts/index.ts       export * from "@slgo/protocol"; + client-only types/helpers
```

## Boundary rule

| Goes in `@slgo/protocol` | Stays in `src/contracts` |
|---|---|
| Described by `v0/*.schema.json` or the v0 README (wire shape, versioning, sequence/baseline rules, identity-mode authorization rule) | Client presentation/session state, local diagnostics, id generation |
| `PROTOCOL_VERSION`, `SUPPORTED_SCHEMA_VERSION`, `MINIMAP_SCHEMA_VERSION`, `TeamId`, `Role`, `RoundState`, `IdentityMode`, `ServerRoute`, `ProtocolEnvelope`, all payload/command/event types, `ParseErrorCode/ParseError/ParseResult`, all `parse*`, `EventSequenceGuard`, `canOpenPlayerScopedStream` | `ConnectionStatus`, `SteamIdentity`, `SteamIdentityProof`, `VerificationState`, `MinimapDiagnostic`, `canUsePlayerScopedFeatures`, `createCommandId` |

`SteamIdentityProof` stays client-side for now: its camelCase fields are not a
defined wire shape; when the handshake proof is specified it moves into the
package as a versioned contract.

Private helpers (`isRecord`, `error`, …) move with the parsers and stay
unexported.

## Why a facade instead of rewriting imports

- Zero churn in 28 consumer files; the move diff stays reviewable.
- Keeps the spec rule "features consume `src/contracts`" true; the facade is the
  single place the client binds to the package, so a later package rename or
  version pin touches one line.

## Resolution checks (verify during implementation)

- **tsc** (`moduleResolution: bundler`, `allowImportingTsExtensions`) resolves
  `exports` → `.ts` source and type-checks it through the import.
- **Vite** serves the symlinked workspace package as source (realpath is outside
  `node_modules`, so no pre-bundling) and transpiles it.
- **Node `--experimental-strip-types`** refuses TS under `node_modules`; npm
  workspace links resolve to the realpath `packages/protocol/...` by default, so
  stripping should apply. If it does not, fall back to having the facade import
  the package via relative path and document why.
- **Bun** consumes `file:` dependencies and runs TS directly.

## Rollback

Single commit; revert restores `protocol/` and the monolithic contracts file.
No persisted data or runtime config is affected.
