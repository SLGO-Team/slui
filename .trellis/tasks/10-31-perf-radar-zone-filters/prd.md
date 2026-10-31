# 雷达颜色滤镜按区域应用

> 状态：暂缓，未实施（2026-10-31）。在本环境试做了两种分组方式，软件光栅化的替代指标结果相互矛盾（见下方「试验结果」），
> 而 WebView2 走 GPU 光栅化，结论无法外推；留待本地 Windows 上用 GPU 实测后再决定。
> 范围在 2026-10-31 重测后缩小：首版的「单一相机变换」已经交付
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

## 试验结果（2026-10-31，本环境，未合入）

度量：`../10-31-overlay-perf/research/raster-trace.cjs`，mock 预览、无头 Chromium（软件光栅化），8 s 内光栅化线程 `RasterTask` 总时长；
每组两次运行。主线程 `Paint`（33–47 ms/s）与 `Layout` 在三种结构下没有明显差别。

| 结构 | 带 `filter` 的地图元素 | 默认（固定朝向） | 朝向向上 |
|---|---|---|---|
| 现状：每个房间一个滤镜 | 70 | 208–215 ms/s（240 次/s） | 134–138 ms/s（105 次/s） |
| A：每个区域一个滤镜组，放在相机组内（`research/variant-a-zone-groups.diff`） | 2 | 273 ms/s（240 次/s） | 197–202 ms/s（180 次/s） |
| B：每个区域一个相机组，滤镜区域限定为雷达可视范围 `userSpaceOnUse 0..290`（`research/variant-b-viewport-region.diff`） | 2 | 66–67 ms/s（180 次/s） | 153–160 ms/s（260–267 次/s） |

- A 更差：分组后滤镜区域是整个区域内容的包围盒（按相机比例放大后远大于 250 px 的可视圆），裁剪之前就要对整片区域做滤镜。
- B 在固定朝向下省 68%，在朝向向上时多 15%（光栅任务数也变多）；而且要把一个相机组拆成每个区域各一个，
  每帧改写 2 处相机变换，违背 `minimap.md` 当前「a camera move rewrites one attribute」的约定，视觉审计也要随之调整。
- 两个补丁都能在 `deab773` 上用 `git apply` 干净应用，可直接带到 Windows 上测。

## 本地 Windows 上的下一步

- 在 WebView2 中（Edge DevTools Performance 面板，或任务管理器 GPU 占用）对比现状与 B 的两种朝向；只有 GPU 占用确有下降、且朝向向上不变差时才实施 B。
- 实施 B 时同步更新 `minimap.md` 的相机变换约定和 `minimap-visual-audit.mjs` 中 `.minimap-map__camera` 的读取方式。

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
