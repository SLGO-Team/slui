# 小地图 v3 渲染（CS2 最后已知位置与死亡 X）

## Goal
SLUI 雷达按 minimap v3 的 `status` 与 `status_age_ms` 还原 CS2 表现。依赖 `09-30-minimap-v3-protocol`。来源：SLGO 任务 `09-30-slui-minimap`。

## Requirements（依据 `research/cs2-last-known.md` 与 `research/minimap-v3-contract.md`）
- live 敌方红点（#ff1919，13×13，opacity 0.95）；last-known 红色 `?`（9×15，opacity 0.8，不随朝向旋转），不透明度 clamp(1 - age/6000)；dead 为 X（19×19），clamp(1 - age/4000)；出界统一边缘箭头并同样淡出。
- age = 收到帧时的 status_age_ms + 本地单调时钟推进；过期后即使仍在帧中也不渲染。
- last-known / dead 不插值、不作相机目标、不参与动态缩放拟合；authorizationKey 纳入 status。
- 图标参照 CS2 雷达的 `icon-enemy-ghost`、`map_death` 绘制，遵守既有素材来源记录规范。

## Acceptance Criteria
- [ ] reducer/selector 测试覆盖三种状态、淡出曲线、过期兜底、revision 与 status 变化。
- [ ] mock 预览可演示发现 -> 丢失 -> ? 淡出 -> 再发现、死亡 X。
