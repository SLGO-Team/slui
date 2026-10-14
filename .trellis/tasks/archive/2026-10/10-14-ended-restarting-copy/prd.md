# ended 状态改为正在重启语义

## Goal

sidecar 以 4003 关闭会话后 SLUI 进入 `ended`。最常见的来源是服务器重启（整服重启、软轮次重启），
现有文案"服务器已关闭 / SERVER CLOSED"偏"关闭"。把 `ended` 的提示改成"正在重启"的语义。

## Requirements

- 主页：`ended` 的 label 改为"正在重启"，hint 改为"服务器重启后自动重连"（tone 仍为 pending，无重试按钮）。
- 覆盖层 HUD：`ended` 的 statusLabel 改为 `SERVER RESTARTING`（与已有的 `SERVER RESTARTED` 对应）。
- 不加"长时间未重连 → 已关闭"的计时器：`ended` 是过渡态，quiet reroute（1/2/4/8 s 退避）在控制面
  下一次注册刷新（sidecar 每 10 s 注册）后得到新结果，最迟约 15 s 会被新实例（同步中/已连接）、
  `not-in-game`（等待中 / 等待进入游戏服务器）或 `offline` 替代；"长时间没重连"已由 `not-in-game` 表达。
- 按关闭原因区分"关服 / 重启"不在本任务内：所有插件告别在 sidecar 里都映射为同一句 4003 reason，
  reason 文本也不是协议契约；需要改协议，另开任务。
- 不改协议，不改 `packages/protocol`。

## Acceptance Criteria

- [x] `src/app/home/status.ts` 的 `ended` 为"正在重启 / 服务器重启后自动重连"。
- [x] `src/features/hud/model.ts` 的 `ended` statusLabel 为 `SERVER RESTARTING`。
- [x] `scripts/hud-model-smoke.mjs` 断言新文案。
- [x] `.trellis/spec/frontend/system-boundaries.md` 描述 `ended` 的新语义和后续状态转换。
- [x] `npm run lint`、`npm test` 通过。
