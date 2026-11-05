# 连接层：心跳与上限

## Goal

断掉的连接能被及时发现并重连；sidecar socket 的内存和数量有上限；会话重试不空转。

## Requirements

- C1 心跳：sidecar socket 和 `connection.ts` 在 live 之后都没有存活检测。切换 Wi-Fi、睡眠唤醒、NAT 超时后状态一直是 live，HUD 冻住且不重连。
  定期发 WS ping，规定时间内收不到 pong（或任何帧）就按 1006 关闭处理，走现有重连；必要时同时开 TCP keepalive。
  需要先确认 sidecar 服务端会回 pong（标准 WS 服务端会自动回）。
- S6 上限：`sidecar_socket.rs` 发送队列无上限；同时打开的 socket 数无上限（建议最多 2 个）。
  `steam_profile.rs` 读 `loginusers.vdf` 整文件读入并递归解析，加大小和深度上限。
- C2 `useClientSession.ts`：
  - updateRequired 且身份未读到时，每 3 秒 retryNow 一次永不停：updateRequired 期间跳过这个轮询重试。
  - retry 为 `"none"` 时提前 return，`liveSinceRef` 没清除，下次退避被错误重置为 1：状态一离开 live 就清除它。

## Acceptance Criteria

- [ ] 模拟对端静默（不回 pong、不发帧）时，在约定时间内进入重连。
- [ ] 发送队列满时按约定处理（丢弃并关闭连接或拒绝发送），有测试；第 3 个 socket 打开被拒绝。
- [ ] 超大或嵌套过深的 vdf 被拒绝，正常文件照常解析。
- [ ] C2 两条各有回归测试（smoke）。
- [ ] cargo clippy `-D warnings`、workspace 测试、`npm test` 通过。
