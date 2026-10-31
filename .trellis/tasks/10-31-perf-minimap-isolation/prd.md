# 小地图状态下沉与隐藏暂停

> 状态：待规划。依赖子任务 1（`10-31-perf-memo-panels`）完成后开始，开始前确认下方「待决事项」。

## Goal

小地图的状态、时钟和位置帧更新只重渲染雷达自身，不再让 `App` 整树提交；覆盖层不可见时雷达时钟停止。

父任务：`10-31-overlay-perf`（基线见其 `research/perf-baseline.md`）。

## Background

- `useMinimapFeature` 在 `App.tsx:94` 调用，`useMinimapFeature.ts:52-58` 的 `setInterval(tick, 32)` 和每个 15 Hz 位置帧都更新 `App` 状态：React 提交 47 次/秒。
- `.trellis/spec/frontend/quality-guidelines.md` 记录了现状：「Feature hooks live in App, so every tick re-renders the whole overlay」，时钟只在存在位置帧时运行。
- 覆盖层由 Rust 直接调用 `ShowWindow(SW_HIDE)` / `SetWindowPos(SWP_SHOWWINDOW)` 隐藏与显示（`src-tauri/src/lib.rs:198-249`），从不修改 WebView2 控件的 `IsVisible`；
  页面在窗口隐藏后很可能仍被 Chromium 视为可见，定时器和渲染照常运行（未在 Windows 上验证）。
- `App` 已有游戏前台状态订阅（`subscribeGameForeground` → `minimapFeature.setGameForeground`）。

## Requirements（初稿）

- R1 小地图 reducer、时钟和视图模型归属一个雷达容器组件；`App` 只把事件、诊断、连接状态、前台状态和雷达设置交给它，不持有每帧变化的状态。
- R2 时钟改为 `requestAnimationFrame` 驱动并保持现有约 30 Hz 的更新节奏（与 32 ms 等效），页面不可见时自动停止。
- R3 覆盖层窗口隐藏时雷达时钟停止，重新显示后第一帧即为最新状态（过期、淡出等按本地时钟正确推进）。
- R4 现有行为不变：过期判定、插值、淡出、动态缩放恢复、调试接口 `__SLUI_MINIMAP_DEBUG__`。

## 待决事项（开始规划时向用户确认）

- 隐藏检测方式与 Windows 侧验证：Rust 在隐藏/显示时同步 WebView2 `IsVisible`（影响整个页面，收益最大，需在 Windows 上验证焦点与显示时序），
  或 Rust 发出覆盖层可见性事件、只暂停雷达时钟（改动小、范围窄）；本环境无法运行 Windows 版本，Rust 的 Windows 代码只能做交叉编译检查。

## Acceptance Criteria（初稿）

- [ ] `profile-overlay.cjs` 默认场景：`App` 级提交不再随雷达时钟发生（HUD/商店/聊天仍 ≤ 5 次/秒，`App` 自身 ≤ 5 次/秒），雷达约 30 次/秒。
- [ ] 小地图相关冒烟测试与视觉审计通过。
- [ ] 隐藏暂停的验证方式按待决事项的结论执行。
