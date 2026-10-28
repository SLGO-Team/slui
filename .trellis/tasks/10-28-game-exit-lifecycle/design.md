# Design

## Lifecycle model

A game run = one SCPSL.exe process, as seen by Rust's Toolhelp32 probe (`GameRunningState`, 2 s). It is
the only authority for "the game is closed". Whether the player is on a server comes from the backend
(control plane `not-in-game`, sidecar `notOnServer`). Three ways a player's match ends, one effect:

| Cause | Status | Who decides |
|---|---|---|
| instance ended (restart, shutdown, …) | `ended` | sidecar 4003 |
| player on no server (left, or never joined) | `not-in-game` | control plane / sidecar 4004 |
| game process gone | `game-not-running` (new) | Rust probe |

`endsMatch(status)` (src/contracts) is true for exactly these three; every feature reducer resets to its
initial state on it (they already do so for `ended`). Lost connections (`offline`, `stale`,
`unauthorized`) keep the state for a reconnect, unchanged.

## Rust (src-tauri/src/lib.rs)

`start_game_process_tracking`: on a running → not running change, after emitting `slgo-game-running`,
schedule on the main thread (where the enable command and tray run) `apply_overlay_enabled(false)` if the
overlay is enabled. It hides the window, drops interaction, updates the tray label and broadcasts
`slgo-overlay-state`; the overlay page already closes shop, chat and team menu on that event.

## Overlay session (src/app)

- `useGameRunning()` (overlay): `createGameProcessSource()` subscribe + get; `true` in the mock mode and
  outside Tauri; `null` until the first answer.
- `useClientSession(..., gameRunning)`: no attempt while `null`. Attempts get a monotonically increasing
  number (a ref), so a game start/exit re-run never reuses the previous attempt's number.
- `runClientSessionAttempt(..., gameRunning)`: when false, it reads the identity (errors → null), then
  dispatches `{ type: "game-not-running", identity }` and reports status `game-not-running` through
  `onStatus` — no `discover` step, so home never flashes; no proof, route or connect; `retry` stays null,
  so no timer. The 3 s identity poll still restarts it on an account switch.
- Reducer: `game-not-running` → status `game-not-running`, identity, detail null, retry null, endReason null.

## Protocol (packages/protocol) and sidecar (slgo-backend)

`SIDECAR_CLOSE_CODES.notOnServer = 4004`: the server's roster does not list the player (they left, or are
not on it yet). Hub: `updateRoster` closes a departed player with 4004 (address change stays 4001);
`openClient` refuses an unlisted player with 4004. Client `failureForClose(4004)` →
`{ status: "not-in-game", retry: "poll" }`.

## Home

- `SERVER_STATUS["game-not-running"] = { label: "未连接", tone: "muted", retry: false, hint: "启动游戏后自动连接" }`.
- `OverlaySwitch` gets `autoEnable`: while off and auto-enable is on, a caption 「进入服务器后自动启用」.
- `CONNECTION_STATUSES` (session bridge parser) lists the new status.

## Compatibility / rollout

New client + old sidecar: 4001 as before. Old client + new sidecar: 4004 → generic `offline` + backoff
(was `unauthorized` + backoff). The client can ship first; the sidecar deploy enables part 2.
