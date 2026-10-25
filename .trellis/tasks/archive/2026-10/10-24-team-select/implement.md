# Implement: CS2 team select menu

## Workspaces

- slui: main checkout, branch `feat/team-select` (the backend workspace links `../slui/packages/protocol`, so the
  protocol change lives in this checkout).
- slgo-backend: main checkout, branch `feat/team-select`, merged into local `main` at the end (no remote).
- SLGO: main checkout, branch `feat/team-select`, merged into local `main` at the end (no remote). Its tests find
  `slgo-backend` by walking up, i.e. the backend main checkout.

## Order

1. [x] slui protocol: `TeamMenu` / `TeamMenuEvent`, `parseTeamMenu` + `parseEvent` case, `TeamSelectCommand` /
       `TeamCloseCommand` in `SlgoCommand`, `COMMAND_KINDS`, `parseCommand` cases, `CLIENT_FEATURE_TEAM_SELECT`;
       `v0/team-menu.schema.json` + examples, command schema kinds + examples, README sections; `contract-smoke`
       cases (valid, closed, unknown key, bad id, bad team). Gate: `npm run lint`, `npm test`.
2. [x] slgo-backend: `messages.ts` sets, `hub.ts` replay order, `protocol/ipc/v1` schemas / examples / invalid
       fixtures, README, dev client verbs and event printing, rate limit check. Gate: `bun run lint`, `bun test`.
3. [x] SLGO rules and transaction: `TeamChoice`, `EvaluateSpectate`, `ResolveAutoTeam`, outcomes, notices and
       catalog entries, `RoundManager.TrySelectTeam(player, TeamChoice)`, spectate through the coordinator,
       `.team spectate|auto`; tests (rule tables, coordinator with a fake port: spectate alive in action phase,
       unassigned no-op, empty-team guard; auto ties).
4. [x] SLGO menu and sidecar: session `Forced` / renderer, `OpenForcedOnJoin` from `PlayerHandler`, presence
       re-render, `Toggle` / `CloseFromSlui` / `ApplyResult`, `SidecarTeamMenuRules` / `Publisher`, command parsing
       and dispatch, result mapping, constants, payloads, manager wiring, `Features/Sidecar/CLAUDE.md`; tests (forced
       open conditions, renderer switch, close rules, payload self-check against the slui parser semantics,
       `IpcContractFixtureTests` for the new fixtures, `SidecarSessionStateTests` for `ClearSession`). Gate:
       `dotnet build Slgo.sln -p:Configuration=Debug -p:Platform=x64 -p:RunAccessScan=true`,
       `dotnet test Slgo.Tests/Slgo.Tests.csproj -c Debug`.
5. [x] slui model: `src/features/teamselect/model.ts` + `presentation.ts`, `scripts/teamselect-model-smoke.mjs`
       added to `npm test` (event / dismiss / pending / timeout / error expiry / own-team click / disconnect,
       roster selection by role, subtitle, human / bot rows). Gate: `npm run lint`, `npm test`.
6. [x] slui view and App: panel, CSS, SLUI-drawn icons, world blur region, fade, banner; App wiring (feature,
       routing, commands, modality, hidden panels, keys); mock scenes and debug panel option; mock command replies.
7. [x] Visual gate: 1080p captures of `teamSelect=ntf|scp|forced` beside the user's captures (local only, never
       committed); fix positions, sizes, colours; then 16:10 and 4:3 sanity captures; blur on and off.
8. [x] Spec: `system-boundaries.md` (event, commands, feature, authority rule), `cs2-visual-replication.md` new
       section "Team-select-specific replication rules".
9. [x] Quality check (`trellis-check`) across the three repos; `npm run build:local`.
10. [x] Commit, open the slui PR (visual: no auto-merge), hand the user the mock URLs and captures for review.
       Review added the side illustrations (2026-10-25); the user approved the visuals.
11. [x] In-game check by the user on the local server (competitive profile; sidecar + plugin + SLUI), 2026-10-25.
       Passed: forced menu on join (SLUI), join NTF, M open / close with music, Cancel / Escape / M, own-side click
       closes, refusal banner (SCP full via dummies), auto, M mid-round refused with the not-now notice
       (competitive allows no mid-match change). Found and fixed on the branch: the menu taking the foreground hid
       itself (foreground loop, black flicker) and a menu left open while the overlay was disabled took no input
       after enabling. Skipped at the user's request: casual-profile spectate mid-round and the empty-team guard,
       the Hint menu for a non-SLUI client, presence arriving late. Plugin / backend merged into their local
       `main`. Deploy and release stay with the user.

## Validation commands

- slui: `npm run lint`, `npm test`, `npm run build:local`.
- slgo-backend: `bun run lint`, `bun test`.
- SLGO: `dotnet build Slgo.sln -p:Configuration=Debug -p:Platform=x64 -p:RunAccessScan=true`,
  `dotnet test Slgo.Tests/Slgo.Tests.csproj -c Debug`.

## Rollback points

Each repo's branch is independent (slui PR unmerged, plugin / backend branches unmerged). Once the plugin
publishes `team.menu`, the sidecar must not be rolled back below it.

## Risky files

- `SLGO/Features/Rounds/TeamSelection/TeamSelectionTransactionCoordinator.cs` (irreversible order; spectate path).
- `SLGO/Features/Rounds/TeamSelection/TeamSelectionMenuManager.cs` (session lifecycle, renderer switch).
- `SLGO/Handlers/PlayerHandler.cs` (join orchestration order).
- `slui/src/App.tsx` (modality, interactive overlay, hidden panels).
