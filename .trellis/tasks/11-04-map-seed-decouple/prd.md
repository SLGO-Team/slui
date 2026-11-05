# 解耦 scpsl-map-seed

## Goal

slui 不再含有从 `@scpsl-tools/map-seed` 导出的数据，也不再需要为它致谢或附许可证。
房间预制体清单和测试布局改由权威来源（游戏本身，经插件导出）提供。

## 现状（2026-11-04）

- 代码不再引用该包（v6 起布局由服务器下发，2026-10-18 删除了 vendored 生成器）。
- 仍从它导出的数据：
  - `scripts/fixtures/minimap-prefabs.json`：110 个 EZ/HCZ 预制体的名称、区域、形状、房间名、门口坐标（smoke 用它校验美术出口）。
  - `src/mocks/minimap-layouts.json`：4 份测试/预览布局（含万圣节、圣诞节）。
  - `src/features/minimap/room-artwork.json` 的 `byPrefabName` 键（预制体名清单）。
- 文字：README 致谢、`public/assets/minimap/rooms/PROVENANCE.md`、`SOURCE-MAP.md`、spec（minimap.md、system-boundaries.md）、
  minimap-contract-smoke 里拒绝 v5 字段的用例（字面量 `"@scpsl-tools/map-seed"`，只是负例输入）。

## Requirements

- 预制体清单（名称、区域、形状、房间名、门口位置）从游戏本身取：插件可从 `AtlasZoneGenerator.CompatibleRooms`
  及其 `HolidayVariants` 枚举全部预制体；门口位置的来源需调研（预制体里的门/连接点）。
- 测试布局改为插件对真实生成结果的导出（与线上 v6 init 同形），至少覆盖普通布局；节日布局能导出就保留，导不出则说明覆盖范围。
- 导出工具放在插件仓库（开发用命令或测试工具），slui 的夹具文件头注明来源（游戏版本、导出方式、日期）。
- README / PROVENANCE / SOURCE-MAP / spec 去掉「取自 scpsl-map-seed」的描述；历史说明可以保留一句「v5 及以前用过」。
- 美术映射行为不变（同一预制体仍对应同一张图）。

## Acceptance Criteria

- [ ] `rg -i "map-seed|scpsl-map-seed"` 在 slui 中只剩历史说明（spec 历史、归档任务）和负例测试输入。
- [ ] 新夹具来自游戏导出，smoke 全过（美术出口校验仍在，或按新数据等价校验）。
- [ ] mock 预览的小地图渲染与之前一致（截图对比）。
- [ ] `npm run lint`、`npm test`、`npm run build` 通过。
