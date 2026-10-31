# 商店物品图片瘦身

> 范围在 2026-10-31 重测后缩小：首版的 CJK 字体 WOFF2 已由 #54 交付（无损转换、不做子集化，归档任务 `10-23-woff2-fonts`）；
> HUD 面板已无 `backdrop-filter`（10-21 backdrop 系列任务改为原生世界模糊）。

## Goal

减小商店物品图片的体积，画面不变；随之减小 `slui.exe`（内嵌前端资源）和每次更新的下载量。

父任务：`10-31-overlay-perf`。

## Background

- `public/assets/shop-items/*.png`：31 个文件共 4.39 MB，尺寸 256×256 到 837×930（`Scp939.png` 490 KB）。
  引用集中在 `src/features/shop/presentation.ts` 的 `SHOP_PREVIEW_IMAGES`（`shopPreviewSource`）；预览图按 420×470 CSS px 绘制
  （`ShopPanel.css:195`，随覆盖层缩放，4K 下约 840×940 物理像素），所以不缩小尺寸。
- `THIRD_PARTY_NOTICES.md:9` 按路径列出这些 CC BY-SA 3.0 素材，`public/assets/shop-items/SOURCES.md` 逐个列出本地文件名与来源；改格式后须同步。
- Tauri 发布构建对内嵌资源做 brotli 压缩，PNG 已压缩，brotli 几乎不再缩小它们，所以格式本身的压缩率直接体现在 exe 体积上。
- 色彩信息（Pillow 读取）：11 个文件带 `sRGB` 块（另带 `gAMA`），1 个带 ICC 配置（`Scp173.png`），
  3 个只有 `gAMA 0.45455` + `cHRM`（`Scp079.png`、`Scp096.png`、`Scp939.png`），其余没有色彩块；`MicroHID.png` 是带 `tRNS` 的 RGB。
- 试验（Chromium 中把 PNG 与无损 WebP 分别合成到黑、灰、白不透明底上逐像素比较）：
  - 28 个文件：不透明像素完全一致，只有半透明边缘差 1（PNG 与 WebP 解码器的预乘舍入不同），`MicroHID` 0 差异。
  - `gAMA` + `cHRM` 的 3 个文件：不透明像素最多差 9。Chromium 对这 3 个 PNG 按 2.2 伽马做色彩转换，没有对应配置的 WebP 会丢掉这一步。

## Decisions（2026-10-31，用户授权由实施方决定）

- 无损 WebP（`lossless`、`method=6`、`exact=True`），保留 ICC 配置；不做有损压缩、不缩小尺寸。
- `Scp079.png`、`Scp096.png`、`Scp939.png` 保持 PNG：给 WebP 嵌入与 `gAMA`/`cHRM` 等效的 ICC 配置也能保留转换，但难以保证与浏览器的 PNG 路径逐位一致，
  为省约 0.27 MB 不值得。
- 一次性转换，不往 `scripts/` 加转换脚本：源 PNG 不再保留在仓库中，脚本没有可重复运行的输入；转换方法写进 `SOURCES.md`。

## Requirements

- R1 除上述 3 个外的 28 个商店图片转为无损 WebP，删除对应 PNG。
- R2 `SHOP_PREVIEW_IMAGES` 指向新文件；`THIRD_PARTY_NOTICES.md` 与 `SOURCES.md` 同步，`SOURCES.md` 写明转换方法与保留 PNG 的原因。
- R3 `shop-model-smoke` 断言 `SHOP_PREVIEW_IMAGES` 的每个路径都对应 `public/` 下存在的文件，商店图片目录中没有未被引用的图片。
- R4 画面不变：Chromium 中合成后的不透明像素逐一相同，半透明像素差 ≤ 1。

## Acceptance Criteria

- [x] 商店图片总体积 4.39 → 3.24 MB（转换的 28 个文件 3.63 → 2.48 MB）；`build:local` 的 `dist/assets/shop-items` 3.2 MB。
- [x] R4：28 个文件在 Chromium 中合成到黑、灰、白底后，不透明像素逐一相同，半透明边缘差 ≤ 1（`MicroHID` 0 差异）。
      `dev:mock` 下用调试面板呼出商店（`?shopOpen=1` 会在会话变为 live 前被关闭），两种商店角色逐个悬停 35 张卡片：
      预览图全部加载；换成 WebP 的 28 张中 27 张最大差 1、`MicroHID` 0 差异，其余 7 张（保留的 PNG 与 SVG 后备图标）0 差异。
- [x] `npm run lint`、`npm test`（含 R3；把一条映射改回 `.png` 的变异使测试失败）、`npm run build:local` 通过。
