# Design: instance end reasons

## Source of truth per reason

| reason | Who knows | How |
|---|---|---|
| `round-restart` | plugin | `OnRestartingRound` with `StopNextRound == DoNothing` (soft round restart, new instance_id follows) |
| `server-restart` | game / ops / sidecar | round end with `StopNextRound == Restart`; process quit after the game told LocalAdmin `ExitActionRestart` (`rnr`, central-server forced restart, `restart_after_rounds`); `slgo-exit-intent restart`; sidecar sees a new instance_id for a server_id whose instance never said goodbye (crash + LocalAdmin relaunch) |
| `server-shutdown` | game / ops | round end with `StopNextRound == Shutdown`; quit after `ExitActionShutdown`/`ExitActionSilentShutdown` (`quit`, `snr`, `redirect`); `slgo-exit-intent shutdown` |
| `server-stopped` | plugin | process quit with no declared exit action (external SIGTERM nobody declared) |
| `plugin-disabled` | plugin | SLGO unloaded while the server keeps running |
| `lost` | sidecar | plugin link gone longer than the 60 s linger |

`ExitAction*` entries are the exact signal LocalAdmin uses to decide whether to relaunch the game, so the
plugin and the supervisor can never disagree. `ExitActionReset` clears the declared action.

## Wire

- IPC (plugin -> sidecar): `goodbye.reason` gains `round-restart`, `server-restart`, `server-stopped`
  (existing: `server-shutdown`, `plugin-disabled`, `other`). hello capability `exit-intent` marks a plugin
  whose reasons are exact; without it the sidecar forwards no reason.
- Client (sidecar -> SLUI): `instance.ended` envelope event (`round_id: null`, `sent_at` required),
  payload `{ reason: string }` (1..64 chars), sent to every client of the instance immediately before the
  4003 close. Not cached, not replayed. Unknown reason values are accepted by the parser and treated as
  "unspecified" by SLUI (forward compatible; never rejects the stream).

## SLUI

- `WebSocketSidecarConnection` remembers the reason of an accepted `instance.ended`; `failureForClose(4003)`
  carries it as `ConnectionFailure.endReason`.
- `ClientSessionState.endReason`: set by `failed(ended)` (`action.endReason ?? state.endReason`, so a
  reroute refused with a bare 4003 keeps it); kept by `failed(not-in-game)`, which then keeps status
  `ended`; kept by non-live connection progress; cleared by everything else (live, other failures,
  non-quiet discover / signed-out).
- `SessionStatusSnapshot.endReason` carries it to the home window; `serverStatus` picks the copy.
- HUD: `selectRoundHud(state, nowMs, endReason)` picks the `ended` label from the session's reason.

| reason | home label / hint | HUD |
|---|---|---|
| none, `round-restart`, `server-restart` | 正在重启 / 服务器重启后自动重连 | SERVER RESTARTING |
| `server-shutdown` | 服务器已关闭 / 等待服务器重新上线 | SERVER CLOSED |
| `server-stopped` | 服务器已停止 / 等待服务器重新上线 | SERVER STOPPED |
| `plugin-disabled` | SLGO 已停用 / 等待服务器重新启用 SLGO | SLGO DISABLED |
| `lost` | 服务器失联 / 等待服务器恢复连接 | SERVER LOST |

## Plugin

- Harmony postfix on `ServerConsole.AddOutputEntry` records the last exit action
  (`GameExitIntent`: none / restart / shutdown).
- `OnRestartingRound`: DoNothing -> `round-restart` (unchanged flow); Restart -> `server-restart`;
  Shutdown -> `server-shutdown`.
- `OnApplicationQuitting`: from the recorded exit action; none -> `server-stopped`.
- Console command `slgo-exit-intent <restart|shutdown>` (server console only): says goodbye at once with
  that reason and arms the soft-restart re-handshake, so an aborted stop heals at the next
  WaitingForPlayers. Idempotent; does not touch `StopNextRound` or LocalAdmin.

## Deploy

`slgoctl instance stop|restart`, `game update` and release restarts send `slgo-exit-intent shutdown|restart`
through the existing console path (tmux send-keys) right before the compose action. Failure to send is a
warning, not an abort (the stop still happens; SLUI then sees whatever the game declares).

## Compatibility / rollout

Deploy order: sidecar -> plugin (an old sidecar rejects the new goodbye values). Old SLUI ignores
`instance.ended`. New SLUI with an old sidecar shows today's copy.
