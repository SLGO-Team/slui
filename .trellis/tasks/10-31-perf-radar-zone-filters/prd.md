# 雷达颜色滤镜按区域应用

> 状态：待规划。开始前确认下方「待决事项」。范围在 2026-10-31 重测后缩小：首版的「单一相机变换」已经交付
> （`MinimapRadar.tsx` 的 `.minimap-map__camera` 组 + `roomArtworkToWorld` 静态变换，重测地图层每帧只有 1 处 DOM 改写）。

## Goal

镜头每帧移动时，雷达地图只需对 2 个区域组做颜色滤镜，而不是 60–70 个房间各做一次；画面与现在一致。

父任务：`10-31-overlay-perf`。

## Background

- `src/features/minimap/MinimapRadar.tsx:43-52`：`MapRooms` 给每个房间包一个带 `filter`（`feColorMatrix` 颜色乘法，`MinimapRadar.tsx:23-24`）的 `<g>`，
  滤镜按区域只有两种（`hcz`、`entrance`）。房间层已 memo，镜头移动只改父级相机变换，但相机变换变化后，滤镜结果需要重新光栅化，
  逐房间滤镜意味着每帧 60–70 次滤镜处理（GPU/光栅成本，本环境无 GPU，未测）。
- `feColorMatrix` 在这里是逐通道乘法、不改 alpha；对合成结果是线性的，所以按区域对整组应用与逐房间应用在 8 位舍入范围内等价，
  非当前区域房间的 `opacity: 0.82`（`MinimapRadar.css:61`）也可以留在房间上。
- `scripts/minimap-visual-audit.mjs` 用 `getCTM()` 检查有效变换，按区域分组不影响它；房间上的 `data-room-id`、`data-zone`、`data-active` 等属性需要保留。

## Requirements（初稿）

- R1 房间按区域分到 2 个带滤镜的 `<g>` 中，房间自身不再带 `filter`；保留每个房间的 `data-*` 属性和非当前区域的不透明度。
- R2 代表性状态（固定/朝向向上、圆形/方形、全图、两个区域）下画面与改动前的像素差在约定容差内。
- R3 更新 `.trellis/spec/frontend/minimap.md` 中对房间渲染结构的描述（如有）。

## 待决事项（开始规划时向用户确认）

- 是否值得做：收益在 GPU 光栅化，本环境测不到。可选：在 Windows 上用 WebView2 的性能面板或 GPU 占用先确认逐房间滤镜确有可见开销再实施；
  或接受「理论上更省、画面不变」直接实施。
- 视觉验证方式：浏览器预览截图像素比对（本环境可做），或另在 Windows 透明窗口中目视确认。

## Acceptance Criteria（初稿）

- [ ] 代表性状态截图与改动前像素差在约定容差内；`npm run minimap-visual-audit` 结论不变。
- [ ] DOM 中带 `filter` 的地图元素从 60–70 个降为 2 个。
- [ ] `npm run lint`、`npm test`、`npm run build:local` 通过。
