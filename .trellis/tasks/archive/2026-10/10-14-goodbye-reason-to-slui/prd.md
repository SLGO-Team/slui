# 实例结束原因端到端传给 SLUI

## Goal

服务器实例结束（sidecar 4003）时，SLUI 按真实原因显示：重启显示"正在重启"，关服显示"服务器已关闭"，
等等。原因取自权威来源（游戏发给 LocalAdmin 的退出动作、插件自身生命周期、sidecar 观察到的事实），
不做启发式猜测。

## Requirements

- 协议（`packages/protocol`）新增 sidecar -> client 事件 `instance.ended { reason }`，在 4003 关闭前发送；
  4003 语义不变。旧客户端按 `unsupported-event-type` 跳过。reason 是开放枚举，客户端把未知值当成"未说明"。
- reason：`round-restart` / `server-restart` / `server-shutdown` / `server-stopped` / `plugin-disabled` / `lost`。
- 插件（../SLGO）：goodbye 原因精确到上述值，依据为 `StopNextRound`、游戏发给 LocalAdmin 的退出动作
  （Harmony 截取 `ServerConsole.AddOutputEntry`）和运维显式声明（控制台指令）；hello 声明能力 `exit-intent`。
- sidecar（../slgo-backend）：转发 goodbye 原因；新实例顶替 = `server-restart`；linger 超时 = `lost`；
  插件未声明 `exit-intent` 时不发原因（旧插件的 `server-shutdown` 含义不精确）。
- 部署（../slgo-deploy）：`slgoctl instance stop|restart`、游戏更新、发布重启前先经控制台声明意图。
- SLUI：主页与 HUD 按原因显示；带原因的 `ended` 在 quiet 重试中不被 `not-in-game` 覆盖，直到连上、手动重试或换号。
- 未带原因（旧 sidecar/旧插件）时保持现状（"正在重启"）。

## Acceptance Criteria

- [x] 协议：类型、解析器、v0 schema + 示例、README；`npm test` 覆盖解析（含未知 reason 不拒流）。
- [x] SLUI：连接层记录原因，会话层保持原因，主页 / HUD 文案按原因；冒烟测试覆盖。
- [x] sidecar：IPC schema / 夹具、hub 发送 `instance.ended`、单测；`bun run lint`、`bun test` 通过。
- [x] 插件：退出意图记录、goodbye 原因、能力声明、控制台指令；`dotnet test` 通过。
- [x] 部署：slgoctl 在停 / 重启前声明意图；脚本测试通过。
- [x] spec：slui system-boundaries、SLGO sidecar-ipc、slgo-backend ipc README、slgo-deploy operations 更新。
