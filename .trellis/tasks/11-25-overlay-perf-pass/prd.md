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

- [ ] 每项改动说明了热路径、原开销和改后开销。
- [ ] `npm run lint`、`npm test` 通过。
- [ ] 画面输出不变（相关 layout/visual audit 若能在本机跑则跑）。
