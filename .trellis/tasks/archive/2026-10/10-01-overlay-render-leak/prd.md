# 修复 overlay 空闲高频重渲染与开发版 User Timing 内存泄漏

## Problem

`tauri dev` 下 overlay 的 WebView2 renderer 私有内存持续增长（实测 2.5 h 达 4 GB，约 27 MB/min）。

Diagnosis (2026-10-01):

- `useMinimapFeature` 无条件 `setInterval(tick, 32)`，每次 dispatch + `setNowMs`，整个 `App` 约 31 Hz 重渲染，
  包括 signed-out / 无地图等完全静态的状态。
- React 19.2 开发版在组件以变化的 props 重渲染时调用 `performance.measure("​Name", { detail: props diff })`。
  User Timing 缓冲区对 measure 不设上限、不自动清理；每条约 1 KB 原生内存。
  实测空闲 overlay 每秒新增约 470 条；合成 30 万条 ≈ +310 MB，`performance.clearMeasures()` 后可回收复用。
- 生产版 react-dom 不调用 `performance.measure`，但仍白白 31 Hz 重渲染。

## Requirements

1. 小地图本地时钟只在存在位置帧（`frame` 或 `pendingFrame`）时运行；没有帧时雷达视图与时间无关，不 tick。
   帧过期（stale）清掉后时钟随之停止。插值、渐隐标记、动态缩放、过期判定行为不变。
2. 开发版（`import.meta.env.DEV`）定期 `performance.clearMeasures()`，使 React 性能追踪条目占用有界。
   项目自身不使用 User Timing。

## Out of scope

- `tauri:build:local` 本地安装包仍打 React 开发版（用户确认测试用不上）。
- 把小地图 reducer 下沉到雷达组件以避免游戏中 App 全树 31 Hz 渲染。
- 商店 `commands` / 小地图 `knownMaps` 的微量无界增长。

## Acceptance

- 空闲 overlay（无小地图帧）不再周期性重渲染：dev 页面 10 s 内 measure 条目不再以每秒数百条增长。
- 开发版 measure 条目数有界。
- `npm run lint`、`npm test` 通过。
