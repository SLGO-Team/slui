# backdrop 测量循环瘦身

> 2026-10-31 重测中发现，按用户授权立项。技术设计见 `design.md`，执行计划见 `implement.md`。

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
- 开发版 CPU 剖析（默认雷达，mock 预览）：`measure` 自身约 12–15 ms/s。
- 生产模式 React 的 mock 构建（`research/build-mock-profile.mjs`）插桩实测：默认场景登记 7 个面板，每秒测量 60 次、每次约 190 µs，
  静止时区域更新 0 次/秒；让循环跳过测量后主线程 Script 从 44–49 降到 33–35 ms/s（各 3 次），Layout 与 RecalcStyle 不变，
  即强制布局本来就要做，省下的是脚本与样式读取，约占覆盖层脚本时间的四分之一。
- 雷达每帧改写自己子树内的 DOM，所以「整页有 DOM 变化就重测」等于不省；信号必须限定在面板自身及其祖先上。
- 面板的可见变化来源：React 改写 DOM/样式、CSS 过渡与关键帧动画（如商店 `height .2s`、卡片淡入淡出）、窗口缩放（覆盖层缩放变量）。

## Decisions（2026-10-31，用户授权由实施方决定）

- 用信号决定是否测量（`design.md`）：面板或其祖先的属性变化、面板或其祖先上的动画与过渡、面板盒子的位置或尺寸变化、登记/注销；
  信号之后的一帧也测量，并且至少每 500 ms 完整测量一次，兜住信号看不到的变化（如基于 `:hover`、兄弟选择器或 `:has()` 的样式规则）。
- 等价性用 mock 预览中的自检验证：被跳过的帧补测一次，与已发送的区域比较；原生模糊的实际贴合仍建议在 Windows 上目视确认（不阻塞合入）。

## Requirements

- R1 没有任何信号时不执行逐元素的样式读取（每帧只读各面板的盒子）。
- R2 有信号时按现在的方式测量，信号之后的一帧也测量；至少每 500 ms 完整测量一次。
- R3 发送给 Rust 的区域序列与逐帧测量一致：mock 自检中 `stale`（跳过但本应发送的帧）为 0。
- R4 不改变 `useBackdropRef` / `registerBackdrop` 的接口、量化与比较、mock 预览的模糊替身行为；模块仍可在 Node 中导入（`backdrop-smoke`）。

## Acceptance Criteria

- [x] 默认 mock 场景静止时每秒完整测量 2.0 次（基线 60），其余 58 帧只读面板盒子。
- [x] `research/backdrop-check.cjs`：空闲、商店开关（`KeyB`/`Escape`）、记分板（按住 `CapsLock`）、窗口 1280×720 往返、雷达模糊开关，
      以及 `hudScene` = all-slots、win-mvp-kills、bottom-kills、bottom-fire、generator-start-progress、match-point，`stale` 全部为 0；
      有动画的场景按需逐帧测量（如 all-slots 59/s、win-mvp-kills 48/s）。
- [x] 生产模式 React 的 mock 构建，同一轮三组对比（各 3 次）：主线程 Script 旧实现 44.2–47.5、跳过测量 32.2–34.4、新实现 37.7–39.9 ms/s，
      即省下这部分开销的 55–60%；剩余的是每帧读 7 个面板盒子（剖析中 `tick` + `panelBox` + `getBoundingClientRect` 约 2 ms/s）。
      未完全达到「接近 33–35 ms/s」的目标：每帧读盒子是发现「面板被内容或兄弟元素推动」的必要信号，保留。Layout、RecalcStyle 三者相同。
- [x] `backdrop-smoke`、`minimap-visual-audit`（含模糊像素检查）通过；`npm run lint`、`npm test`、`npm run build:local` 通过；
      非 mock 构建中不含 `__SLUI_BACKDROP_DEBUG__`。
