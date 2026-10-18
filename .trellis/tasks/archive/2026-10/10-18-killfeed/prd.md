# CS2 击杀提示：hud.killfeed 协议与右上击杀栏

## Goal

SLUI 右上角照 CS2 `HudDeathNotice` 画击杀信息（击杀者 → 助攻者 → 武器图标 → 爆头 → 受害者）。完整需求、设计与跨仓实施计划在 SLGO 任务 `10-18-killfeed`（`prd.md` / `design.md` / `implement.md`），本任务只承担 slui 部分。来源：用户 2026-10-18。

## Requirements

- `packages/protocol`：`hud.killfeed` 事件（`HUD_KILLFEED_WEAPONS` 闭集、`parseHudKillfeed`、v0 schema / 示例 / README「HUD killfeed」）、`CLIENT_FEATURE_HUD_KILLFEED = "hud-killfeed"`。
- `src/features/killfeed/`：右上击杀栏（CS2 尺寸、viewer 高亮、5 s / 7.5 s + 1 s 淡出、无文字阴影），复用 `slui-svg` 白色剪影，新画爆头图标，无图标的武器 id 用骷髅兜底。
- overlay 声明 `hud-killfeed`；mock 场景覆盖各视觉状态。

## Acceptance Criteria

- [ ] `npm test`、`npm run lint`、`npm run build:local`、`npm run tauri:check` 通过。
- [ ] mock 截图（1920×1080 与较小 16:9）覆盖普通 / 本人击杀 / 本人阵亡 / 自杀 / 助攻 + 爆头 / 兜底图标 / 长名 / 多条堆叠。
