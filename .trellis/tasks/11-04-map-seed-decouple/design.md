# 设计：小地图夹具改由游戏导出

## 插件侧（SLGO 仓库，分支 `feat/minimap-dev-export`，本地合并 main）

`SLGO/Features/Sidecar/Minimap/MinimapDevExport.cs`，整个文件 `#if DEBUG`：线上部署走 slgo-deploy 的
Release 构建，不含这段代码。由环境变量触发，不加命令、不改配置：

| 变量 | 作用 |
|---|---|
| `SLGO_MINIMAP_EXPORT_DIR` | 设置后启用导出，文件写到该目录 |
| `SLGO_MINIMAP_EXPORT_SEED` | 可选：在 LabAPI `MapGenerating` 里改种子 |
| `SLGO_MINIMAP_EXPORT_HOLIDAY` | 可选：`Halloween` / `Christmas`，Harmony 前缀强制 `HolidayUtils.GetActiveHoliday` |

- 节日由 `GameCore.Version.ActiveHoliday`（构建内 static readonly）决定，正常服只出当前节日；
  强制补丁仅开发导出用。若 Mono 内联导致补丁无效，以导出结果里是否出现节日预制体为准，导不出就不保留节日布局。
- 布局：`SeedSynchronizer.OnGenerationFinished` 后用线上同一个 `MinimapRoomTable.Rebuild()`，
  写 `layout-<seed>-<holiday>.json`（与 v6 minimap.init 的 `grid` / `rooms` 同形，附游戏版本、种子、节日）。
- 预制体目录：EZ/HCZ 的 `AtlasZoneGenerator.CompatibleRooms` 及每个 `HolidayVariants[].Result`；
  名称、区域（生成器 TargetZone）、`RoomIdentifier.Name` / `Shape`、门口 = 预制体内
  `RoomConnectorSpawnpointBase` 的位置（相对预制体根的 x/z）。写 `prefabs.json`。

## slui 侧

- `scripts/fixtures/minimap-prefabs.json`、`src/mocks/minimap-layouts.json` 换成导出结果，`note` 写明游戏版本、
  导出方式（插件 Debug 构建 + 环境变量）、日期。格式保持现有 smoke / mock 读取的形状，消费代码不改。
- 种子沿用现有四份（1062329959、142007、Halloween 1、Christmas 2147483647），同种子同游戏版本应得到同布局，
  便于和旧夹具对比；mock 预览截图对比验证。
- README 致谢改成历史一句；PROVENANCE.md 改来源描述。负例测试输入保留。
