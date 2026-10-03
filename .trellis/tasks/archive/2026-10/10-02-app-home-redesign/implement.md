# Implement — SLUI 主界面视觉重构

## Checklist

1. [x] 设计 SLUI 图标 SVG（多候选在浏览器预览中给用户挑选，含 16/32px 缩略效果）；定稿后入库。
   - 候选已出：`design/icons.html`（A 收容视窗 / B UI 字标 / C 雷达 / D 括号字标），用户定稿 A（`src/app/home/slui-icon.svg`）。
2. [x] 视觉稿：在 `/?window=home` mock 预览中实现首页 + 设置页静态布局与 tokens，截图给用户确认（门禁：AC1 视觉确认前不进入第 4 步实机改动）。
3. [x] 按定稿重写 `src/app/home/` 渲染树与样式：标题栏、左导航、首页、设置页三组；保留 `HomeApp` 数据逻辑。
   - 视觉稿直接实现在 React 中（`TitleBar`、`NavRail`、`OverlaySwitch` 主视觉、`StatusBar` 卡片、`KeyHints`、`controls.tsx` 共用控件），浏览器 960×620 / 820×560 已自检；待用户确认视觉后再做第 4、5 步。
4. [x] 窗口外框：`tauri.conf.json` home 窗口 `decorations:false`、`maximizable:false`、新尺寸；capabilities 追加窗口权限；标题栏按钮接 Tauri window API（非 Tauri 环境降级）。
5. [x] 生成并替换 `src-tauri/icons/` 全套图标。
6. [x] 浏览器预览自检：默认 / 最小尺寸截图，各连接与覆盖层状态，设置修改即时生效（两标签页 home + overlay）。
7. [x] 更新 README 中主界面描述（如有变化）与相关 spec。
8. [x] Windows 实机：AC5 窗口行为 + AC7 回归清单（由用户执行）。

## Validation

```bash
npm run lint
npm test
npm run build
npm run tauri:check
```

- 设置相关 smoke：`scripts/settings-smoke.mjs`、`scripts/desktop-adapters-smoke.mjs`（随 `npm test` 运行，确认仍通过）。

## Risky points / rollback

- `decorations:false` + 拖动区 + 禁止最大化在 Windows 上的交互细节（双击、Aero Snap、阴影）只能实机验证。
- capabilities 漏配会导致按钮静默失败——在实机首次运行时检查控制台。
- 回滚点：第 3 步之前仅新增图标与样式草稿；第 4 步的窗口配置可单独回退。
