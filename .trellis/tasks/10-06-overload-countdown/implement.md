# Implement: overload countdown

Branch `feat/overload-countdown` in slui; backend and plugin committed on their local `main` (as for
the HUD panels).

1. [x] slui `packages/protocol`: token constant, parser rule, contract smoke cases.
2. [x] slui renderer: `formatHudSeconds`, selector, mock scene, model smoke cases.
3. [x] backend: IPC v1 fixtures (valid + invalid), README; `bun run lint`, `bun test`.
4. [x] plugin: catalog entry + factory, `HudMessageCatalog` token, board standing high hint + tests,
       `GeneratorUI` wiring (activation / deactivation / overload / reset), `SidecarHudRules` + validator
       tests; `dotnet test`.
5. [x] Specs: slui `system-boundaries.md` + `cs2-visual-replication.md` §11, backend README, plugin
       `hud-semantic-model.md` / `sidecar-ipc.md`.
6. [x] slui `npm run lint`, `npm test`, `npm run build:local`, `npm run tauri:check`.
7. [ ] Deploy (user) and live test.
