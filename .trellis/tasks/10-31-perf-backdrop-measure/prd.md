# backdrop 测量循环瘦身

> 状态：待规划。2026-10-31 重测中发现，按用户授权立项；开始前确认下方「待决事项」。

## Goal

画面静止时，`src/platform/backdrop.ts` 不再每帧对每个登记面板重新读取布局与样式；面板移动、缩放、淡入淡出或过渡动画期间仍逐帧跟踪，
世界模糊区域与现在一样贴合面板。

父任务：`10-31-overlay-perf`（基线见其 `research/perf-baseline.md`）。

## Background

- `backdrop.ts` 的 `tick` 只要有登记的面板就每帧运行 `send()`：对每个元素调用 `measure`，从元素一路向上对每个祖先 `getComputedStyle`
  （读 `display`、`visibility`、`opacity`、`transform`），再读 `getBoundingClientRect`、`offsetWidth/Height`、`clipPath`、`borderTopLeftRadius`；
  结果量化后与上次比较，只有变化才发给 Rust（`set_backdrop_regions`）。文件头注释写明「a still panel costs a layout read per frame」。
- 登记方（`useBackdropRef`）：HUD 装备面板、底部 HUD 卡片、击杀信息、消息区、进度卡、胜负面板、记分板、商店遮罩、雷达视口；
  游戏中通常同时登记多个，雷达连接后一直登记。
- 开发版 CPU 剖析（默认雷达，mock 预览）：`measure` 自身约 12–15 ms/s，另外它在雷达每帧改写 DOM 之后读取布局，可能触发强制同步布局。
  正式包里的占比未单独测出（函数名被压缩）。
- 面板的可见变化来源：React 改写 DOM/样式、CSS 过渡与关键帧动画（如商店 `height .2s`、卡片淡入淡出）、窗口缩放（覆盖层缩放变量）。

## Requirements（初稿）

- R1 没有任何可能改变已登记面板几何或不透明度的事件时，不执行逐元素测量。
- R2 面板几何或不透明度可能变化时（DOM/属性变化、过渡或动画进行中、窗口尺寸变化、面板登记/注销），按现在的方式逐帧测量，直到连续若干帧不再变化。
- R3 发送给 Rust 的区域序列与现在逐帧测量的结果一致（同样的量化与比较），只是省去了静止期间的重复测量。
- R4 不改变 `useBackdropRef` / `registerBackdrop` 的接口和 mock 预览的模糊替身行为。

## 待决事项（开始规划时向用户确认）

- 触发方式：
  - A：`MutationObserver`（子树、属性）+ `transitionrun`/`transitionend`/`animationstart`/`animationend` + `resize` 唤醒，静止若干帧后停止循环。
    改动集中在 `backdrop.ts`，但要覆盖所有能移动面板的来源。
  - B：保留逐帧循环，只缓存祖先样式链，静止时只读一次 `getBoundingClientRect`。收益较小，但风险也小。
- 验证方式：区域序列等价可以在浏览器预览里逐帧记录比对；原生模糊贴合需要在 Windows 上目视确认（尤其是商店展开、击杀信息淡出、记分板开关）。

## Acceptance Criteria（初稿）

- [ ] 浏览器预览中，静止 10 s 内 `measure` 的调用次数趋近 0（基线：每帧 × 登记数）；有动画时发送的区域序列与改动前逐帧一致。
- [ ] 开发版 CPU 剖析中 `backdrop.ts` 自身时间下降；正式包 mock 构建的主线程 Script 时间给出前后对比。
- [ ] `backdrop-smoke` 与相关审计通过；`npm run lint`、`npm test`、`npm run build:local` 通过。
