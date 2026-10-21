# Implement: CS2 spectator panel

## Workspaces

- slui: main checkout, branch `feat/spectator-panel` (the backend workspace links
  `../slui/packages/protocol`, so the protocol change must live in this checkout).
- slgo-backend: main checkout, branch `feat/spectator-panel`, merged into local `main` at the end (no remote).
- SLGO: worktree `SLGO/.claude/worktrees/spectator-panel`, branch `feat/spectator-panel`, merged into local
  `main` at the end (no remote). Its tests find `slgo-backend` by walking up, i.e. the backend main checkout.

## Order

1. [ ] slui protocol: types, `parseHudSpectating` (shared ammo / kill helpers with `parseHudStatus`),
       `parseEvent` case, `CLIENT_FEATURE_HUD_SPECTATING`, limit constant, `v0/hud-spectating.schema.json` +
       `.example.json`, README section ("HUD spectating") and the feature list, `contract-smoke` cases.
       Gate: `npm run lint`, `npm test`.
2. [ ] slgo-backend: `messages.ts` sets, `hub.ts` replay order, `protocol/ipc/v1` schema / examples /
       invalid fixtures, README. Gate: `bun run lint`, `bun test`.
3. [ ] SLGO: constants, payload DTOs, `SidecarHudSpectatingRules`, `SidecarHudSpectatingPublisher`, item-name
       resolution, manager wiring, `Features/Sidecar/CLAUDE.md`; tests for rules (target null cases, clamping,
       signature, self-check against the slui parser semantics), `IpcContractFixtureTests` for the new
       fixtures, `SidecarSessionStateTests` for `ClearSession`. Gate:
       `dotnet build Slgo.sln -p:Configuration=Debug -p:Platform=x64 -p:RunAccessScan=true`,
       `dotnet test Slgo.Tests/Slgo.Tests.csproj -c Debug`.
4. [ ] slui model: reducer holds `spectating`; `selectBottomHud` subject rule; shared ADR helper used by the
       scoreboard too; App declares the feature and passes the scoreboard frame; debug override keeps
       `bottom-dead`. `bottomhud-model-smoke` cases. Gate: `npm run lint`, `npm test`.
5. [ ] slui view: keyed row, spectator panel, avatar, labels, hidden strokes, world blur region; debug
       scenes `bottom-spectating` / `bottom-spectating-enemy` and mock `hud.spectating`.
6. [ ] Visual gate: crop the user's reference capture and a 1080p debug capture of the same region side by
       side (local only, `slgo-deploy/artifacts/`, never committed); fix sizes, colours, baselines.
7. [ ] Quality check (`trellis-check`) across the three repos.
8. [ ] In-game check by the user (local server: sidecar + plugin + SLUI): teammate, Casual opponent, target
       switch, respawn, SCP target, empty hands. Release stays with the user.

## Rollback points

Each repo's branch is independent; revert the branch (slui PR not merged / local branches not merged) to
undo. The sidecar must not be rolled back below the plugin once the plugin publishes `hud.spectating`.

## Risky files

- `slui/src/features/bottomhud/BottomHud.tsx` (kill burst state: target switches must not burst).
- `SLGO/Features/Sidecar/SidecarIpcManager.cs` (pump order and session lifecycle).
- `slui/src/App.tsx` (debug overrides of the bottom HUD).
