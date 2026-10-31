# 雷达相机与动态缩放计算缓存

## Goal

消除「非居中」相机、「全图」相机和「动态缩放」下每次渲染的重复计算，使最坏雷达配置（动态缩放 + 朝向向上 + 非居中）
每次渲染的模型计算从 1.3–1.6 ms 降到 0.4 ms 以内，相机输出与现在逐位一致。

父任务：`10-31-overlay-perf`（基线与基准脚本见其 `research/`，2026-10-31 在 `fb3f5ce` 上重测）。

## Background

- 雷达时钟跑在 `requestAnimationFrame` 上，雷达每秒渲染约 75 次（60 Hz 显示 + 15 Hz 位置帧），144 Hz 显示器上约 159 次；
  每次渲染 reducer 与 `selectMinimap` 各算一遍相机与动态缩放（`src/features/minimap/model.ts:287`、`model.ts:400`）。
- `createRadarCamera`（`src/features/minimap/camera.ts:36-69`）：
  - 非居中（`alwaysCentered=false`，`camera.ts:49-60`）每次都 `filter` 出视点所在区域的房间、`flatMap` 出全部角点、为每个点分配旋转结果，
    再对 x/y 各做 `Math.min/max(...展开)`。实测 123–146 µs/次（v6 布局 60–70 个房间，各 4 个角点）。
  - 全图（overview，`camera.ts:63-68`）每次遍历全部房间角点求 `farthest`，63–72 µs/次；它只取决于地图几何和雷达形状。
  - 每次调用开头都执行 `normalizeRadarPreferences(preferences)`（`camera.ts:38`）。
- `dynamicZoomTarget`（`src/features/minimap/dynamicZoom.ts:14-34`）每次最多调用 `createRadarCamera` 22 次（选定比例 1 次、0.25 一次、二分 20 次），
  每次都重新归一化同一份偏好；每帧在 reducer 和 selector 中各算一遍。
- 基准（`research/bench-minimap.mjs`，每次渲染 = reducer + `selectMinimap`）：

  | 配置 | 布局 0 | 布局 1 |
  |---|---|---|
  | 默认（居中、固定朝向、无动态缩放） | 42 µs | 45 µs |
  | 朝向向上、非居中 | 220 µs | 173 µs |
  | 动态缩放、居中 | 284–372 µs | 286 µs |
  | 动态缩放 + 朝向向上 + 非居中 | 1.30 ms | 1.59 ms |

  最坏配置的 CPU 剖析：`rotatePoint` 占 61%，其余主要是非居中钳制里的展开求最值和数组回调。居中的动态缩放场景主要花在
  每次试探时的 `normalizeRadarPreferences` 和目标投影上。
- 地图几何（`MapGeometry`）由 `resolver.ts` 生成后不再修改，并按描述键缓存复用（最多 8 份），适合作为缓存键。
- 首版规划在旧快照上做过的实验（每个区域的角点用 `Float64Array` 缓存，单遍求旋转后范围）：`createRadarCamera` 非居中降到 5.2 µs。

## Requirements

- R1 非居中相机：每个 `MapGeometry` 的每个区域只构建一次投影后的角点数组 `(x, -z)`（以几何对象为键的 `WeakMap`，不阻止几何被回收），
  之后每次调用只做一次无分配的遍历，求出旋转后的 x/y 范围。
- R2 全图相机：`farthest` 按（几何对象, 雷达形状）缓存。
- R3 动态缩放：`dynamicZoomTarget` 只归一化一次偏好，每次试探复用；可以抽出一个模块内部的相机函数，接收已归一化的偏好，
  导出的 `createRadarCamera` 仍然自己归一化。
- R4 相机输出与改动前逐位一致：旋转公式（与 `rotatePoint` 相同的乘加顺序）、角度换算、钳制公式和 `Math.max(1, …)` 下限保持不变。
  范围求最值不受遍历顺序影响，所以单遍求 min/max 与展开求值结果相同。
- R5 公共 API 不变：`createRadarCamera`、`dynamicZoomTarget`、`worldToRadar`、`clampToRadar`、`cameraToRadar` 的签名和语义不变；
  调用方（`model.ts`、`dynamicZoom.ts`、`MinimapRadar.tsx`、测试与 mock）无需修改。
- R6 缓存只用几何对象本身作键，不用描述键字符串或可变对象的字段；在 `camera.ts` 注释中写明「`MapGeometry` 视为不可变」这一前提。
- R7 新增回归测试：在 `scripts/minimap-model-smoke.mjs` 中写一个按旧算法实现的参考相机，覆盖两个 mock 布局（`src/mocks/minimap-layouts.json`）、
  两个区域、多个朝向、`fixed`/`heading-up`、居中/非居中、圆形/方形、多个比例和全图模式，断言 `createRadarCamera` 的完整输出
  （`center`/`yaw`/`scale`/`mode`/`zone`/`shape`/`viewSize`）与参考实现严格相等（`assert.deepStrictEqual`）；
  并对同一组输入断言 `dynamicZoomTarget` 与按旧算法计算的结果严格相等。
- R8 模块仍可被 Node `--experimental-strip-types` 冒烟脚本加载：值导入带 `.ts` 扩展名，不使用仅 TypeScript 支持的运行时语法。

## Acceptance Criteria

- [ ] `research/bench-minimap.mjs`（布局 0 和布局 1）：最坏配置每次渲染 ≤ 0.4 ms（基线 1.30 / 1.59 ms）；
      `createRadarCamera` 非居中和全图都 ≤ 10 µs/次（基线 123–146 / 63–72 µs）；其余配置不变慢（容差 10%）。
- [ ] R7 的等价性测试加入 `npm test` 并通过。
- [ ] `npm run lint`、`npm test`、`npm run build:local` 通过。
- [ ] `dev:mock` 下 `?minimapAlwaysCentered=0&minimapOrientation=heading-up&minimapDynamicZoom=1&minimapDynamicTargets=far`：
      雷达正常跟随、缩放，与改动前截图一致；`npm run minimap-visual-audit` 在本环境的结论与改动前一致。

## Out of Scope

- 让 `selectMinimap` 复用 reducer 已算出的动态缩放目标（可再省约一半，但需要处理 selector 与 reducer 的时间和偏好不一致）。
- 雷达帧率与 rAF 节奏（父任务候选项）、雷达滤镜（子任务 `10-31-perf-radar-zone-filters`）。
