# 覆盖层隐藏时暂停逐帧循环

> 状态：待规划。开始前确认下方「待决事项」。范围在 2026-10-31 重测后缩小：首版的「小地图状态移出 `App`」和「时钟改 rAF」
> 已由 #53 等交付（`useMinimapFeature.ts` 的 store + `useSyncExternalStore`，时钟只在有位置帧时按 rAF 运行）。

## Goal

覆盖层窗口不可见时（游戏不在前台、UI 已停用），页面上的逐帧工作停止：雷达时钟不再派发 tick，`backdrop.ts` 不再逐帧测量面板；
重新显示后的第一帧即为最新状态。

父任务：`10-31-overlay-perf`（基线见其 `research/perf-baseline.md`）。

## Background

- 逐帧循环有两个：`src/features/minimap/useMinimapFeature.ts:86-102`（雷达时钟，有位置帧时每帧 `store.dispatch(tick)` 并重渲染雷达）、
  `src/platform/backdrop.ts`（`tick`/`send`，只要有登记的面板就每帧测量；雷达连接后一直登记）。
- Rust 用 `ShowWindow(SW_HIDE)` 和 `SetWindowPos(SWP_SHOWWINDOW)` 隐藏、显示覆盖层（`src-tauri/src/lib.rs:349-402`，`apply_overlay_input_mode` 与 `hide_overlay_window`），
  从不修改 WebView2 控件的 `IsVisible`；页面在窗口隐藏后很可能仍被 Chromium 视为可见，rAF 照常运行（未在 Windows 上验证）。
- 覆盖层隐藏的场景很常见：游戏不在前台时（切出、加载、桌面）覆盖层一直隐藏，插件仍可能在发送位置帧。

## Requirements（初稿）

- R1 覆盖层不可见时雷达时钟停止；可见后立即恢复，过期、淡出、插值、动态缩放恢复按本地时钟正确推进（与一直可见时的结果相同）。
- R2 覆盖层不可见时 backdrop 测量循环停止，可见后的第一帧重新测量并按需发送区域；Rust 侧在隐藏期间不收到多余的区域更新。
- R3 不改变显示/隐藏时序、焦点交还和输入模式。

## 待决事项（开始规划时向用户确认）

- 隐藏检测方式：
  - A：Rust 在隐藏/显示时同步 WebView2 控制器的 `IsVisible`。整个页面进入 hidden（rAF、定时器都被浏览器节流），收益最大，
    但需要在 Windows 上验证焦点、显示时序和重新显示时的首帧。
  - B：Rust 在隐藏/显示时发出覆盖层可见性事件，前端只暂停这两个循环。改动小、范围窄，其他定时器不受影响。
- 验证方式：本环境无法运行 Windows 版本，Rust 的 Windows 代码只能做交叉编译检查；需要在 Windows 上实测 rAF 在隐藏后是否仍在运行
  （先确认问题存在，再决定是否实施）。

## Acceptance Criteria（初稿）

- [ ] Windows 实测：覆盖层隐藏期间雷达时钟与 backdrop 循环的执行次数为 0（或按选定方案的约定），重新显示后雷达状态正确。
- [ ] 小地图相关冒烟测试与视觉审计通过；`npm run lint`、`npm test`、`npm run build:local` 通过。
