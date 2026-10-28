# Tear down the game session when the player quits

## Goal

After the player quits SCP:SL, SLUI still shows the last session: home's server tile turns red
「未授权」 with the same-PC/network hint and a retry button, the overlay switch stays 「已启用」, the
overlay keeps the last match's HUD, scoreboard, killfeed and messages, and the session polls the control
plane every 5 s with no game running. Leaving a server for the main menu (game still running) shows the
same red 「未授权」 and keeps the old match too. The user asked for an elegant best-practice fix.

## Root cause

- The SCPSL.exe process probe (`slgo-game-running`, 2 s) only feeds home's 「游戏」 tile; neither the
  session nor the overlay state listens to it.
- The sidecar closes a player who left the server with 4001, the code shared with "address is not the
  game connection", so the client reports `unauthorized`. The spec forbids branching on close-reason text.
- Feature reducers drop their match only on `ended`; `unauthorized` / `not-in-game` keep it.

## Requirements

- One game run (one SCPSL.exe process) is one game session. The probe in Rust is its authority.
- Game exit (running → not running, including a crash):
  - Rust switches the overlay off through the same path as the tray / home switch (tray label, home
    switch and overlay follow). The next connection's auto-enable turns it on again as today.
  - The session stops: no proof, route or sidecar connection and no retry timer while the game is not
    running. It still reads the local Steam identity so home's Steam tile keeps working.
  - The session reports a new status `game-not-running`; every feature drops its match on it.
  - Home's server tile shows a muted 「未连接」 with the hint 「启动游戏后自动连接」, no retry button.
- Game start: the session starts a fresh attempt at once (no waiting for a retry timer).
- Leaving the server while the game runs: the sidecar closes with a new dedicated close code
  (`notOnServer`, 4004) — also used when a session opens for a player the roster does not list. The
  client maps it to `not-in-game` (home 「等待中」, route polled every 5 s), not `unauthorized`.
- `not-in-game` (the control plane / sidecar say the player is on no server) drops the match like
  `ended`, so nothing of the old match survives a server change.
- While the overlay is off and auto-enable is on, home's UI switch says it turns on by itself
  (「进入服务器后自动启用」).
- The browser preview and the `mock` mode have no game process: they behave as if the game runs.
- Compatibility: a new client against an old sidecar (4001) behaves as today; an old client against a new
  sidecar (4004) falls into its generic `offline` + backoff branch.

## Acceptance Criteria

- [ ] Quit the game while connected: within ~2 s home shows 「游戏 未运行」, server 「未连接 · 启动游戏后自动连接」
      (muted), UI 「已停用」, tray 「启用 UI」; no control-plane requests while the game stays closed.
- [ ] Relaunch and join: the session connects, the UI auto-enables, and no panel shows the old match.
- [ ] Leave a server for the main menu: server tile 「等待中」 (no red 「未授权」), the old match is gone;
      joining another server connects within ~5 s.
- [ ] Steam tile keeps the account while the game is closed (session smoke covers it; live check pending).
- [x] `npm run lint`, `npm test`, CI clippy (`-D warnings`) and workspace tests pass; backend `bun test` passes.
- [x] Spec, protocol README and backend decisions describe the lifecycle and the 4004 code.

## Status (2026-10-28)

Implemented and verified by lint, smokes, clippy, Rust and backend tests, and the home preview. The in-game checks
(first four criteria) need a build with the game; the sidecar part needs slgo-backend (`db90672`, local main) deployed.
