# Design: 小地图 v6（服务器下发真实布局）

## 边界

| 层 | 职责 |
| --- | --- |
| SLGO 插件 | 地图的唯一权威：从游戏实际生成结果读 EZ/HCZ 房间，分配 `room_id`，下发布局；positions / 包点 / 指挥官卡的 `room_id` 查同一张表 |
| `@slgo/protocol`（slui/packages/protocol） | v6 结构校验，以及 init 内的交叉校验（room id 唯一、包点引用存在且区域一致） |
| slgo-backend sidecar | 用同一协议包校验后转发；只给宣告 v6 的客户端转发（现有协商，不改代码，只改夹具） |
| slui | 布局 → 几何（美术选择、标题、边界）、投影、渲染；positions 的 `room_id` 与 init 房间表交叉校验（现有 `validRooms`） |

不再有任何一端知道「游戏版本」「生成器」「种子」「节日」。

## 协议：minimap payload v6

`MINIMAP_SCHEMA_VERSION` 5 → 6（init 与 positions 共用；positions 结构不变）。

```ts
export type MinimapRoom = {
  room_id: string;          // 非空，≤ 64，同一 init 内唯一
  zone: MinimapZone;        // "Entrance" | "HeavyContainment"
  name: string;             // 游戏 RoomName 枚举名，如 "Hcz049"、"Unnamed"；非空 ≤ 64，不做枚举校验
  shape: string;            // 游戏 RoomShape 枚举名，如 "Endroom"、"Straight"；非空 ≤ 64，不做枚举校验
  prefab: string;           // 生成所用预制体名，如 "HCZ_049 Halloween"；非空 ≤ 64
  x: number; y: number; z: number;  // 房间原点世界坐标（有限数）
  yaw_degrees: number;      // [0, 360)，0 = +Z，90 = +X（与位姿同约定）
};

export type MinimapInit = {
  minimap_schema_version: 6;
  map_id: string;
  coordinate_system: "unity-world-xz";
  grid: { x: number; z: number };   // 游戏 RoomIdentifier.GridScale 的 x/z（现为 15/15），有限正数
  position_update_hz: number;
  rooms: MinimapRoom[];             // 1..256
  bombsites: MinimapBombsite[];     // 不变（v5）
};
```

- **删除** `game_version`、`map_generator`、`map_generator_version`、`map_schema_version`、`seed`、`holiday`。
- `name` / `shape` / `prefab` 故意是自由字符串：游戏新增枚举值或预制体时不能让整份 init 被拒（那样又回到「更新即停发」）。客户端认识的照常显示，不认识的降级。`zone` 保持严格枚举（插件只发两区）。
- **parser 内交叉校验**（sidecar 与 SLUI 都执行）：`room_id` 唯一；非 null 的包点 `room_id` 必须存在且 `zone` 一致。这一步以前要等生成器出几何后在 reducer 的 `resolved` 里做（`model.ts:167`），现在 init 自身就够了。
- positions 的 `room_id` 仍由 SLUI reducer 对照当前 init 校验（`validRooms`，`model.ts:105`）；语义从「生成器房间」改为「本 init 的 `rooms` 中的房间」。
- 大小：约 60–75 个房间，每个约 130 字节，一份 init 约 8–10 KB；每名玩家每回合发一次，IPC 帧上限 1 MiB。

## 插件

### 读布局（替换 `MinimapRoomTable` 的实现与 `MinimapRoomIndex`）

- `UnityEngine.Object.FindObjectsOfType<AtlasZoneGenerator>()`（`ZoneGenerator : MonoBehaviour`，公开 API），只取 `ZoneName(TargetZone)` 为 EZ/HCZ 的生成器。不再反射 `SeedSynchronizer._zoneGenerators`，不再校验生成器数量/顺序/种类。
- 每个 `Spawned[j]`：`RoomIdentifier room = Instance.Room`；`prefab = ChosenCandidate.name`（预制体本身的名字，不需要剥 `(Clone)`）；`name = room.Name.ToString()`、`shape = room.Shape.ToString()`；位置与朝向取 `Instance.transform`（正是 `Instantiate(worldPosition, Euler(0, yRotation, 0))` 放下的位姿），yaw 规范到 `[0, 360)`。
- `room_id`：按 (zone, x, z) 排序后编号 `room-000`…，与生成顺序无关、同一地图结果确定，方便日志与测试。`TryGetId(RoomIdentifier)` 供采集器与包点使用（接口不变）。
- 失败语义变化：以前房间表不可信时地图照发、`room_id` 为 null；现在房间表就是地图，读取失败、任一区为空或自检不过 → 本代地图不发布小地图并 `Log.Warn` 原因（`MinimapAvailability.LayoutUnavailable`）。

### 可用性与 init

- `EvaluateAvailability` 只剩「设施已生成」与「布局可用」；删除游戏版本、种子、节日判定与 `MINIMAP_TEMPLATE_GAME_VERSIONS`、`MINIMAP_GAME_VERSION`、`MINIMAP_MAP_GENERATOR*`、`MINIMAP_MAP_SCHEMA_VERSION`、`Holidays`。
- 「SLUI 小地图已就绪」日志保留种子、节日、游戏版本、房间数（仅诊断）。
- `MinimapInitPayload` v6 字段 + `MinimapRoom` DTO；`Validate(MinimapInitPayload)` 与 v6 parser 等价（数量 1..256、id 唯一、字符串长度、有限坐标、yaw 范围、grid 正数、包点引用存在且区域一致）。

## SLUI

### 布局 → 几何（`resolver.ts`）

- 删除生成器导入与 `assertSupportedMap` 的版本判断（parser 已保证结构）。`MapRoom` 由 `init.rooms` 直接映射：`position = {x,y,z}`、`rotationY = yaw_degrees`、`label = special-room-labels[name] ?? null`（未知名退回区域名，现有行为）。
- `MapGeometry.connections`、`MapRoom.connectors` 与检查点配对自检删除：雷达不绘制它们，自检是为生成器复刻兜底的。
- `mapDescriptorKey` = `[minimap_schema_version, coordinate_system, grid, rooms]` 的 JSON，继续用于缓存与同 `map_id` 内容冲突检测（`knownMaps`）。
- 保留 `resolveMinimap` 异步接缝与 reducer 的 `resolved` / `resolve-error` 状态机：计算已变得很便宜，但改状态机不是本任务目标，避免牵动已测稳定的时序。
- `resolved` 中的包点 room 校验移入 parser 后删除。

### 美术选择（`room-artwork.ts`）

`createRoomArtwork(room, grid)`：
1. `room-artwork.json` 的 `byPrefabName[prefab]`（现有 110 个预制体名 → 29 张 SVG，含节日变体）。
2. 未命中 → 按 `zone + shape` 选通用底图（prd D3）：

   | shape | Entrance | HeavyContainment |
   | --- | --- | --- |
   | Endroom | `EZ_NonGateEnd.svg` | `HCZ_EndSmall.svg` |
   | Straight | `EZ_Straight.svg` | `HCZ_Straight.svg` |
   | Curve | `EZ_Curve.svg` | `HCZ_Curve.svg` |
   | TShape | `EZ_ThreeWay.svg` | `HCZ_ThreeWay.svg` |
   | XShape | `EZ_Crossing.svg` | `HCZ_Crossing.svg` |

   形状相同的房间在游戏图集里朝向约定一致（形状 + 旋转决定门的位置），所以通用底图的出口与实际门对得上。映射放进 `room-artwork.json` 的新键 `byZoneShape`，`PROVENANCE.json` 的 manifest 哈希随之更新。
3. 形状也未知 → 该房间不画图（仍在 `roomById` 中，标题与校验照常），记 `diagnostics`。
4. `diagnostics` 增加 `unknown-room-artwork`（prefab 名）。

### 测试夹具与 mock

- 删除生成器前，用它一次性导出 4 份布局作为静态夹具 `src/mocks/minimap-layouts.json`（v6 `rooms` 形状 + grid）：`1062329959/None`（mock 默认）、`142007/None`（mock 换图）、`1/Halloween`、`2147483647/Christmas`。附注来源（map-seed 1.0.0、14.2.7 模板、导出日期）。
- `createMockMinimapInit(layout)` 从夹具取房间；mock 换图在两份布局间切换；包点 mock 逻辑按房间名找房间（不变）。
- 删除 `vendor/map-seed/`（含 LICENSE、fixtures.json、14.2.7 模板）与 smoke 中的源码哈希、生成器输出哈希断言；生成器相关的几何断言改为遍历静态夹具。保留美术清单哈希与 SVG 安全检查。

## 兼容与发布

- v6 是破坏性版本号变更，按 D2 不做双版本：新 SLUI 宣告 `[6]`；sidecar 只认 v6；插件只发 v6。插件与 sidecar 同包发布，所以服务器内部不存在版本错配。
- 窗口期：旧 SLUI 连新服务器 → 收不到 minimap 事件，雷达保持等待同步；新 SLUI 连旧服务器同理。其他 HUD 不受影响。
- 回滚：三仓 revert 即回 v5（但会回到写死 14.2.7/14.2.8 的状态）；无持久化数据。按「不做回退」偏好，不为回滚额外投入。

## 风险

- **预制体名来源**：`ChosenCandidate.name` 应与模板 `prefabName` 一致（模板取自游戏资源）；若实机出现大面积未命中，雷达会显示通用底图而不是空白，再按插件日志补映射。上线后核对：插件「就绪」日志房间数与 SLUI 渲染。
- **`FindObjectsOfType` 包含非活动/重复生成器**：按 `TargetZone` 过滤且以 `RoomIdentifier` 去重；同一 RoomIdentifier 出现两次视为布局不可用。
