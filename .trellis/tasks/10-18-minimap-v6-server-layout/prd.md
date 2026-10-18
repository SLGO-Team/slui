# 小地图 v6：服务器下发真实布局

## Goal

SLUI 小地图不再因为 SCP:SL 小版本更新而停发或需要人工改版本号。插件在 `minimap.init` 里直接下发本局 EZ/HCZ 的真实房间布局，SLUI 按服务器数据绘制，不再用内置生成器按种子复刻地图。替换 2026-10-18 的临时做法（插件 `MINIMAP_TEMPLATE_GAME_VERSIONS = {"14.2.7","14.2.8"}` + init 一律冒充 `game_version: "14.2.7"`，SLGO 提交 e6eb0ff）。

用户价值：游戏更新后小地图继续可用，三端都不用为版本号发版；去掉 414 KB 的逆向生成器与插件对游戏私有字段的反射。

来源：用户 2026-10-18。跨仓规划在本任务（slui），插件与 slgo-backend 各建配套任务引用本任务。技术设计见 `design.md`，执行顺序与上线步骤见 `implement.md`。

## Background（已核实）

- 链路：插件 → sidecar → SLUI。sidecar **会**校验 payload：`toProtocolEvent` 用 `@slgo/protocol` 的 `parseEvent`（`slgo-backend/apps/sidecar/src/ipc/messages.ts:307`），后者 `parseMinimapInit` 钉死 `game_version === "14.2.7"` 与生成器名/版本（`packages/protocol/src/index.ts:710`）。slgo-backend 通过 workspace 链接 `../slui/packages/protocol`，sidecar 二进制编译时打包协议。
- 版本协商：SLUI `session.open.minimap_schema_versions` 宣告 `[MINIMAP_SCHEMA_VERSION]`（`src/platform/connection.ts:165`）；sidecar 只给宣告了当前版本的客户端转发 minimap 事件（`client-session.ts:125`、`hub.ts:244`）。
- 发布单元：游戏机 release 包同时含插件与 `bin/slgo-sidecar`（slgo-deploy `runtime-contracts.md` 第 1 条）；SLUI 无自动更新（`tauri.conf.json` 无 updater），玩家从 QQ 群装新安装包。
- SLUI 从生成器实际用到的只有每个 EZ/HCZ 房间的 `id`、`zone`、`name`（标题，`special-room-labels.json`）、`prefabName`（美术）、`position`、`rotationY`，以及网格尺寸（游戏 `RoomIdentifier.GridScale = (15, 100, 15)`）。`connections`/`connectors` 只用于检查点配对自检（`resolver.ts:73-85`），雷达不绘制。
- 游戏侧：`AtlasZoneGenerator.SpawnRoom` 以 `Instantiate(chosenCandidate, worldPosition, Euler(0, yRotation, 0))` 生成房间，`Spawned[j]` 带 `ChosenCandidate`（预制体，含节日变体名如 `HCZ_049 Halloween`）与 `Instance.Room`（`RoomIdentifier`：`Name`、`Shape`、`Zone`）；`ZoneGenerator : MonoBehaviour`。
- 美术：`room-artwork.json` 把 110 个预制体名（含节日变体）映射到 29 张 SVG；EZ 与 HCZ 各有 Straight / Curve / TShape / XShape / Endroom 五种形状底图。
- 现状写死点：插件 `SidecarConstants.cs:215-224`、`SidecarMinimapRules.EvaluateAvailability` / `Validate(MinimapInitPayload)`、`MinimapRoomIndex`（模板结构校验）、`MinimapRoomTable`（反射 `SeedSynchronizer._zoneGenerators`）；协议 `index.ts:115-125, 710`、`v0/minimap-init.schema.json`；SLUI `resolver.ts:2-4, 36-47`、`vendor/map-seed`；backend IPC v1 共 21 个 minimap 夹具（5 个含生成器字段）。

## Decisions

- D1 方向（用户 2026-10-18）：服务器下发真实布局，SLUI 不再依赖生成器。
- D2 上线窗口（用户 2026-10-18）：不做过渡、不双发。人少时先发游戏机 release（插件 + sidecar），紧接着发新 SLUI 安装包；接受未更新 SLUI 的玩家暂时没有小地图（sidecar 不转发给只宣告 v5 的客户端，其他 HUD 正常）。
- D3 未知预制体（用户 2026-10-18）：按「区域 + 形状」显示通用底图；形状也不认识时该房间不画。

## Requirements

- R1 协议 minimap payload v6：`minimap.init` 携带 `grid` 与 `rooms`（`room_id`、`zone`、`name`、`shape`、`prefab`、`x/y/z`、`yaw_degrees`），删除 `game_version`、`map_generator`、`map_generator_version`、`map_schema_version`、`seed`、`holiday`；`name`/`shape`/`prefab` 为自由字符串（游戏新增值不致整份 init 被拒）；`minimap.positions` 只改版本号。
- R2 parser 校验 init 内一致性：`room_id` 唯一，非 null 包点 `room_id` 存在且区域一致（sidecar 与 SLUI 共用）。
- R3 插件从游戏实际生成结果读取 EZ/HCZ 房间并自行分配确定的 `room_id`；不再有游戏版本白名单、模板结构校验、种子/节日判定或私有字段反射；布局读取失败时本代不发小地图并告警。
- R4 positions / 包点 / 指挥官卡的 `room_id` 与本代 init 的房间表一致。
- R5 SLUI 按 init 布局绘制：美术按 prefab → 区域+形状 → 不画（D3）；未知房间名标题退回区域名；删除内置生成器及其模板、夹具和校验脚本，测试与 mock 改用一次性导出的静态布局夹具。
- R6 sidecar 随协议包升级到 v6，IPC v1 夹具更新并补 v6 语义非法用例。
- R7 规格与文档同步：协议 README / schema / example、slui `minimap.md` / `system-boundaries.md` / `SOURCE-MAP.md` / `rooms/PROVENANCE.md` / README 致谢、插件 `Sidecar/CLAUDE.md` 与 `sidecar-ipc.md`、backend 夹具说明。
- R8 不写任何 v5/v6 双版本兼容代码（D2）。

## Acceptance Criteria

- [x] R1/R2：v6 parser 与 JSON Schema 接受示例与未知 name/shape/prefab 字符串，拒绝缺字段、多余或旧生成器字段、空/超量 rooms、重复 room_id、非法字符串/坐标/yaw/grid、包点引用不存在或区域不符的房间、v5 版本号（`minimap-contract-smoke`）。
- [x] R3/R4：插件单测覆盖编号确定性、yaw 规范化、去重与空区不可用、自检与 parser 等价、v6 序列化字段精确、游戏版本不影响可用性；`SidecarConstants` 与源码中不再出现游戏版本/生成器常量；`dotnet build`（含 `RunAccessScan`）与 `dotnet test` 全过。
- [x] R5：仓库内无 `vendor/map-seed`；未知 prefab 显示形状底图、未知形状不画并记诊断、未知名标题退回区域（smoke 用例）；mock 模式与 `minimap-visual-audit` 用静态夹具渲染正常；`npm run lint`、`npm test`、`npm run build:local` 全过。
- [x] R6：backend v6 夹具 `bun run lint`、`bun test` 全过；插件 `IpcContractFixtureTests` 用 v6 夹具通过。
- [x] R7：所列文档不再描述生成器钉版本或 v5 init 字段。
- [x] 三仓改动各在 `claude/minimap-server-layout` 分支提交；上线顺序与核对步骤写在 `implement.md`。
- [ ] 实机（用户发布后，未验证）：两实例插件日志出现「小地图已就绪 … 房间 N 个」、无布局不可用告警；新 SLUI 进服雷达正常、美术完整。

## Out of Scope

- LCZ / Surface 小地图、新房间专用美术、连通关系绘制。
- 旧 SLUI（v5）在新服务器上的小地图，以及任何双版本兼容（D2、R8）。
- 把 SLUI reducer 的异步 resolve 状态机改为同步（设计保留现有接缝，见 `design.md`）。
- SLUI 安装包构建、QQ 群发布与游戏机 release 的执行（用户执行）。
