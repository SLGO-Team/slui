# Implement

1. `src-tauri/Cargo.toml` 增加 `tokio`、`tokio-rustls`（ring）、`webpki-roots`、`tokio-tungstenite`（仅 handshake）、`futures-util`；
   `cargo hakari generate && cargo hakari manage-deps`。
2. `src-tauri/src/sidecar_socket.rs`：命令 `sidecar_open / sidecar_send / sidecar_close`，在 `lib.rs` 注册与 `manage`。
   测试：本地 rustls 服务器 + rcgen 自签证书，验证无 SNI、主机名不匹配失败、非回环 `ws://` 拒绝、文本往返与关闭码。
3. `src/platform/sidecarSocket.ts` + `App.tsx` 接入；`scripts/backend-connection-smoke.mjs` 增加适配器测试（假 invoker / Channel）。
4. spec：`system-boundaries.md` 3.0 节与命令表补充 Rust sidecar socket。
5. 验证：`npm run lint`、`npm test`、`cargo test --workspace --manifest-path src-tauri/Cargo.toml`、
   `cargo hakari generate --diff && cargo hakari manage-deps --dry-run`；`build-slui` 群内版实测登录 + 连上游戏主机 sidecar。
