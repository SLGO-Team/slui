# 执行计划

1. `src-tauri/src/sidecar_socket.rs`：Heartbeat 常量、限时发送、有界队列 + Notify、socket 数上限；测试：
   静默对端在超时内结束为 1006、只回 pong 不发数据的对端不被断开、队列满触发 overflow、第 3 个 socket 被拒。
2. `src-tauri/src/steam_profile.rs`：文件大小上限、深度上限；测试：超深嵌套被拒、正常文件照常。
3. `src/app/clientSession.ts` 加 `identityPollRetries`、`failureCountFor`；`useClientSession.ts` 使用它们。
4. `scripts/backend-connection-smoke.mjs` 加两条回归。
5. spec：`.trellis/spec/frontend/system-boundaries.md` 连接生命周期补心跳与上限。

## 验证

```bash
cargo clippy --workspace --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --workspace --manifest-path src-tauri/Cargo.toml
npm run lint && npm test && npm run build
```
