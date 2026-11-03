# Design: additive 地图融合

## 合成目标

记 a = `backgroundAlpha`，W = 雷达下方的画面（游戏或世界模糊窗口），M = 房间某像素的洗色（预乘，含覆盖率），
p = 洗色峰值 = max(ZONE_WASH 各通道)/255 ≈ 0.376。页面输出预乘 (C, α)，DWM 合成为 C + (1 − α)·W。

- CS2 additive：M + (1 − a)·W ⇒ 需要 α = a、C = M。只有 M ≤ a 时是合法预乘像素。
- 关闭融合（现状）：黑底 (0, a) 上正常叠不透明地图 ⇒ 房间内 α = 1。

## 层结构（融合开启）

```
viewport
  .minimap-radar__base   opacity: a           ← 组透明度
    .minimap-radar__background  不透明黑色      ← 融合关闭时仍是 rgb(0 0 0 / a)，base 不透明
    svg.minimap-radar__map  房间图 = blendHref（洗色 / p，最亮通道 = 255）
    .minimap-radar__dim     黑色，alpha 1 − r：把整张地图一起压暗到 r
  svg.minimap-radar__lift  opacity: h          ← 仅 a < p 时渲染，同一批房间、同一相机
  markers / border / …
```

- k = max(a, p)，r = p / k，h = a ≥ p ? 0 : (p − a)/(1 − a)。
- base 层：房间内直色 = r·M/p = M/k，乘组透明度 a ⇒ C = a·M/k，α = a；房间外 (0, a)。
  a ≥ p 时 k = a ⇒ C = M、α = a，精确。
- lift 层（a < p，k = p，r = 1）：房间图直色 M/p，组透明度 h，叠在 base 上：
  C = h·M/p + (1 − h)·a·M/p = (M/p)·(h + (1 − h)a) = M，α = h + (1 − h)a = p（白色像素的最小可行 alpha）。
- r 由 `--radar-room-opacity` 传给 dim 层。最初是逐房间 opacity，但相邻房间的抗锯齿接缝处与整组缩放不同（实测 4/255），
  改为 dim 层。非当前区域房间仍是 0.82；lift 层对 0.82 房间和部分覆盖像素最多亮 3/255（仅 a < p）。
- 美术加载失败时仍画原图（白色），在融合模式下按同样的 r 缩放，颜色上限为 k，不会越界。

## 洗色

`washRooms` 额外为每个 (区域, 美术) 生成 `blendHref = washSvg(text, ZONE_WASH[zone] / p)`；`washedHref` 不变（关闭融合使用）。
`mapBlendLayers(a)` 纯函数放在 `roomWash.ts`，返回 `{ roomOpacity: r, liftOpacity: h }`，由 `minimap-wash-smoke` 校验。

## 性能

无滤镜；base 组透明度是一次视口大小的离屏合成，dim 层是一次视口大小的纯色填充。lift 层仅在 a < p 时存在，
此时房间多画一遍。镜头移动仍只改相机变换（lift 层存在时多一处）。

## 验证

- 单元：`mapBlendLayers` 对 a = 0 / 0.2 / p / 0.63 / 1 的组合结果（C、α）等于目标。
- 视觉审计：已知纯色页面背景下，开 / 关融合截图，房间内像素对照公式；房间外像素开 / 关一致。
