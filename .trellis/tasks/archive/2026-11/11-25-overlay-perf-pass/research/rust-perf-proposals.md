# Rust 侧性能方案（待 Windows 上实现和验证）

2026-11-25：Linux 云端 `cargo check` 失败（缺 `gdk-3.0` 系统库），本轮未改 Rust 代码。
以下方案行为不变；落地前需在 Windows 跑 `cargo clippy --all-targets -- -D warnings` 和 `cargo test`。

## 值得做

1. `src-tauri/src/backdrop.rs` `Engine::render`（约 845 行）：world blur 每个游戏帧都跑
   （`SetMinUpdateInterval` 1 ms，144 Hz+），`let plan = self.plan.clone();` 每帧克隆 `Vec<Placed>`。
   改为 `std::mem::take(&mut self.plan)`，主体放进辅助函数，所有退出路径（含 `ensure_swap` /
   `ensure_scratch` 的 `?`）都把 plan 放回；或改存 `Arc<Plan>`（约 1112 行的比较改为 `*engine.plan`）。
2. `src-tauri/src/sidecar_socket.rs` 中继热路径（约 340 行）：`data: text.to_string()` 每帧复制一次，
   之后 `Channel::send` 序列化再复制一次。`SidecarSocketEvent::Message { data }`（约 83 行）改存
   `tungstenite::Utf8Bytes`，`#[serde(serialize_with = ...)]` 用 `serialize_str(data.as_str())`，
   JSON 输出逐字节相同；测试里的 `"baseline".into()` 仍可编译。大 baseline 帧（上限 16 MiB）收益最大。
3. `src-tauri/src/game_log.rs`（约 53 行）：`from_utf8_lossy(..).into_owned()` 总是复制最多 1 MiB。
   改为 `buffer.truncate(taken); String::from_utf8(buffer).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())`。
   优先级低（只在 game-log proof 轮询时跑）。

## 需要改前端/协议，本轮不做

4. 每帧 JSON 文本又被当作字符串转义进 `{"kind":"message","data":"..."}`：体积变大，超过 8192 字节时
   Tauri channel 走较慢的 IPC 取回路径，webview 还要解析两次。改为原样转发（`RawValue` 或
   `InvokeResponseBody::Raw`）需要同步改 `src/platform/sidecarSocket.ts` 的接收类型。

## 已检查、无需改

- `lib.rs` 100 ms 前台轮询：进程路径已缓存，各 publish 只在变化时发。
- socket 中继：mutex 不跨 await，`diag!` 只在错误路径，计时器和队列上限符合规格。
- 2 s 进程扫描每个进程一次 `from_utf16` 分配：频率低，不值得冒险。
