# 覆盖层隐藏时暂停逐帧循环

> 状态：2026-11-03 在本地 Windows 上确认问题存在后实施（方案 B，见「决定」）。范围在 2026-10-31 重测后缩小：首版的「小地图状态移出 `App`」和「时钟改 rAF」
> 已由 #53 等交付（`useMinimapFeature.ts` 的 store + `useSyncExternalStore`，时钟只在有位置帧时按 rAF 运行）。

## Goal

覆盖层窗口不可见时（游戏不在前台、UI 已停用、会话未连上），页面上的逐帧工作停止：雷达时钟不再派发 tick，雷达不再随位置帧重渲染，
`backdrop.ts` 不再逐帧检查面板；重新显示后立即恢复，雷达与世界模糊区域按当前状态绘制。

父任务：`10-31-overlay-perf`（基线见其 `research/perf-baseline.md`）。

## Background

- 逐帧循环有两个：`src/features/minimap/useMinimapFeature.ts`（雷达时钟，有位置帧时每帧 `store.dispatch(tick)` 并重渲染雷达）、
  `src/platform/backdrop.ts`（`tick`，只要有登记的面板就每帧检查；雷达连接后一直登记）。
- Rust 用 `ShowWindow(SW_HIDE)` 和 `SetWindowPos(SWP_SHOWWINDOW)` 隐藏、显示覆盖层（`src-tauri/src/lib.rs` 的 `apply_overlay_input_mode` 与 `hide_overlay_window`），
  从不修改 WebView2 控制器的 `IsVisible`；wry 只在创建时按 webview 属性设一次 `IsVisible(true)`。

### Windows 实测（2026-11-03，WebView2 156.0.4314.58，165 Hz 显示器）

开发版 SLUI（独立 identifier，`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`），经 CDP 在覆盖层页面里计数，
用 Win32 调用复现 Rust 的显示 / 隐藏（脚本与结果在父任务 `research/hidden-pause/`）：

| 窗口状态 | `document.visibilityState` | rAF 次/秒 |
|---|---|---|
| 创建后从未显示（`visible: false`） | visible | 166 |
| `SetWindowPos(SWP_SHOWWINDOW)` 之后 | visible | 167 |
| `ShowWindow(SW_HIDE)` 之后、5 s 之后 | visible | 166–167 |

隐藏的覆盖层页面仍按显示器刷新率运行 rAF。mock 模式（雷达有位置帧、世界模糊面板已登记）下窗口隐藏时：
雷达相机改写 180 次/秒，backdrop 检查 165 次/秒（完整测量 2 次/秒），渲染进程约 520 ms/s CPU（开发版 React），GPU 进程约 484 ms/s。

## 决定（2026-11-03）

- 采用方案 B：Rust 在每次原生显示 / 隐藏之后读取 `IsWindowVisible`，变化时向覆盖层发 `slgo-overlay-visibility`（带 revision，配 `get_overlay_visibility` 查询）；
  前端只暂停逐帧工作。
- 不采用方案 A（隐藏时把 WebView2 的 `IsVisible` 设为 false）：页面会整体进入 hidden，Chromium 会节流定时器（隐藏 5 分钟后链式定时器约每分钟一次）。
  覆盖层在会话未连上时也一直隐藏，会话连接、重试和身份轮询都在这段时间运行，节流会拖慢进入服务器后的连接。

## Requirements

- R1 覆盖层不可见时雷达时钟停止，雷达也不随位置帧重渲染（store 照常处理事件，状态保持最新）；可见后雷达立即按最新状态渲染，时钟恢复，
  过期、淡出、插值、动态缩放按本地时钟继续推进。
- R2 覆盖层不可见时 backdrop 逐帧检查停止；面板登记 / 移除照常立即发送（世界模糊窗口显示时不能残留已关闭面板的区域）；
  可见时立即测量一次并按需发送，然后恢复逐帧检查。
- R3 不改变显示 / 隐藏时序、焦点交还和输入模式；浏览器预览（无原生窗口）始终视为可见。
- R4 可见性来源失败（监听或查询出错、载荷格式错误）时按可见处理，行为与改动前相同。

## Acceptance Criteria

- [x] Windows 实测：覆盖层隐藏期间雷达相机改写与 backdrop 检查次数为 0；重新显示后两者恢复，雷达状态正确。
- [x] 前后对比：mock 模式覆盖层隐藏时渲染进程与 GPU 进程 CPU 明显下降（记录数据）。
- [x] 新增冒烟测试覆盖可见性来源（先监听后查询、revision 只前进、失败按可见）；`npm run lint`、`npm test`、`npm run build:local` 通过；
  Rust `cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace` 通过。
- [x] `npm run minimap-visual-audit` 通过。
- [x] `.trellis/spec/frontend/system-boundaries.md` 3.1 写明新事件与暂停规则。

## 结果（2026-11-03）

- mock 模式覆盖层隐藏时：雷达相机改写 180 → ~1 次/秒（App 自身重渲染带动），backdrop 检查 165 → 0；渲染进程 ~520 → ~37 ms/s，GPU 进程 ~484 → 0 ms/s。
- 端到端（替身 `SCPSL.exe` 占前台 5 s）：Rust 显示（revision 1）后雷达与 backdrop 在 500 ms 采样内恢复，隐藏（revision 2）后回到 0。
