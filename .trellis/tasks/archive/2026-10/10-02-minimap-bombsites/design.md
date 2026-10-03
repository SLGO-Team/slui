# Design: 小地图包点 A/B

## 边界

| 层 | 职责 |
| --- | --- |
| SLGO 插件 | 唯一决定包点集合、字母、世界坐标、区域、room_id；与发电机生成共用同一解析结果 |
| slgo-backend | 用 `@slgo/protocol` 的 `parseEvent` 校验插件发来的 publish（`apps/sidecar/src/ipc/messages.ts:283`）后转发；IPC v1 夹具升级到 payload v5 |
| `@slgo/protocol`（slui/packages/protocol） | v5 解析与结构校验 |
| slui | 房间关系校验（room 属于 zone）、投影、渲染 |

## 协议：minimap payload v5

`MINIMAP_SCHEMA_VERSION` 4 → 5（init 与 positions 共用版本号；positions 结构不变，只改版本值）。客户端在 `session.open.minimap_schema_versions` 里宣告 `[5]`，sidecar 只给宣告了 5 的客户端发 minimap，旧客户端收不到 v5 事件（已有协商机制，`slgo-backend/apps/sidecar/src/client/client-session.ts:110`）。

`minimap.init` 新增必填字段：

```ts
export type MinimapBombsiteLabel = "A" | "B" | ... | "Z"; // 单个大写字母
export type MinimapBombsite = Omit<MinimapPose, "yaw_degrees"> & { label: string };
// MinimapInit += { bombsites: MinimapBombsite[] }
```

- `bombsites` 是数组，可为空（配置为空或房间都没找到）；长度 ≤ 26。
- 元素字段白名单 `label, x, y, z, zone, room_id`；`label` 为 `/^[A-Z]$/` 且唯一；位置走现有 `isMinimapPlace`（有限坐标、zone ∈ Entrance/HCZ、room_id null 或非空字符串）。
- 数组顺序不承载语义，字母本身就是身份。

为什么放 init 而不是 positions：包点是地图 + 配置决定的静态信息，同 `map_id` 内不变；放 init 不占 15Hz 帧带宽，且 init 的换图/换回合重发机制已覆盖其生命周期。

## 插件：单一来源

新增 `GeneratorSiteLayout`（`SLGO/Features/Generators/`）：

```csharp
internal sealed class GeneratorSite { char Label; Room Room; Vector3 Position; Quaternion Rotation; }
static IReadOnlyList<GeneratorSite> Resolve(IReadOnlyList<RoomType> config, IEnumerable<Room> rooms);
```

- 遍历配置第 i 项 → 字母 `'A' + i`；在 `rooms` 里取第一个该类型且尚未被占用的房间；找不到则跳过（字母不顺移）；i ≥ 26 跳过并告警。
- 位置 = `room.Position + room.Rotation * placement.Offset`，旋转同现有逻辑（从 `GeneratorManager.SpawnGeneratorInRoom` 提出）。
- `GeneratorManager.SpawnGeneratorsInRooms` 改为消费 `Resolve` 结果，消除 `Where(...).Take(n)` 与配置顺序不一致的问题。
- `SidecarMinimapPublisher.EnsureMap` 在 `roomTable.Rebuild()` 后调用 `Resolve(Config.GeneratorRoomTypes, Room.List)`，转换为 `MinimapBombsitePayload`：zone 不是 Entrance/HCZ 的跳过；`room_id` 用 `roomTable` 查（不可信时为 null，同 marker）。结果缓存到该 `map_id`，`BuildInit` 带上。
- 发送前自检（`SidecarMinimapRules` 现有 Validate 风格）补上 init 包点校验，与 v5 解析器等价。
- 不依赖发电机对象是否存在 → 与 BuyPhase 生成发电机无竞争，热身阶段也能给出。

## 客户端

### 状态
- `MinimapState.bombsites` 与 `geometry` 同生命周期：只在 `resolved` 时随几何一起提交。断线/stale 走 `clearInit` 但保留 geometry，若包点跟 init 走就会出现"底图在、包点没了"，违反 R3（实现时发现，2026-10-02 修正）。
- `resolved` 动作：几何就绪后校验每个包点 `room_id === null || roomById.get(room_id)?.zone === zone`；不通过 → `clearInit(..., "invalid")` 并清 geometry（与 init 级错误同等处理，不提交该 init）。

### 选择器
`MinimapViewModel` 新增 `bombsites: RadarBombsite[]`：

```ts
export type RadarBombsite = RadarPoint & { label: string };
// camera 存在时：init.bombsites.map(site => ({ ...clampToRadar(site, camera), label: site.label }))
```

无 camera（无几何）时为空。全图/概览模式同样投影（概览已含全部房间，自然不贴边）。

### 渲染
- `MinimapRadar.tsx` markers 层最前面（即最底下）渲染 `<BombsiteIcon>`，在 `KeycardItem` 之前。HTML 层不随 heading-up 旋转，天然正立。
- A/B：`/assets/minimap/bombsite-a.svg`、`-b.svg`（24×38），`height` 按状态 12px / 18px、宽度按比例；黄色用新增 `ColorWash` `${id}-bombzone`（rgb 255,204,0）+ `drop-shadow(0 0 1px #111)` 近似 `img-shadow 0 0 1px 2 #111`。
- C 及以后：同尺寸的 `<span>` 字母，`font-weight: 900`、`color: #ffcc00`、同样阴影。
- `data-edge` 切换两档：`edge=false` → 12px / opacity 0.4（`.BombZone_OnMap`）；`edge=true` → 18px / 0.7（`.BombZone`）。
- 图标中心对齐投影点（CS:GO `PlaceGoalIcons` 放在包点中心；Panorama 的 `x:-4px; y:-8px` 是其面板对齐细节，不照搬）。
- 尺寸单位是 300px 设计面板像素，随现有 `--radar-hud-scale` 缩放。

### Mock
`mockMinimapInit` 带 `bombsites`：用 `resolveMinimapSync` 找到 Hcz939 / HczNuke 房间，按插件 `GeneratorConstants` 的偏移计算（仅 mock 用的常量，注明来源），A=939、B=Nuke。`rebuildMinimap` 换种子时重算。`?minimapBombsites=0` 可发空数组。

## 兼容与发布顺序

v5 是破坏性版本号变更：插件、sidecar、slui 需同批更新。sidecar 通过 workspace 链接同一个 `@slgo/protocol`，解析与版本协商随 slui 协议包一起升级；只要插件仍发 v4，sidecar 会拒收其 minimap publish。旧 slui 只宣告 4 → 收不到 v5 minimap，雷达显示等待同步，其余 HUD 正常。

## 回滚
三仓各自 revert 版本号与字段即可回到 v4；无持久化数据。
