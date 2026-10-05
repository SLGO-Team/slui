# Implement: HUD data channel

Branch: rename the planning branch `feat/cs2-hud-panels` to
`feat/hud-data-channel` (it already carries the planning artifacts) or start
from it; one slui PR. Backend and plugin changes are committed on their local
`main` after their tests pass.

1. [ ] slui protocol: types, parsers, schemas, examples, README, feature
       constants. `npm run lint`, `npm test` (extend `scripts/contract-smoke.mjs`).
2. [ ] slgo-backend (`../slgo-backend`): copy examples into `protocol/ipc/v1`
       publish fixtures + invalid fixtures; enums; cache/replay + age
       adjustment; README. `bun run lint`, `bun test`. Commit.
3. [ ] SLGO plugin (`../SLGO`): payloads, `SidecarHudRules`, manager wiring,
       handshake resync, tests incl. `IpcContractFixtureTests` coverage of the
       new backend examples. `dotnet test`. Commit (do not touch the
       pre-existing uncommitted `quality-guidelines.md` change).
4. [ ] slui mock provider scenes (D4); `npm test`, `npm run build:local`.
5. [ ] Spec updates in the three repos.
6. [ ] Optional live smoke: plugin on a dev server + `bun run dev:client` shows
       both events.

Rollback points: each repo's commit is independent; the slui PR without the
plugin publisher is inert.
