# 合成特效与字体资源瘦身

> 状态：待规划。开始前确认下方「待决事项」。

## Goal

去掉透明原生窗口里不产生可见效果却每帧付出合成代价的特效；减小覆盖层 CJK 字体与商店图片的体积和内存占用；可见效果保持不变或经用户确认。

父任务：`10-31-overlay-perf`。

## Background

- `HudTeamCounter.css:422-426`：5 个装备面板各有 `backdrop-filter: blur(3px)`。原生透明 WebView2 采样不到游戏画面（`MinimapRadar.css:57-60` 的注释与 `.trellis/spec/frontend/minimap.md` 的 render capabilities 规则已说明），
  雷达已经用 `pageBackdrop` 能力门控模糊，HUD 尚未门控。`mix-blend-mode: screen`（`MinimapRadar.css:62`）与雷达自身半透明底色混合，有可见效果，不属于本项。
- `src/features/chat/ChatInput.css:11-25` 与 `src/app/home/home.css:29` 使用 `notosanssc-light.ttf`（8.3 MB）、`notosanssc-bold.ttf`（8.6 MB）。
  仓库已有 `scripts/build-fallback-fonts.py`（字体构建脚本，可参考）。
- 商店图片 `public/assets/shop-items/*.png` 共 4.3 MB（`Scp939.png` 490 KB）。

## Requirements（初稿）

- R1 HUD 装备面板模糊仅在存在页面背景（浏览器预览）时启用，原生透明窗口中关闭；参照雷达 `pageBackdrop` 的做法。
- R2 CJK 字体改为 WOFF2，并按待决事项选定的策略减小体积。
- R3 商店图片转为更小的格式，画面一致。
- R4 安装包体积随之下降，许可证文件（OFL）保持完整。

## 待决事项（开始规划时向用户确认）

- 字体策略：按 `unicode-range` 切分完整字体（覆盖不变、文件多）、只保留常用字子集（体积最小、罕见字回退到系统字体）、或只转 WOFF2（无覆盖损失、压缩约一半）。
- 视觉验证方式：本环境无 Windows 与 GPU，透明窗口中的实际效果需要在 Windows 上确认，或接受以浏览器预览截图为准。

## Acceptance Criteria（初稿）

- [ ] HUD 视觉审计在浏览器预览下结论不变；原生窗口验证按待决事项结论执行。
- [ ] 覆盖层加载的 CJK 字体总体积与商店图片总体积给出前后对比，达到选定策略的预期。
- [ ] `npm run lint`、`npm test`、生产构建通过。
