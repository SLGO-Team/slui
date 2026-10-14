# 把插件告别原因结构化传给 SLUI

## Goal

让 SLUI 能按实例结束的原因选择提示（例如软轮次重启显示"正在重启"，插件停用或服务器下线显示别的文案），
而不是像现在这样把所有 4003 都当成同一种 `ended`。来自任务 `10-14-ended-restarting-copy` 的结论。

## 现状（2026-10-14 调查）

- 插件 IPC `goodbye.reason` 是 `server-shutdown | plugin-disabled | other`（软轮次重启走 `other`），
  sidecar 只写进日志，`detachPlugin(graceful)` 一律以 `"Server instance ended"` 关闭 4003。
- sidecar 的其他 4003：新 hello 顶替旧实例 `"Server instance restarted"`；插件断线超过 linger
  `"Server instance lost"`；reroute 打开已不存在的实例 `"Routed server instance is not available"`。
- `packages/protocol` 只定义了关闭码 `instanceUnavailable: 4003`；reason 文本不是契约，SLUI 不能拿它分支。
- `server-shutdown` 同时包含整服重启和真关服：CS2 进程退出时插件也不知道会不会被拉起，
  所以即使改了协议，也分不出"重启"和"关服"，只能分出软重启、插件停用、实例丢失和服务器下线。

## Requirements（待细化）

- 在协议里加结构化的结束原因（新关闭码，或关闭前的结束事件），由 sidecar 从 goodbye / linger / 顶替转发过来。
- 跨仓库：`packages/protocol`（slui）、sidecar（slgo-backend）、插件（SLGO，可能不需要改，reason 已存在）。
- 向后兼容：旧 sidecar 只发 4003 时，SLUI 仍按 `ended`（正在重启）处理。
- SLUI 各原因的文案待定。

## Acceptance Criteria

- [ ] 设计确定（关闭码还是事件，兼容策略），并经用户确认。
