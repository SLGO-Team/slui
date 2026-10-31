# 覆盖层性能优化

## Goal

降低 SLUI 覆盖层（overlay 窗口）在游戏运行期间的主线程、渲染和启动开销，让覆盖层长时间叠在游戏上方时占用更少 CPU/GPU，
同时不改变任何可见行为、协议和输入模式。

## Background

性能分析的实测数据、复现命令和未测项见 `research/perf-baseline.md`。核心结论：

- 小地图的 32 ms 时钟和 15 Hz 位置帧都更新 `App` 的状态，整棵覆盖层 React 树每秒提交约 47 次；HUD、商店、聊天的数据最多 4 Hz 变化，却同频重渲染。
- 「动态缩放 + 朝向向上 + 非居中」配置下，小地图每帧相机计算约 8.4 ms（`camera.ts:395-406` 每次重建顶点，`dynamicZoom.ts` 每帧二分最多 22 次，reducer 与 selector 各算一遍）。
- 正式包把 mock 数据、调试面板和 345 KB 地图模板打进覆盖层主包，并在启动时执行一次 mock 地图生成。
- 雷达 70 个房间各带 SVG 滤镜、每帧各改一次 `transform`；透明原生窗口里部分 `backdrop-filter` 采样不到游戏画面；聊天用的 Noto Sans SC TTF 共约 17 MB。

## Task Map

子任务按以下顺序实施（用户在分析结论后确认的「建议顺序」）。每个子任务可单独验证、提交、归档。

| # | 子任务 | 交付 | 依赖 |
|---|---|---|---|
| 1 | `10-31-perf-memo-panels` | HUD/商店/聊天组件 memo | 无 |
| 2 | `10-31-perf-radar-camera` | 相机区域顶点缓存与动态缩放计算瘦身 | 无 |
| 3 | `10-31-perf-strip-mocks` | 正式包剥离 mock，地图模板懒加载 | 无 |
| 4 | `10-31-perf-minimap-isolation` | 小地图状态/时钟移出 `App`，rAF 节流，覆盖层隐藏时暂停 | 1（memo 后再隔离，便于分别度量） |
| 5 | `10-31-perf-radar-svg-transform` | 雷达 SVG 单一相机变换、按区域滤镜 | 4（在隔离后的雷达组件上改） |
| 6 | `10-31-perf-css-fonts` | 透明窗口特效门控、CJK 字体与商店图片瘦身 | 无 |

子任务 4–6 含需要用户决定的事项（Windows 侧验证方式、字体覆盖策略、视觉验证方式），在开始各自规划时再逐一确认。

## Cross-Child Requirements

- R-X1 行为不变：协议、输入模式（被动穿透/交互）、热键、可见内容与现有视觉审计结论保持一致；任何可见差异必须在子任务 PRD 中写明并经用户确认。
- R-X2 每个子任务结束时 `npm run lint`、`npm test`、`npm run build:local`（或等价的生产构建）通过。
- R-X3 每个子任务用 `research/` 中的脚本或其 PRD 指定的度量给出前后对比数据。
- R-X4 规范同步：改变了 `.trellis/spec/` 中记录的约定（如 quality-guidelines 中「Feature hooks live in App, so every tick re-renders the whole overlay」）的子任务，须在 Phase 3 更新规范。

## Acceptance Criteria（父任务集成验收）

- [ ] 6 个子任务均已完成并归档，各自验收项全部勾选。
- [ ] 全部完成后重跑 `research/` 脚本：默认雷达配置下 HUD/商店/聊天重渲染 ≤ 5 次/秒；最坏雷达配置每帧模型计算 ≤ 1 ms；覆盖层正式包不含 mock 数据。
- [ ] 集成后的 `npm run lint`、`npm test`、生产构建通过。

## Out of Scope

- HUD 秒级时钟量化与 selector 结构共享（分析中的 P2-6），Rust 侧前台/进程轮询改事件驱动（P3-9）：不在用户确认的建议顺序内，留作后续任务。
- 协议、服务端、安装器外壳的改动。
- 首页（home）窗口的性能。
