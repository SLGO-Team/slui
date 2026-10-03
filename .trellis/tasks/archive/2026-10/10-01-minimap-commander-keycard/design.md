# Design — 小地图指挥官卡 / 己方箭头白色

> 修订 2026-10-01（用户反馈）：按 CS2 炸弹雷达对齐。被发现的持卡敌人显示持卡；卡失去视野后在最后位置 8 秒淡出；
> 持卡人的卡片改画在圆点上方；朝向箭头放大。之后又加入"启动发电机后卡固定在发电机"（CS2 已安放炸弹，`state: planted`）。行为依据为 CS:GO `sfhudradar.cpp`：`player_has_c4` 随被发现的玩家下发，
> `m_fBombAlpha = clamp(1 - (now - m_fBombSeenTime) / BOMB_FADE_TIME)`，`BOMB_FADE_TIME = 8.0f`。

## 1. 箭头（R3）

`MinimapRadar.css` 中 `.minimap-marker img { filter: var(--marker-filter); }`（特异性 0,1,1）压过了
`.minimap-marker__heading { filter: none; }`（0,1,0），所以朝向箭头被槽位色乘色。SOURCE-MAP 的既定意图就是
"Unwashed white"。修复：把不染色的规则提到同等以上特异性：

```css
.minimap-marker .minimap-marker__heading,
.minimap-marker .minimap-marker__ghost { filter: none; }
```

`__ghost` 有同样的特异性问题（红色 PNG × 红色乘色，肉眼差别小），按同一意图一并修。

箭头去掉染色后，原来 8px 的盒子只在 8px 圆点外露出约 3px 白色尖，看起来太细；试过 11px 又太大。定为 9×9、y=-10，
露出约 4px。原图三角形的轴线在 x=16.5（画布中心是 16），且 `left: -5.5px` 这类小数定位会被浏览器取整到设备像素，
两者叠加让箭头偏离圆点轴线约 1 屏幕像素（用户截图像素分析）。改用 `transform: translateX(-51.5625%)`（16.5/32）居中，
变换位移不取整；浏览器实测轴线与圆点中心 x 完全一致。

## 2. 协议：minimap payload v4

v3 的解析器用 `hasOnlyKeys` 严格拒绝未知字段，新增字段会让 v3 客户端把每一帧判为 invalid。`session.open`
已经通过 `minimap_schema_versions` 协商版本，所以权威做法是升到 v4。沿用 v3 的先例（`09-30-minimap-v3-protocol`）：
整体换版本、删掉 v3 分支（目前没有生产环境对端，三端同步发布）。

`minimap.init` 不变，只把 `minimap_schema_version` 改为 4。`minimap.positions` 新增两个字段：

```ts
type MinimapPosition = MinimapPose & {
  // ...v3 fields
  /** Commander keycard holder; any live marker, a spotted opponent included (CS2 bomb carrier). */
  has_commander_keycard: boolean;
};
/** The card as a radar item when no marker holds it (CS2 bomb package). */
type MinimapCommanderKeycard = Omit<MinimapPose, "yaw_degrees"> & {
  status: "live" | "last-known";
  status_age_ms: number; // live: 0; last-known: < MINIMAP_KEYCARD_FADE_MS (8000)
  state: "carried" | "dropped" | "planted"; // where it was when last seen; planted = in the started generator
  team_id: TeamId; // owner = the match team currently playing NTF; opponents draw the card red
};
type MinimapPositions = {
  // ...v3 fields
  commander_keycard: MinimapCommanderKeycard | null;
};
```

两个字段都是必填项（不是可选）：插件每帧都必须明确给出，避免用"缺省"表达"不可见"。

为什么持卡人用标记标志而不是让物品跟着持卡人走：标记在客户端会插值，物品是 15 Hz 的原始位置，
两者放在一起会抖；而且标志让 UI 能把卡画在正确的标记上。所以"看得到的持卡人"走标记标志，物品只表达
"地上的卡"和"失去视野后的最后位置"。

### 关系规则（解析器 + 插件 Validate 同步）
1. `has_commander_keycard: true` ⇒ `status === "live"`（任意 visibility）。
2. 每帧最多一个 `has_commander_keycard: true`。
3. 存在持卡标志时，`commander_keycard` 必须为 `null`（一张卡只出现在一处）。
4. `commander_keycard`：坐标有限，zone ∈ {Entrance, HeavyContainment}，`room_id` 为 null 或非空且属于该 zone（客户端 `validRooms`）；
   `live` ⇒ 年龄 0 且 `state` 为 `dropped` / `planted`；`last-known` ⇒ 0 ≤ 年龄 < 8000，`state` 为三者之一。

客户端无法验证视线，所以"谁知道卡在哪"由插件负责（与 spotted 标记同理）。

### 授权签名
纳入 `authorizationKey`（slui）/ `Signature`（插件），两者同构：每个标记追加 `has_commander_keycard`，
帧级追加物品的 `[status, state]`（无物品为 null）。签名变化 ⇒ `visibility_revision` 递增；年龄变化复用。

## 3. 插件（SLGO，C#）

- `MinimapPlayerState.HasCommanderKeycard`（采集时调用 `GeneratorInteractionManager.HasCommanderKeycard`，与名牌同源）。
- `MinimapWorldSnapshot.CommanderKeycardDrop`：不在任何人身上的卡的位置（不在 EZ/HCZ 则为 null）+ `Planted` + 本 tick 看到它的存活 SCP 方玩家。
  - 来源：先找 NTF 已启动的发电机（`Generator.List` 中 `IsActivating || IsEngaged`，NTF 启动时卡已从库存移除），位置取 `Generator.Position`，
    `Planted = true`；否则取 `Pickup.List` 中 `Type == KeycardMTFCaptain`，正常每局一张；多张时取 serial 最小者（确定性）。
  - 发电机视线：游戏原生是一条 Door + Default 层射线，碰到任何东西都算遮挡，发电机自身的碰撞体会挡住射向它原点的射线。
    所以发电机目标用同一条射线和层，但命中的碰撞体全部属于该发电机（`transform.IsChildOf(generator)`）时视为畅通；命中缓冲区满时保守视为遮挡。
  - 发电机根节点（`Generator.Position`）贴地，实机中射向它永远被地板 / 墙根挡住（用户 2026-10-01 实测无反应）。视线检查点改为机身
    非触发碰撞体包围盒的中心 + 6 个面中心（各向内收 20%，保持在机身内），任一可见即看到；只用中心点时实测只有机身一部分算数。
    雷达显示位置仍取根节点。Debug 日志每 2 秒输出逐点诊断（视野 / 射线 / 黑暗、首个遮挡碰撞体路径）。
  - 视线：`MinimapVisionProbe` 的静态点目标（单检查点；人类：同层 → 视野 → 射线 → 黑暗；079：距离 → 视野 → 射线；
    不做 `PassesNativeVisibility` / 268，那是玩家目标专属），由 `MinimapSpotRules.IsPointSpottedBy*` 编排。
- `MinimapTeamTracker.KeycardOf(team)`：按队维护卡的记忆（CS2 `m_BombPosition` + `m_fBombSeenTime`）。
  - 本 tick 知道卡在哪 ⇒ Live：本队持有；或看到持卡敌人（与敌人标记同一组目击）；或卡在地上 / 发电机里且本队是 NTF 方，
    或本队存活成员看到它。持卡人优先于掉落物；记忆带 `State`（carried / dropped / planted）。
  - 否则 Live → LastKnown，冻结在最后知道的位置（`dropped` 保留），8 秒后移除。回合 / 地图切换清空。
- `BuildFrame`：
  - live 标记（本队、observed、被发现的敌人）带 `member.HasCommanderKeycard`；死亡 / 最后已知标记恒为 false。
  - 有标记持卡 ⇒ 物品 null。否则：对 NTF 队有观察授权（且自己不是 NTF 队）的 viewer 取实时掉落卡；
    已分配 viewer 取本队记忆（Live 掉落 / 已安放 → `live`；Live 但在不可见的持卡人身上 → null；LastKnown → `last-known` + 年龄 + state）；
    其余 null。
- `Validate` 与 v4 解析器逐条对应；`MINIMAP_SCHEMA_VERSION = 4`、`MINIMAP_KEYCARD_FADE_MS = 8000`。

## 4. slgo-backend

通过 `@slgo/protocol`（junction 链接）校验，版本常量自动跟随。只需把 `protocol/ipc/v1` 下的 minimap 示例和 invalid 夹具升级到 v4，
并新增指挥官卡的 invalid 夹具（最后已知标记持卡、两个持卡人、卡既在标记上又是物品、物品年龄过期）；测试里硬编码的
`minimap_schema_versions: [3]` 改为常量。

## 5. slui 渲染

### 视图模型
- `RadarMarker.hasKeycard`（来自 position，经过插值保留）。
- `MinimapViewModel.keycard: RadarKeycard | null`，`RadarKeycard = RadarPoint & { status, dropped, opacity }`，
  位置由 `clampToRadar`（与标记共用的投影和边缘夹取）计算。
- `keycardOpacity`：`live` 为 1；`last-known` 为 `1 - (status_age_ms + 本地经过时间) / 8000`，到期返回 null 不再绘制
  （与最后已知 `?` 的 `markerOpacity` 同一套本地时钟推进）。
- 物品不参与相机、视点和动态缩放。

### 图标与样式（对齐 CS2 `RI_BombDefuserPackage`）
- 图标：沿用顶部 HUD 已有的 `/assets/slui-svg/KeycardNTFCommander.svg`（白色卡片），对应 CS2 `#CreateBombPack`（16×12，`img-shadow: 0 0 2px black`）。
  按标记共用的约 0.73 缩放，取 12×12 盒子，加黑色 `drop-shadow`。
- 持卡人：卡片居中画在圆点上方（CS2 炸弹包画在携带者上方）；被发现的持卡敌人同样显示。贴边时跟随标记的夹取位置。
  颜色跟随持有人标记的染色（队友槽位色，敌人红色；用户 2026-10-01 在 CS2 实机确认），与 CS2 Panorama 静态资源（白图、无 wash）不同，
  说明 CS2 是运行时着色。
- 物品颜色：物品带 `team_id`（当前扮演 NTF 的比赛队伍，插件取自 `MatchTeamManager`，不从标记 role 推断，因为本队成员可能全部不在帧里）。
  `team_id` ≠ 观看者队伍时染成敌方红色，否则白色（含无阵营观察者）。
- 物品：独立元素 `minimap-keycard-drop`，图标 + 脉冲圈：`dropped` 用 CS2 `#DroppedBomb`（110px × 0.73 ≈ 80px，2px `#880000`），
  `planted` 用 `#PlantedBomb`（70px × 0.73 ≈ 51px，2px `#D10000`）；都是 `mix-blend-mode: screen`、0.75s 线性循环、关键帧取自
  `DroppedBomb--Animate`。整体 `opacity` 为淡出值；贴边时只显示图标。
- 层级：物品在所有玩家标记之下（标记容器里第一个子元素，不设 z-index）。

## 6. 兼容与发布

三端必须一起发布：插件发 v4 时，只有声明支持 v4 的客户端会收到小地图帧（sidecar 按 `session.open` 过滤）。旧客户端会显示"地图版本不兼容"，不会解析出错。回滚 = 三端一起回退到 v3 的提交。
