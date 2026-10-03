# 小地图包点 A/B 显示

## Goal

在 SLUI 小地图上标出包点（SLGO 的发电机位置），照 CS2 雷达的 `BombZoneA/B` 图层显示 A、B 字母，方便玩家在雷达上判断进攻/回防方向。来源：用户 2026-10-02 请求。

## Background（已核实）

- CS2 的包点字母不是只烘焙在底图上：`cs2ui/panorama/layout/hud/hudradar.xml:85-86` 有独立的 `BombZoneA/B` 图片（`icon-bomb-zone-a/b_png`，24×38 白色粗体字母），样式见 `hudradar.css:788-803`：高为雷达面板的 6%、`wash-color: #ffcc00`、`opacity: .7`、`img-shadow: 0 0 1px 2 #111`；另有 `.BombZone_OnMap`（高 4%、`opacity: .4`）。
- CS:GO `sfhudradar.cpp` `PlaceGoalIcons`：每个包点一个世界坐标（包点中心）；圆形雷达下超出半径时贴边；图标不随雷达旋转（始终正立）。
- SLGO 插件：发电机房间由 `Config.GeneratorRoomTypes` 配置（默认 `Hcz939, HczNuke`，数量可变）；位置 = 房间位姿 + `GeneratorConstants.RoomPlacements` 偏移（`SLGO/Features/Generators/GeneratorManager.cs:89-103`）。插件里目前没有 A/B 概念；现有匹配 `rooms.Where(...).Take(n)`（`GeneratorManager.cs:63`）按 `Room.List` 顺序而不是配置顺序。
- 发电机在 `BuyPhase` 进入时才生成（`RoundFlowCoordinator.cs:63`），与新 `round_id` 的 `minimap.init` 同一时刻，存在先后竞争；热身阶段没有发电机。
- 当前 `minimap.init`（schema v4）没有任何包点字段。

## Requirements

### R1 数据来源（用户 2026-10-02 决定：插件下发）
- 包点的位置和字母由 SLGO 插件权威给出，经 slgo-backend 转发，slui 只校验和渲染，不在客户端硬编码房间或偏移。
- 包点位置与插件实际放发电机的位置是同一个计算结果（单一来源），改配置后雷达自动跟随。

### R2 字母分配（用户 2026-10-02 决定：按配置顺序）
- `GeneratorRoomTypes` 第 1 项为 A、第 2 项为 B，更多依次为 C、D…；与房间在 `Room.List` 中的顺序无关。
- 某项房间在本图找不到时，该字母不出现，后面的字母不顺移。

### R3 显示（照 CS2）
- 每个包点在其中心显示对应字母：黄色 `#ffcc00` 染色、黑色描边，A/B 使用 CS2 原图标，C 及以后用同风格字母。
- 字母始终正立，不随 heading-up 雷达旋转。
- 圆形与方形雷达下，超出可视范围的包点贴边显示（复用玩家标记的边缘投影）。
- 两档样式（用户 2026-10-02 采纳建议，依据 CS2 `.BombZone` / `.BombZone_OnMap` 命名推断）：贴边时高为雷达面板 6%（18px）、不透明度 0.7；在雷达范围内时 4%（12px）、0.4。
- 热身阶段（尚未生成发电机）也显示包点：包点是地图 + 配置决定的静态信息，同 CS2 热身时也显示包点。
- 全图模式下显示在包点位置。
- 包点画在所有玩家标记和指挥官卡之下、房间底图之上。
- 包点是静态地图信息：positions 过期、无效或断线清空动态标记时，包点随底图保留；地图重建 / 新 `map_id` 时随新 init 替换。

### R4 协议
- 字段变更需要 minimap payload 版本递增，旧客户端不会收到无法解析的事件。
- 包点房间必须属于所在区域且在支持的区域内（Entrance / HCZ）；字母唯一。

## Acceptance Criteria

- [x] `@slgo/protocol` minimap payload v5：`minimap.init` 含包点列表的合法示例通过；非法输入被拒绝（字母重复/非法、坐标非有限、区域不支持、未知字段、类型错误）。
- [x] SLGO 插件：包点由与发电机生成共用的解析结果给出；配置顺序决定字母；缺失房间跳过且不顺移；发送前自检与 v5 解析器等价；单测覆盖。
- [x] slgo-backend：IPC v1 minimap 夹具升级到 v5，契约测试通过。
- [x] slui 渲染（浏览器验证）：A/B 字母在正确位置、黄色描边、heading-up 下保持正立、超出范围贴边且切换为 18px/0.7（范围内 12px/0.4）、全图模式可见、在玩家标记之下；positions 过期后包点仍在；mock 预览可见。
- [x] 各仓库现有测试 / smoke 全绿；spec 与 `SOURCE-MAP.md` 更新。

## Out of Scope

- 包点区域（范围/轮廓）高亮，只标中心点。
- 聊天轮盘、位置标题等其他地方的包点名称。
- 上下层（above / below）指示。

## Verification

- 离线：各仓库测试 / lint / 构建通过（slui npm test + 视觉审计；backend bun test 295；插件 dotnet test 1084）。
- 实机：用户 2026-10-02 真服配合 SLUI 测试通过。
