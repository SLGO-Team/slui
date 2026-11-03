# 雷达地图与背景融合（additive）

## Goal

雷达设置「雷达地图与背景融合」（`mapBlend`）开启时，地图像 CS2 `cl_hud_radar_map_additive 1` 一样以 additive 方式叠加在
「（模糊后的）游戏画面 + 雷达黑色背景」上，透过地图能看到游戏画面；关闭时地图照常不透明地盖住背景。现在开关不改变任何像素。

## Background

- 现状：`MinimapRadar.css:60` 给 `.minimap-radar__map` 设 `mix-blend-mode: screen`。混合只发生在雷达自己的层叠上下文里，
  地图下面只有雷达的黑色背景，screen 叠在黑色上等于原图，所以开 / 关没有区别（task `10-31-perf-radar-zone-filters` 已实测记录）。
- 游戏画面与 SLUI 的世界模糊都在透明 WebView 的下层窗口里，页面读不到。页面和游戏之间只有 DWM 的预乘 alpha over 合成：
  最终像素 = C + (1 − α)·W（C、α 为页面预乘颜色与 alpha，W 为下层画面）。
- CS2 参考：`hudradar.css` `#Radar__Square--InnerTransform { -s2-mix-blend-mode: additive; }`、`hudradar.xml` 圆形
  `Radar__Round--InnerTransform class="additive"`，地图所在面板带 `world-blur` 和 `hud-blur-bg-color`（`#000000a0`，即 0.63）。
  设置项 `RadarMapBlend` 对应 convar `cl_hud_radar_map_additive`。
- 房间图白色 / 浅灰，按区域乘 `ZONE_WASH`（`roomWash.ts`），洗色后最亮通道 96/255 ≈ 0.376。

## Requirements

- R1 `mapBlend` 开：雷达范围内的结果等于 additive：地图色 M 加上「背景透明度 a 的黑色叠在游戏画面上」，即 M + (1 − a)·W。
  当 a ≥ 洗色峰值（≈0.376，默认 0.63 满足）时精确（8 位舍入内）。
- R2 a 低于洗色峰值时，over 合成无法表示纯 additive（预乘颜色不能超过 alpha）：地图颜色仍精确等于 M，地图下方的游戏画面
  只做最少的压暗（房间内 alpha = 洗色峰值）；房间外仍是透明度 a 的黑底。a = 0 时地图仍可见。
- R3 `mapBlend` 关：与现状像素一致（地图不透明地盖住黑底）。
- R4 不引入 SVG / CSS 滤镜，镜头移动时每帧仍只改一处相机变换（#81 的性能约定）；不重新引入区域交界细线。
- R5 标记、炸弹点、钥匙卡、边框、标题、世界模糊不受影响。
- R6 更新 `minimap-visual-audit` 的 `map-blend` 检查与 `.trellis/spec/frontend/minimap.md` 的说明。

## Acceptance Criteria

- [x] mock 预览里，同一画面开 / 关 `mapBlend` 房间内像素不同；开时房间内像素 ≈ M + (1 − a)·W（对已知背景测量，误差 ≤ 3/255）。
- [x] `backgroundAlpha` = 0、0.2、0.63、1 时开启融合，地图都可见，房间外背景与关闭时一致。
- [x] `npm test`、`npm run lint`、`npm run minimap-visual-audit` 通过。
- [ ] 用户在游戏里确认视觉效果后再合并 PR。

## 实施记录（2026-11-03）

- 逐房间 opacity 在相邻房间的抗锯齿接缝处与整组缩放不同（a = 1 时 18 个像素差到 4/255），改为房间按原样画在黑底上、
  上面盖一层 `1 − roomOpacity` 的黑色（`.minimap-radar__dim`），整张地图一起缩放，接缝也精确。
- 视觉审计在纯色背景 rgb(60,140,220) 上测得：a = 1 开 / 关完全一致；a = 0.63 / 0.2 / 0 房间外不变，整像素房间多出
  W·(1 − max(a, 峰值))，没有越界或偏色的像素（1920×1080 与 1280×720）。
