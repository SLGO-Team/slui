# 小地图 CS2 对齐（父任务）

## Goal

SLUI 雷达还有一些机制和外观和 CS2 不一致。这个任务按用户 2026-11-17 选定的范围把它们对齐。父任务负责需求清单、
子任务映射和跨子任务验收；具体实现由子任务完成。

## Source requirement set（用户 11-17 的取舍）

差距清单编号沿用会话里的 A–E：

| 编号 | 差距 | 用户决定 | 归属 |
| --- | --- | --- | --- |
| A1 | 图标不随缩放变化（`cl_radar_icon_scale_min`） | 改 | 11-17-minimap-cs2-slui |
| A2 | 另一区域被调暗（CS2 楼层切换） | 改：办公区与重收容区视为同一层（同一平面），去掉调暗，不做区域淡入淡出 | 11-17-minimap-cs2-slui |
| A3 | 上下层提示 | 不改 | — |
| A4 | 默认跟随视角旋转 | 不改（SLUI 默认仍为固定朝向） | — |
| A5 | 动态缩放参数不是原版 | 改：按 CS2 原版算法 | 11-17-minimap-cs2-slui |
| B6 | 钥匙卡安放显示 | 改（按逆向结果修正：没有 24px 闪烁图标，改为红色光晕与双圈） | 11-17-minimap-cs2-slui |
| B7 | 安放后雷达边框闪红 | 改 | 11-17-minimap-cs2-slui |
| C8 | 方形雷达多画了边框 | 改 | 11-17-minimap-cs2-slui |
| C9 | 边框颜色 | 逆向和实机都确认已与 CS2 一致（HUD 颜色默认就是队伍色），无需改 | — |
| C10 | 地点名样式 | 改 | 11-17-minimap-cs2-slui |
| C11 | 出现时淡入 0.1s | 改 | 11-17-minimap-cs2-slui |
| C12 | 方向箭头 | 不做：CS2 在初始化时就把它隐藏了，之后从不显示 | — |
| D13 | 说话提示 | 改 | 11-17-minimap-speaking |
| D14 | 标点 | 不改 | — |
| D15 | 观战选中框 | 改（脚步声圈不改） | 11-17-minimap-spectate-number |
| D16 | 队友编号 | 改（先确认 CS2 什么时候显示） | 11-17-minimap-spectate-number |
| E17 | SLUI 自有状态文字 | 删除 | 11-17-minimap-cs2-slui |

## Child tasks

1. `11-17-minimap-cs2-slui`：只改 SLUI（A1、A2、A5、B6、B7、C8、C10、C11、E17）。先做这个。
2. `11-17-minimap-speaking`：插件、协议和 SLUI 三边配合（D13），需要新的协议版本。
3. `11-17-minimap-spectate-number`：观战选中框和队友编号（D15、D16）。要先查清 CS2 的显示条件，再决定要不要改协议。
4. `11-17-minimap-team-colour-mode`：#117 评审时追加（用户 11-17「按 CS2 做，另开任务」）。槽位色只在竞技类模式且
   人数上限 ≤ 10 时启用，其余回落 SLGO 身份色；插件、协议、backend 和 SLUI 都要改。SLUI PR 在 #117 之后、
   `11-17-minimap-speaking` 之前。

子任务之间没有代码依赖；2 和 3 都会改 `MinimapRadar` 的标记渲染，所以在 1 合入后再开始，避免冲突，
并且按 [[parallel-prs-journal-conflict]] 依次开 PR。

## Cross-child acceptance

- 每个子任务的 PR 单独合入；改动画面的 PR 等用户看过实机或 mock 截图后再合（视觉类 PR 规则）。
- `.trellis/spec/frontend/minimap.md` 在每个子任务里同步更新，最终不留与实现矛盾的旧规则。
- CS2 依据统一记录在 `11-17-minimap-cs2-slui/research/cs2-radar-client-re.md`，子任务往里追加，不另开文件。

## Out of scope

A3、A4、C9、C12、D14、脚步声圈，以及新发现的 `cl_radar_square_when_spectating` 和
`cl_radar_show_all_players_when_spectating`（用户还没决定要不要做）。
