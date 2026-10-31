# 雷达 SVG 单一相机变换

> 状态：待规划。依赖子任务 4（`10-31-perf-minimap-isolation`）完成后开始。

## Goal

镜头移动或旋转时，雷达地图层每帧只改写一个变换属性，房间图层与滤镜不再逐个重算、重绘；画面与现在一致。

父任务：`10-31-overlay-perf`。

## Background

- `MinimapRadar.tsx:131-136`：70 个房间各包一个带 `filter`（`feColorMatrix`）的 `<g>`，每帧用 `roomArtworkToRadar`（`camera.ts:423-430`）为每个房间生成新的 `matrix(...)` 字符串。
- 每个房间的变换 = 相机变换 ∘ 房间自身（世界坐标下）的固定变换；`feColorMatrix` 只是逐通道乘法，对合成结果线性，因此按区域对组应用与逐房间应用在 8 位舍入范围内等价。
- `.trellis/spec/frontend/minimap.md` 第 6 节要求浏览器移动断言检查「渲染后的房间图片变换」；`scripts/minimap-visual-audit.mjs` 需要随之改为检查有效变换（如 `getCTM`）。

## Requirements（初稿）

- R1 房间 `<image>` 的变换只由地图几何决定（随几何缓存），镜头变化只改父级一个相机变换。
- R2 颜色滤镜按区域分组应用（2 个），保留每个房间的 `data-room-id`、`data-zone`、`data-active` 等属性和非当前区域的不透明度。
- R3 画面与改动前在代表性状态下（固定/朝向向上、圆形/方形、全图、两个区域）像素差在容差内。
- R4 更新视觉审计与规范中对房间变换的检查方式。

## Acceptance Criteria（初稿）

- [ ] 镜头移动的一帧内，地图层（不含标记层）的属性变更 ≤ 1 处（MutationObserver 统计）。
- [ ] 代表性状态截图与改动前像素差在约定容差内；小地图视觉审计更新后通过。
- [ ] `npm run lint`、`npm test`、生产构建通过。
