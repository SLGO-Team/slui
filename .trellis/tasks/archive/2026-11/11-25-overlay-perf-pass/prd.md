# Overlay 运行时性能优化

## Goal

降低游戏内 overlay 每帧的 CPU 和 React 重渲染开销，**画面不变**。

## Scope（三块，文件互不重叠，可并行）

1. 小地图渲染路径：`src/features/minimap/`。
2. 其他 HUD 与事件路由：`src/features/`（除 minimap）、`src/app/`、`src/platform/`、`src/App.tsx`。
3. Rust 中继：`src-tauri/src/sidecar_socket.rs` 及其向 webview 发事件的路径。

## Constraints

- 不改任何像素输出、布局、动画时序；不改协议和命令。
- 每处优化要有依据（热路径上的分配、重复计算、无效重渲染、未节流的高频更新），不做投机性改动。
- `npm run lint` 和 `npm test` 必须通过；Rust 改动需 `cargo check` / clippy `-D warnings` 能在本机验证，否则不改。
- 不写控制平面 host、真实 SteamID 或玩家名。

## Acceptance Criteria

- [x] 每项改动说明了热路径、原开销和改后开销（见两次 perf 提交说明）。
- [x] `npm run lint`、`npm test` 通过。
- [x] 画面输出不变：小地图 model/integration smoke 通过；`minimap-visual-audit` 在 Linux 云端改动前后都停在「radar 未 live」，属环境问题，未能截图对比。

## 结果（2026-11-25）

- 小地图：静止的点/钥匙卡/炸弹点按浅比较跳过渲染；缓冲帧按玩家建索引；动态缩放关闭时不再序列化 identity；偏好只规范化一次。
- HUD：聊天花名册不变时保持原 state；正式构建渲染不再解析 URL。
- Rust：云端缺 `gdk-3.0` 无法编译，未改代码；方案见 `research/rust-perf-proposals.md`，需在 Windows 上实现并跑 clippy / cargo test。
