# Design

## 边界

`WebSocketSidecarConnection` 已通过 `createSocket(url) => WebSocketLike` 注入 socket，会话逻辑只依赖
`readyState / onopen / onmessage / onclose / onerror / send / close`。因此只新增一个满足 `WebSocketLike`
的 Tauri 适配器，`connection.ts` 不动。

```
connection.ts ──WebSocketLike──> TauriSidecarSocket (src/platform/sidecarSocket.ts)
      invoke sidecar_open(url, channel) -> id        Channel<SidecarSocketEvent> <── Rust task
      invoke sidecar_send(id, data)                   open | message{data} | close{code, reason}
      invoke sidecar_close(id, code, reason)
                                 src-tauri/src/sidecar_socket.rs
                                 TCP → tokio-rustls(enable_sni=false, webpki-roots) → tokio-tungstenite
```

## Rust（`sidecar_socket.rs`）

- `sidecar_open`：解析 URL（`wss` 或回环 `ws`），分配 id，登记一个 `mpsc::UnboundedSender<Outgoing>`，
  在 Tauri 异步运行时上启动连接任务，立即返回 id。
- 连接任务：TCP connect → （wss）`TlsConnector::connect(ServerName(host), tcp)`，`ClientConfig.enable_sni = false`，
  根证书 `webpki-roots`，ring 提供算法 → `client_async(url, stream)`。成功发 `open`。
  之后 `select!` 读取对端帧与本地命令：Text → `message`；Close 帧 → 记录 code/reason；本地 Send → Text 帧；
  本地 Close → 发送 Close 帧并等待对端关闭。结束时发一次 `close{code, reason}` 并注销 id。
- 关闭码语义对齐浏览器：未收到 Close 帧（连接失败、TLS 失败、断线）→ `1006`，空 reason；
  收到无状态码的 Close 帧 → `1005`。Channel 发送失败（窗口已重载）→ 结束任务。
- 二进制帧忽略（sidecar 只发文本）；Ping/Pong 由 tungstenite 处理。
- 连接 / 握手超时由前端的 10 s open 超时负责（超时后前端 `close()` → 任务结束）。

## TS（`sidecarSocket.ts`）

- `TauriSidecarSocket implements WebSocketLike`：构造即 `invoke("sidecar_open")`；readyState 0 → 1（open 事件）→ 3（close 事件或本地 close）。
- `send` / `close` 经一条 Promise 链串行调用命令，保证帧顺序；`close` 后不再派发任何事件。
- 打开失败（命令报错）按浏览器语义派发 `error` + `close(1006)`。
- `App.tsx`：Tauri 中 `createSocket = createTauriSidecarSocket`，浏览器预览保持默认 `WebSocket`。

## 取舍

- 选 `webpki-roots` 而非系统证书库：结果确定、不依赖玩家系统证书状态；sidecar 证书是 Let's Encrypt。
- 选 ring 而非 aws-lc-rs：Windows 上不需要 cmake / nasm。
- 不发 SNI 对所有 sidecar 生效（不按主机切换）：未拦截 SNI 的主机同样可用（证书仍按主机名校验），无需配置。
