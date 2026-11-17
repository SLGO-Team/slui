# 小地图 CS2 对齐：观战选中框与队友编号

父任务：`11-17-minimap-cs2-parity`（D15、D16）。在 `11-17-minimap-cs2-slui` 合入后再开始规划。

## Goal

- D15：复刻 CS2 雷达的观战选中框 `#Selected`（`map_view_selected`，42×36，y −10px），在对应条件下框住被选中的玩家。
- D16：复刻 CS2 画在玩家点上的编号 `#PlayerNumber`（10px Stratum2 medium，黑色，居中，不随朝向旋转）。前提是
  现在的 CS2 在相应模式下确实会显示它。

## Known facts

- 两者分别是 CS2 玩家图标的第 27 位和第 0 位（`research/cs2-radar-client-re.md`）。
- SLUI 已经有每名玩家的槽位颜色（`playerSlotColors`），编号可以从同一份比赛快照里得出，不一定需要新的协议字段。

## Open（规划时解决）

- 在 `client.dll` 中查清第 0 位和第 27 位的设置条件：是哪些模式、观战还是存活、自己还是队友。
- 用实机或录像确认竞技模式下现在是否显示编号。如果 CS2 当前不显示，就和用户确认要不要关掉这一项。
- 观战时「选中」在 SLGO 中对应什么：第一人称跟随的玩家，还是观察者自由视角下用鼠标选中的玩家。

## Acceptance（初稿）

- [ ] 选中框和编号的出现条件、尺寸、颜色与 CS2 研究结论一致，并有 model 测试和视觉审计覆盖。
