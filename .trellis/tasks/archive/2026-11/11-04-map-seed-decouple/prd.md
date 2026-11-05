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

- [x] `rg -i "map-seed|scpsl-map-seed"` 在 slui 中只剩历史说明（spec 历史、归档任务）和负例测试输入。
- [x] 新夹具来自游戏导出，smoke 全过（美术出口校验仍在，或按新数据等价校验）。
- [x] mock 预览的小地图渲染与之前一致（截图对比）。
- [x] `npm run lint`、`npm test`、`npm run build` 通过。

## 结果（2026-11-05）

- 插件：SLGO `feat/minimap-dev-export` 已本地合并 main（f4ac287）。`MinimapDevExport`（#if DEBUG）+ PatchInstaller 里的
  Debug 节日前缀；Release 构建不含（Release dll 里无该环境变量字符串），两种构建访问级别扫描通过，插件测试 2729 全过。
- 本机专用服务器（EXILED，7777）换 Debug 插件，四组种子/节日各导出一次（约 10 s/次），之后还原原插件。
- 对比旧夹具：游戏现为 14.2.9；110 个预制体名称、区域、形状、门口坐标与旧的一致（最大差 1.4e-7）；四份布局房间数、
  编号、预制体、位置、朝向全部一致（最大差 1e-5，游戏 float 噪声，旧生成器输出取整值）。强制节日有效。
- smoke 的「通用美术出口」检查原依赖夹具顺序取基准预制体（新目录按名称排序后挑到检查站半边），改为取出口方向最多的那个。
- mock 预览：新旧夹具渲染的 70 个房间 transform 只差 1e-6 级，画面一致。
- `npm run build` 需 `VITE_CONTROL_PLANE_URL`（#95 起的设计，CI 用占位地址），本地同样用占位地址构建通过。
