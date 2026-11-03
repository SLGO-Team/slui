# 雷达颜色滤镜按区域应用

> 状态：2026-11-03 在本地 Windows 上用 WebView2 GPU 实测后实施 A（见「Windows GPU 实测」「决定」）。2026-10-31 在云端试做了两种分组方式，
> 软件光栅化的替代指标结果相互矛盾（见下方「试验结果」），GPU 上的排序与之不同。
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

## Windows GPU 实测（2026-11-03）

开发版 SLUI（mock 雷达在动）的覆盖层经 Rust 真实路径显示在替身 `SCPSL.exe` 窗口上（1920x1080 物理像素，即覆盖层设计分辨率），
每次 8 s：WebView2 GPU 进程的 GPU 引擎占用（`GPU Engine` 性能计数器 `Utilization Percentage` 按进程求和）与 CPU，渲染进程 CPU（开发版 React）。
现状 / A / B 交替运行，丢弃页面未换上变体的 2 次；脚本在 `../10-31-overlay-perf/research/zone-filters/`。

| 结构 | 固定朝向 GPU 占用 | 朝向向上 GPU 占用 | 固定 / 朝向向上 GPU 进程 CPU | 固定 / 朝向向上 渲染进程 CPU |
|---|---|---|---|---|
| 现状（70 个滤镜，n=6） | 6.47%（4.90–6.97） | 7.15%（7.00–7.30） | 414 / 440 ms/s | 458 / 600 ms/s |
| A（2 个区域滤镜组在相机组内，n=4） | 5.43%（5.16–5.74） | 5.55%（4.99–5.85） | 408 / 394 ms/s | 477 / 484 ms/s |
| B（每区域一个相机组，n=4） | 5.13%（4.72–5.40） | 5.71%（5.56–5.99） | 486 / 456 ms/s | 560 / 516 ms/s |

- A 在两种朝向下 GPU 占用都下降（−16% / −22%），GPU 进程与渲染进程 CPU 不增加（朝向向上分别 −10%、−19%）。
- B 的 GPU 占用与 A 相近，但相机改写翻倍（360 次/秒），固定朝向下 GPU 进程 CPU +17%，且违背单一相机变换约定。
- 软件光栅化下「A 最差」的结论在 GPU 上不成立。

画面：视觉审计的 148 张截图里，108 张在两次基线运行之间逐像素一致（RGB 比较）；这 108 张中 A 有 106 张不同，最大差 60/255、每张最多 843 个像素差超过 3。
差别全是滤镜范围边缘的细线：现状在旋转的地图上有贯穿房间的斜向细线（每个房间滤镜范围的边缘，软件光栅化），A 没有，只在区域组滤镜范围的边缘留下一条
（见 `../10-31-overlay-perf/research/zone-filters/audit-before-after.png`）。WebView2 GPU 截图里两者都没有这种细线，差别只在相邻房间的接缝，A 的接缝更淡（最大差 15/255，`webview2-seams.png`）。

审计的 `map-blend` 检查：`mix-blend-mode` 只在最近的层叠上下文内混合，雷达地图下方只有雷达自己的黑色背景，screen 与黑色混合等于原图，
所以 `mapBlend` 在页面里本来就几乎不改变像素（现状下开 / 关只有 82 个像素差 1/255）。原检查断言像素必须变化，只是靠这点舍入误差通过；
A 去掉了误差后检查失败。改为断言 `.minimap-radar__map` 的计算样式 `mix-blend-mode` 随设置切换。`mapBlend` 在透明覆盖层里能否真正实现
（与游戏画面混合）是另一个问题，不在本任务范围。

## 决定（2026-11-03）

实施 A：房间按区域分到两个带颜色滤镜的 `<g>`，放在唯一的 `.minimap-map__camera` 组内；不实施 B。

## 本地 Windows 上的下一步（2026-10-31 写，已按上方实测处理）

- 在 WebView2 中（Edge DevTools Performance 面板，或任务管理器 GPU 占用）对比现状与 B 的两种朝向；只有 GPU 占用确有下降、且朝向向上不变差时才实施 B。
- 实施 B 时同步更新 `minimap.md` 的相机变换约定和 `minimap-visual-audit.mjs` 中 `.minimap-map__camera` 的读取方式。

## Requirements

- R1 房间按区域分到 2 个带滤镜的 `<g>` 中（在唯一的相机组内），房间自身不再带 `filter`；保留每个房间的 `data-*` 属性和非当前区域的不透明度。
- R2 代表性状态（固定 / 朝向向上、圆形 / 方形、全图、两个区域）下画面与改动前一致，差别只允许出现在房间接缝。
- R3 更新 `.trellis/spec/frontend/minimap.md` 的房间渲染结构，并写明 `mapBlend` 在页面内为何几乎不改变像素。

## 待决事项（已决，2026-11-03）

- 是否值得做：Windows WebView2 GPU 实测 A 在两种朝向下都省（见上），实施。
- 视觉验证：视觉审计截图逐像素比对 + WebView2 透明窗口里的雷达截图比对。

## Acceptance Criteria

- [x] 代表性状态截图与改动前的差别只在房间接缝；`npm run minimap-visual-audit` 通过（`map-blend` 改为检查计算样式）。
- [x] DOM 中带 `filter` 的地图元素从 60–70 个降为 2 个。
- [x] `npm run lint`、`npm test`、`npm run build:local` 通过。
