# HUD/商店/聊天组件 memo

> **已被替代，未在本任务实施（2026-10-31 重测后归档）。** 本 PRD 依据的是过时快照（`23q3/slui` main，2026-10-03）。
> 目标已由 #53「panels select their own time from a shared clock」（归档任务 `10-23-overlay-clock`）交付：
> `HudTeamCounter`、`ShopPanel`、`ChatInput` 已是 `memo` 组件，`App` 不再持有时钟状态，小地图状态在 store 中。
> 重测（父任务 `research/perf-baseline.md`）：默认雷达下三者 0 次/秒，`App` 1.1 次/秒。以下为原规划，仅作记录。

## Goal

小地图时钟（32 ms）和位置帧（15 Hz）每次更新 `App` 状态时，`HudTeamCounter`、`ShopPanel`、`ChatInput` 不再跟着重渲染；
它们只在自己的 props 变化时渲染（目前由 250 ms 全局时钟驱动，约 4 Hz）。

父任务：`10-31-overlay-perf`（实测基线见其 `research/perf-baseline.md`）。

## Background

- `App.tsx` 每次提交都会重新渲染全部子组件；三个组件都不是 memo 组件。基线：四个顶层组件各 47 次/秒，`PlayerSlot` 472 次/秒。
- 已核对 `App.tsx` 中传给三者的 props 在两次 250 ms tick 之间引用稳定，memo 可以直接生效：
  - `HudTeamCounter`：`hud`（`useMemo([hudState, nowMs])`，调试模式为 `debugHud`）、`playerMeta`（`useMemo([hud])`）、`variant`（字符串）。
  - `ShopPanel`：`shop`（`useMemo([shopFeature.state, nowMs])` 或 `debugShop`）、`role`/`open`/`volume`/`countdownSeconds`/`countdownPaused`（原始值）、`onPurchase`（`useCallback`，依赖均为稳定回调）、`onClose`（稳定）。
  - `ChatInput`：`chat`（reducer 状态）、`nowMs`、`self`（`useMemo([hud, localSteamId])`）、`onDraft`/`onToggleScope`（`useCallback([])`）、`onSubmit`（依赖 `chatScope`）、`onClose`（稳定）、`onDiagnostic`（`overlayController.log`，对象字面量方法，引用稳定）。
- 三个组件内部的 `useOverlayScale` 是组件自身状态，memo 不影响窗口缩放时的更新。
- 实验（临时副本）：加 memo 后三者重渲染降到 4.0 / 4.0 / 5.1 次/秒，主线程 Task 时间 -14%（开发版）。

## Requirements

- R1 `HudTeamCounter`（`src/features/hud/HudTeamCounter.tsx`）、`ShopPanel`（`src/features/shop/ShopPanel.tsx`）、`ChatInput`（`src/features/chat/ChatInput.tsx`）改为 `React.memo` 组件，使用默认浅比较。
- R2 导出名与 props 类型不变，`App.tsx` 与其他引用方无需改动；内部函数保留原名（`memo(function HudTeamCounter(...))`），便于 React DevTools 和 `profile-overlay.cjs` 识别。
- R3 不改变渲染输出和交互行为（聊天打开/输入/发送/关闭、商店打开/选择/购买/关闭、HUD 变体切换、窗口缩放）。
- R4 如果实施中发现某个 prop 在 tick 之间引用不稳定，在 `App.tsx` 用 `useMemo`/`useCallback` 稳定它，而不是给组件写自定义比较函数。

## Acceptance Criteria

- [ ] `profile-overlay.cjs` 默认雷达场景：`HudTeamCounter`、`ShopPanel`、`ChatInput` 各 ≤ 5 次/秒（基线 47）；`MinimapRadar` 与 React 提交次数不变（隔离属于子任务 4）。
- [ ] `npm run lint`、`npm test`、生产构建（`VITE_CONTROL_PLANE_URL=… npx vite build`）通过。
- [ ] `npm run dev:mock` 下：`?shopOpen=1` 打开商店并能选择、购买；聊天打开、输入、发送、关闭正常；HUD 调试面板切换变体后 HUD 立即更新。
- [ ] `.trellis/spec/frontend/quality-guidelines.md` 中关于 App 每次 tick 重渲染整个覆盖层的说明更新为：三个面板已 memo，`App` 传给它们的 props 必须在 tick 之间保持引用稳定。

## Out of Scope

- `MinimapRadar` 的 memo 与小地图状态隔离（子任务 4）。
- 降低 250 ms 时钟引起的 4 Hz 重渲染（selector 结构共享，父任务已列为后续项）。
- `PlayerSlot` 等内部子组件的单独 memo。
