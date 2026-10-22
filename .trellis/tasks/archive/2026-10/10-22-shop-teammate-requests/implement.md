# Implement: shop teammate purchase requests

Branches: slui `feat/shop-teammate-requests` (PR, visual: no auto-merge); plugin and backend
`feat/shop-teammate-requests` merged into their local `main` after tests (no remotes).

## Checklist

1. [x] Protocol (`packages/protocol`): types, `parseShopSnapshot` (requestable / requested / requests),
       `parseCommand`, `parseCommandResult`; v0 schemas, examples, README; `scripts/contract-smoke.mjs`.
2. [x] Plugin: `ShopRequestManager` result type + remote flag; `ShopManager` remote entry points and event;
       sidecar facts / rules / DTO / writer; command parsing and handler; IPC dirty hook; tests
       (`Slgo.Tests`), module docs (`Features/Shop/CLAUDE.md`, `Features/Sidecar/CLAUDE.md`), spec.
3. [x] Backend: IPC schema enum, examples, contract tests, hub rate limit check, dev client verbs.
4. [x] SLUI model: commands, pending targets, request views; `scripts/shop-model-smoke.mjs`.
5. [x] SLUI panel: request area, entries, details, card tag, navbar hint, R / right-click; CSS from the
       baseline measurements; App wiring.
6. [x] Mock: debug option + panel select; capture `payer` / `requester` / `none` at 1080p beside the
       baseline crop.
7. [x] Checks: slui `npm run lint`, `npm test`, `npm run build`; backend `bun test`; plugin `dotnet test`.
8. [x] Spec updates (slui `system-boundaries.md` shop bullets, `cs2-visual-replication.md` §8), commit,
       PR (no auto-merge), hand the user the preview URLs.

## Validation commands

- slui: `npm run lint && npm test && npm run build`
- slgo-backend: `bun test`
- plugin: `dotnet test` (see plugin AGENTS / CLAUDE for the exact solution path)

## Rollback

Each repo's change is one branch; revert the merge / PR. The protocol change is additive.
