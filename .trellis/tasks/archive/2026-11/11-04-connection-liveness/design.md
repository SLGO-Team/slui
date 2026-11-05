# 设计：连接层心跳与上限

## C1 心跳（Rust `sidecar_socket.rs`）

- 正式构建的 sidecar 连接全部走 Rust（`TauriSidecarSocket`）；浏览器预览用的浏览器 WebSocket 无法发 ping，
  只用于开发，不加应用层心跳。
- 服务端（slgo-backend sidecar，Bun `idleTimeout: 30`）自动回 pong，空闲时自己也发 ping。
- live 之后每 10 s 发一个 Ping；从最后一次收到任何帧（文本、Ping、Pong、Close）起 25 s 内没有新帧，
  按 1006（无 close 帧）结束。前端 `failureForClose` 已把 1006 映射为 offline + backoff，现有重连接手。
- 发送（文本、Ping、Close）都限时 10 s：对端不读、TCP 发送缓冲区满时 `send().await` 会一直挂住，
  select 循环里的心跳也跑不到。超时按 1006 结束。
- 睡眠唤醒后计时已过期，第一次循环就判定断开并重连。TCP keepalive 不需要：应用层心跳覆盖了它的作用。

## S6 上限

- 发送队列：`mpsc::channel(64)`，`try_send`；满了说明连接卡死，通过 `Notify` 让该 socket 按 1006 结束
  （前端重连），不静默丢帧。连接建立前的早到帧同样最多 64 条。
- 同时打开的 socket 最多 2 个（一个在 2 s 关闭宽限期内的旧连接 + 一个新连接）。第 3 个 `sidecar_open` 返回错误，
  前端 `TauriSidecarSocket` 已把 open 失败当 1006 处理（backoff 重试）。只有 overlay 窗口建连接。
- `loginusers.vdf`：超过 1 MiB 不读（正常几 KB）；嵌套超过 8 层（正常 2 层）解析失败，按无名字处理。

## C2 `useClientSession`

- 身份轮询：`updateRequired` 期间整个轮询不触发重试。原因：该 attempt 不读身份，`state.identity` 为 null，
  已登录的账户每 3 s 都会被当成「换了账户」。逻辑抽成 `clientSession.ts` 的纯函数 `identityPollRetries` 供 smoke 测。
- 稳定 live 重置退避：live 记录为 `{ attempt, sinceMs }`，只有结束同一个 attempt 的失败才能用它重置计数
  （`failureCountFor`）。retry 为 none 的结束或新 attempt 开始后，旧 live 不再影响以后的退避。
  比「离开 live 就清除」更稳：同一 tick 里先到的 status 事件（retry 为 null）不会抢先把它清掉。

## 兼容与回滚

- 协议、服务端都不改。回滚即 revert 本 PR。
