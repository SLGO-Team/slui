# Design — SLUI 主界面视觉重构

## Boundaries

- 只动展示层：`src/app/home/*`、home 专用样式、home 窗口配置、capabilities、图标资源。
- 不动数据层：`src/platform/settings.ts`、`desktop.ts`、`hotkeys.ts`、`audioSettings.ts`、`features/minimap/preferences.ts` 的接口与行为保持原样。`HomeApp.tsx` 中的状态订阅、去抖保存、覆盖层切换逻辑整体保留，只替换渲染树。
- overlay 窗口与 `App.css` 不受影响（home 仍在 `main.tsx` 中按需加载，样式隔离不变）。

## Layout

```
┌──────────────────────────────────────────────────────┐
│ [SLUI icon] SLUI   (drag region)            [—] [×]  │  自绘标题栏 ~40px
├──────────┬───────────────────────────────────────────┤
│ 首页      │                                           │
│ 设置      │   当前页内容（独立纵向滚动）                    │
│          │                                           │
│          │                                           │
│ (底部:    │                                           │
│  连接摘要) │                                           │
└──────────┴───────────────────────────────────────────┘
```

- 首页：覆盖层主开关为主视觉（大按钮 + 状态 + 说明），下方三项连接状态。
- 设置页：组标题（雷达 / 快捷键 / 声音）+ 行式设置，组内"恢复默认"。
- 页面状态为 `HomeApp` 内的本地 `useState<"home" | "settings">`，不引入路由库。两页组件都挂在 `HomeApp` 下，设置数据与保存逻辑仍集中在 `HomeApp`。

## Window chrome

- `tauri.conf.json` home 窗口：`decorations: false`、`maximizable: false`；默认尺寸 960×620、最小 820×560。
- 标题栏使用 `data-tauri-drag-region`；按钮调用 `getCurrentWindow().minimize()` / `.close()`。`close()` 触发现有 `CloseRequested` → 隐藏到托盘，无需改 Rust。
- 双击拖动区默认会切换最大化；`maximizable: false` 阻止后需在实机确认无副作用。
- capabilities 需追加 `core:window:allow-start-dragging`、`core:window:allow-minimize`、`core:window:allow-close`（`core:default` 不含）。
- 浏览器预览下 Tauri API 不可用：标题栏按钮在非 Tauri 环境降级为无操作（沿用 `platform/desktop` 的环境判断，不在组件里直接判断）。
- 无系统装饰后 Windows 11 圆角 / 阴影：Tauri 2 在 Windows 上 `decorations:false` 仍可保留阴影（`shadow: true` 默认），实机确认。

## Visual tokens

- CSS 变量集中在 home 样式顶部：底色渐变、面板、线条、强调橙及渐变、前景白、次要文字、状态色（ok / pending / warn / error 在新底色上重新校准对比度）。
- 字体：`@font-face` 引用 `public/assets/fonts` 下 Chakra Petch Bold、Barlow SemiBold/Bold、Noto Sans SC Bold（均为 SIL OFL）；正文中文用系统 Microsoft YaHei UI。不得引用 Stratum2 或 DIN Next。
- 母题：四角括号以 CSS 伪元素实现于主视觉面板；不引入位图背景。

## Icon

- SLUI 图标定稿为候选 A「收容视窗」（SLGO 准星环换成 HUD 四角括号，保留 SCP 收容三箭头），单一源文件 `src/app/home/slui-icon.svg`，品牌区与 Tauri 图标都由它生成。
- `npm run tauri -- icon src/app/home/slui-icon.svg -o src-tauri/icons` 生成全套并删除用不到的 `android/`、`ios/`、`64x64.png`；托盘继续使用 `default_window_icon()`，无需改 Rust。
- 品牌区直接内联 / 引用同一 SVG。

## Compatibility / rollback

- 设置文件格式不变，新旧版本可互相读取。
- 回滚 = 还原 `src/app/home/`、`tauri.conf.json` home 窗口段、capabilities 与 `src-tauri/icons/`。

## Hero activation motion

- 启用 UI：按钮橙色填充层向右排空（流向主视觉）→ 扫描线自左向右扫过面板 → 四角括号、网格、测距环（旋转 45° 锁定）、刻度（向内收拢）、收容环依次点亮 → 中心点亮起并发出两圈脉冲。总时长约 1.6 s。
- 停用 UI：按钮从左侧重新灌满，主视觉 250 ms 内整体熄灭，不播一次性特效。
- 主视觉 SVG 的 viewBox 以 (0, 0) 为中心，旋转 / 缩放用 `transform-box: view-box; transform-origin: 0 0`。view-box 参考框从用户坐标原点起算，写 `50% 50%` 会落到 (320, 320)（右下角），导致刻度歪斜、测距环转出画面、脉冲向左上飞出。验证动画要核对元素包围盒中心，不能只看变换矩阵。
- 颜色过渡依赖 `@property` 注册的 `--bracket` / `--grid-color`；延迟写在 enabled 选择器上（过渡取目标状态的时序）。
- 扫描线与脉冲是按 `pulse` 计数挂载的一次性元素，只在用户点击按钮导致启用时出现；首次加载与托盘切换只走颜色过渡。全部为 CSS 动画，无 JS 时钟；`prefers-reduced-motion` 下关闭。
