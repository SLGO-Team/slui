# Implementation plan

1. Protocol: `SIDECAR_CLOSE_CODES.notOnServer = 4004` (+ docs in `packages/protocol/v0/README.md`).
2. Client contracts: `ConnectionStatus` += `game-not-running`; `endsMatch()`; session bridge parser list.
3. Connection: `failureForClose(4004)` → `not-in-game` / `poll`; backend-connection smoke rows.
4. Session: `gameRunning` gate in `runClientSessionAttempt` / `useClientSession`, monotonic attempts,
   reducer action; `useGameRunning` hook; App passes it. Smoke: gate dispatches no route, no retry.
5. Feature reducers: reset on `endsMatch(status)` (hud, winpanel, hudmessages, bottomhud, killfeed,
   scoreboard, shop, chat, teamselect, minimap) + HUD/shop availability lists; model smokes.
6. Rust: disable the overlay on game exit (main thread).
7. Home: server status entry, OverlaySwitch caption + CSS; status smoke.
8. Backend (slgo-backend, branch → local main): hub 4004 for departed / unlisted players, tests, docs.
9. Spec: system-boundaries (lifecycle, close mapping, error matrix), protocol README.

## Validation

- `npm run lint`, `npm test`, `npm run build`
- `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` (as in ci.yml)
- slgo-backend: `bun test`, typecheck
- Live: quit / relaunch / leave server (PRD acceptance criteria).

## Rollback

Single squash PR in slui; backend change is one merge commit in its local main.
