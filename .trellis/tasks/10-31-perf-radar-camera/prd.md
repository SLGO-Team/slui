# 雷达相机与动态缩放计算缓存

## Goal

消除「非居中」相机和「动态缩放」下每帧的毫秒级计算，使最坏雷达配置（动态缩放 + 朝向向上 + 非居中）的每帧模型计算从约 8.4 ms 降到 1 ms 以内，
相机输出与现在逐位一致。

父任务：`10-31-overlay-perf`（基线与基准脚本见其 `research/`）。

## Background

- `createRadarCamera`（`src/features/minimap/camera.ts:384-416`）在 `alwaysCentered=false` 时，每次调用都会 `filter` 出视点所在区域的房间、
  `flatMap` 出全部角点、为每个点分配旋转结果，再对 x/y 各做两次 `Math.min/max(...展开)`（`camera.ts:397-405`）。实测 155–169 µs/次。
- 全图（overview）分支每次都遍历全部房间角点求 `farthest`（`camera.ts:412-414`），67–87 µs/次；它只取决于地图几何和雷达形状。
- `dynamicZoomTarget`（`dynamicZoom.ts:461-482`）每次最多调用 `createRadarCamera` 22 次（1 次选定比例、1 次 0.25、20 次二分），
  每帧在 reducer（`model.ts:214-221`）和 `selectMinimap`（`model.ts:314-316`）中各算一遍，再加上实际相机 1 次。
- 地图几何（`MapGeometry`）在 `resolver.ts` 生成后不再变化，并按描述键缓存复用，适合作为缓存键。
- 实验（临时副本）：按几何对象缓存每个区域的角点（`Float64Array`）并单遍求旋转范围，`createRadarCamera` 降到 5.2 µs，最坏配置每帧 0.66 ms；
  `minimap-model-smoke`、`minimap-integration-smoke` 通过。

## Requirements

- R1 非居中相机：每个 `MapGeometry` 的每个区域只构建一次角点数组（以几何对象为键的 `WeakMap`，不阻止几何被回收），之后每次调用只做一次无分配的遍历求旋转后范围。
- R2 全图相机：`farthest` 按（几何对象, 雷达形状）缓存。
- R3 相机输出与改动前逐位一致：旋转公式、角度换算、钳制公式保持相同的浮点运算顺序。
- R4 公共 API 不变：`createRadarCamera`、`dynamicZoomTarget`、`worldToRadar`、`clampToRadar` 的签名和语义不变；调用方（`model.ts`、`dynamicZoom.ts`、测试与 mock）无需修改。
- R5 新增回归测试：在 `scripts/minimap-model-smoke.mjs` 中用一个按旧算法写的参考实现，对多个种子、两个区域、多个朝向、`fixed`/`heading-up`、圆形/方形、多个比例和全图模式，断言 `createRadarCamera` 的 `center`/`scale`/`yaw` 与参考实现严格相等。
- R6 缓存模块变量不得在测试或 mock 中泄漏错误数据：缓存键只能是几何对象本身，不得使用描述键字符串或可变对象的字段。

## Acceptance Criteria

- [ ] `research/bench-minimap.mjs`：最坏配置每帧 ≤ 1 ms（基线 8.3–8.4 ms）；`createRadarCamera` 非居中 ≤ 10 µs/次、全图 ≤ 10 µs/次；其余配置不变慢。
- [ ] R5 的等价性测试加入 `npm test` 并通过。
- [ ] `npm run lint`、`npm test`、生产构建通过。
- [ ] `dev:mock` 下 `minimapAlwaysCentered=0&minimapOrientation=heading-up&minimapDynamicZoom=1` 时雷达正常跟随、缩放，与改动前截图一致。

## Out of Scope

- 让 `selectMinimap` 复用 reducer 已算出的动态缩放目标（可再省约一半，但需要处理 selector 与 reducer 的时间和偏好不一致，收益不再关键）。
- 雷达 SVG 渲染方式（子任务 5）与时钟/状态隔离（子任务 4）。
