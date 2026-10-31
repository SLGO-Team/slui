# 商店物品图片瘦身

> 状态：待规划。开始前确认下方「待决事项」。范围在 2026-10-31 重测后缩小：首版的 CJK 字体 WOFF2 已由 #54 交付
> （无损转换、不做子集化，归档任务 `10-23-woff2-fonts`）；HUD 面板已无 `backdrop-filter`（10-21 backdrop 系列任务改为原生世界模糊）。

## Goal

减小商店物品图片的体积和解码内存，画面不变或经用户确认；随之减小安装包和每次更新的下载量。

父任务：`10-31-overlay-perf`。

## Background

- `public/assets/shop-items/*.png`：31 个文件共 4.39 MB，尺寸 256×256 到 837×930（`Scp939.png` 490 KB）。
  引用集中在 `src/features/shop/presentation.ts:65` 起的映射表（`shopIconSource` / `shopPreviewSource`）；
  预览图按 420×470 CSS px 绘制（`ShopPanel.css:195`，随覆盖层缩放，4K 下约 840×940 物理像素）。
- Pillow 估算：无损 WebP 2.85 MB（−35%），WebP q90 0.87 MB（−80%）。WebView2（Chromium）原生支持 WebP。
- `THIRD_PARTY_NOTICES.md:9` 按路径 `public/assets/shop-items/*.png` 列出这些 CC BY-SA 3.0 素材；改格式后须同步，许可声明保持完整。
- 正式包 `dist` 19 MB 中字体占 13 MB、商店图片 4.3 MB；Tauri 发布构建对内嵌资源做 brotli 压缩，PNG 已压缩，brotli 几乎不再缩小它们。

## Requirements（初稿）

- R1 商店物品图片改为 WebP，按待决事项选定无损或有损。
- R2 `presentation.ts` 的映射与 `THIRD_PARTY_NOTICES.md` 同步更新；`public-content-check` 等检查继续通过。
- R3 商店卡片图标与预览图画面一致（无损：逐像素一致；有损：经用户目视确认）。

## 待决事项（开始规划时向用户确认）

- 无损 WebP（−1.5 MB，画面逐像素一致）还是有损 q90（−3.5 MB，需目视确认），或预览图按最大绘制尺寸缩放后再编码。
- 转换工具：Pillow（本环境可用）或 `cwebp`；是否把转换脚本放进 `scripts/`（参照 `scripts/build-fallback-fonts.py`）。

## Acceptance Criteria（初稿）

- [ ] 商店图片总体积前后对比达到选定策略的预期；无损时逐像素比对通过。
- [ ] `dev:mock` 下 `?shopOpen=1` 商店卡片与预览图正常显示；商店相关审计结论不变。
- [ ] `npm run lint`、`npm test`、`npm run build:local` 通过。
