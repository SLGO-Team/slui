# 雷达相机与动态缩放计算缓存

## Goal

消除「非居中」相机、「全图」相机和「动态缩放」下每次渲染的重复计算，使最坏雷达配置（动态缩放 + 朝向向上 + 非居中）
每次渲染的模型计算从约 250–270 µs 降到 50 µs 以内，相机输出与现在逐位一致。

> 数字更正（实施中发现）：首版基线用 `vm.runInNewContext` 运行打包结果，全局查找（`Math.*`）经过沙箱拦截，热循环被放大约 5 倍
> （当时测得最坏配置 1.30 / 1.59 ms、非居中相机 123–146 µs、全图相机 63–72 µs，验收线定为 ≤ 0.4 ms / ≤ 10 µs）。
> 基准脚本改为在本 realm 中 `import()` 打包结果后重测，本 PRD 的数字和验收线按更正后的基线收紧。

父任务：`10-31-overlay-perf`（基线与基准脚本见其 `research/`，2026-10-31 在 `fb3f5ce` 上重测）。

## Background

- 雷达时钟跑在 `requestAnimationFrame` 上，雷达每秒渲染约 75 次（60 Hz 显示 + 15 Hz 位置帧），144 Hz 显示器上约 159 次；
  每次渲染 reducer 与 `selectMinimap` 各算一遍相机与动态缩放（`src/features/minimap/model.ts:287`、`model.ts:400`）。
- `createRadarCamera`（`src/features/minimap/camera.ts:36-69`）：
  - 非居中（`alwaysCentered=false`，`camera.ts:49-60`）每次都 `filter` 出视点所在区域的房间、`flatMap` 出全部角点、为每个点分配旋转结果，
    再对 x/y 各做 `Math.min/max(...展开)`。实测 18.5–25.5 µs/次（v6 布局 60–70 个房间，各 4 个角点）。
  - 全图（overview，`camera.ts:63-68`）每次遍历全部房间角点求 `farthest`，24–30 µs/次；它只取决于地图几何和雷达形状。
  - 每次调用开头都执行 `normalizeRadarPreferences(preferences)`（`camera.ts:38`）。
- `dynamicZoomTarget`（`src/features/minimap/dynamicZoom.ts:14-34`）每次最多调用 `createRadarCamera` 22 次（选定比例 1 次、0.25 一次、二分 20 次），
  每次都重新归一化同一份偏好；每帧在 reducer 和 selector 中各算一遍。
- 基准（`research/bench-minimap.mjs`，每次渲染 = reducer + `selectMinimap`）：

  | 配置 | 布局 0 | 布局 1 |
  |---|---|---|
  | 默认（居中、固定朝向、无动态缩放） | 17–27 µs | 17–22 µs |
  | 朝向向上、非居中 | 47 µs | 35 µs |
  | 动态缩放、居中 | 39–48 µs | 36–45 µs |
  | 动态缩放 + 朝向向上 + 非居中 | 272 µs | 249 µs |

  最坏配置在 60 Hz 下约 19–20 ms CPU/s，144 Hz 下约 41 ms/s。

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

- [x] `research/bench-minimap.mjs`（布局 0 和布局 1）：最坏配置每次渲染 ≤ 50 µs（基线 272 / 249 µs，结果 30 / 24 µs）；
      `createRadarCamera` 非居中和全图都 ≤ 5 µs/次（基线 25.5 / 18.5 和 30.1 / 23.9 µs，结果 1.9 / 1.5 和 0.8 / 0.7 µs）；
      其余配置不变慢（三次运行的范围与基线重叠，单次噪声约 ±30%）。
- [x] R7 的等价性测试加入 `npm test` 并通过（5 个几何对象 × 2 轮，19 280 次相机、2 560 次动态缩放比对；
      变异检验：共享缓存、改写角度乘法顺序都会使测试失败）。
- [x] `npm run lint`、`npm test`、`npm run build:local` 通过。
- [x] `dev:mock` 下 8 个代表性状态（含 `?minimapAlwaysCentered=0&minimapOrientation=heading-up&minimapDynamicZoom=1&minimapDynamicTargets=far`、
      全图、方形、`cs2-reference`）的相机变换字符串与雷达截图和改动前逐像素一致；`npm run minimap-visual-audit` 通过（72 张截图）。

## Out of Scope

- 让 `selectMinimap` 复用 reducer 已算出的动态缩放目标（可再省约一半，但需要处理 selector 与 reducer 的时间和偏好不一致）。
- 雷达帧率与 rAF 节奏（父任务候选项）、雷达滤镜（子任务 `10-31-perf-radar-zone-filters`）。
