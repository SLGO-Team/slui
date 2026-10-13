# SLUI 经 Rust 层无 SNI 连接 sidecar

## Goal

游戏主机所在 IDC 按 SNI 白名单拦截入站 TLS：带未加白域名的握手被重置，不带 SNI 的握手正常。
webview 层的 `WebSocket` 无法关闭 SNI，因此 SLUI 必须把 sidecar 的 WebSocket 移到 Tauri 的 Rust 层，
用 rustls 建立**不发 SNI、但仍按 URL 主机名严格校验证书**的 TLS 连接。

背景与决定见 `../slgo-deploy` 的父任务 `10-11-host-migration`（D1、D2、P3）。

## Requirements

- Tauri 构建中，sidecar 连接由 Rust 层建立：
  - `wss://`：TCP 连接 URL 主机与端口，TLS 握手**不带 SNI 扩展**；证书按 URL 主机名校验，信任 Mozilla 根证书集（含 Let's Encrypt 的 ISRG Root），校验失败即连接失败，不提供任何跳过校验的开关。
  - `ws://`：只允许回环主机（开发用 `VITE_DEV_SIDECAR_ENDPOINT`），其他主机拒绝。
- 前端通过 Tauri 命令发送 / 关闭，通过 Channel 接收 open / message / close；`WebSocketSidecarConnection` 的会话（`session.open`、baseline、features）、超时、重连与关闭码映射（4000–4003，其他 → offline）语义保持不变。
- 浏览器预览（非 Tauri）继续使用 webview 的 `WebSocket`。
- 控制面仍走 webview `fetch`；正式地址由构建时 `VITE_CONTROL_PLANE_URL` 注入（`slgo-deploy` 的 `build-slui` 按中心机域名生成），仓库内不写生产地址。

## Acceptance Criteria

- [ ] `npm run lint`、`npm test`、`cargo test --workspace`、hakari 检查通过。
- [ ] Rust 测试证明：握手不带 SNI；证书主机名不匹配时连接失败；`ws://` 非回环被拒绝。
- [ ] 用 `slgo-deploy` 的 `build-slui` 构建群内版，实测能登录并连上游戏主机 sidecar（该主机带 SNI 的握手被重置，可用 `openssl s_client -noservername` 对照）。

## Out of Scope

- 控制面请求改走 Rust 层（中心机不拦截 SNI）。
- sidecar / control plane 协议变更。
