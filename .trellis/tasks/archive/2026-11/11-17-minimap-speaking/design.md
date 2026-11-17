# Design：雷达说话喇叭

依据：PRD「CS2 依据」与「用户决定」；CS2 逆向见 `archive/2026-11/11-17-minimap-cs2-slui/research/cs2-radar-client-re.md`
"Speaking icons"；SL 语音路径见 `research/sl-voice-speaking.md`。

## 1. 协议：minimap v8（`@slgo/protocol`）

v8 = v6 加上每个标记的 `speaking`，没有其他变化。`minimap.init` 只把版本号改成 8。

| 版本 | 谁发送 | 内容 |
| --- | --- | --- |
| 6 | 旧插件的比赛服务器；sidecar 降级给旧客户端（见 §3） | 不变 |
| 7 | demo 回放服务器 | 不变（回放不画喇叭，和 CS2 GOTV 一致） |
| 8 | 新插件的比赛服务器 | v6 + `positions[].speaking` |

- `MINIMAP_SPEAKING_SCHEMA_VERSION = 8`，`MINIMAP_SCHEMA_VERSIONS = [6, 7, 8]`，`MinimapSchemaVersion` 随之扩展。
  `MINIMAP_SCHEMA_VERSION`（6）保留原义「比赛服务器的基础版本」，客户端在 `session.open` 中声明全部三个版本。
- 解析器 `parseMinimapPositions`：
  - v8 的每个标记都必须带布尔值 `speaking`；v6 / v7 出现 `speaking` 视为未知键，整帧 `invalid-payload`
    （按版本选择允许的键集合）。
  - `speaking: true` 只允许出现在 `visibility === "teammate"` 且 `status === "live"` 的标记上；其他情况整帧
    `invalid-payload`。这把 CS2 规则写进契约：自己、敌人、被观察者、死亡 X 和幽灵都不会显示，无阵营观察者也不会（他只收到 observed 标记）。
  - 自由视角仍然只允许 v7，`replayedSelf` 规则不变。
- 类型：`MinimapPosition` 增加 `speaking?: boolean`（只有 v8 有）。
- `visibility_revision`：`speaking` **不**属于授权集合，说话开始或停止不需要新的 revision。README 中 revision 的列举保持不变，
  并补一句明确排除它。
- 文档：`v0/README.md` 新增「Speaking (v8)」一节，写清口径（服务器真实把该队友的语音发给了这个观看者，0.2 s 保持，
  只针对活着的队友），握手一节改为「match servers send 8 (6 from older plugins), a demo replay server 7」，并说明 sidecar
  的降级规则；`minimap-positions.schema.json` 增加 v8 分支，并新增 v8 示例。

## 2. 插件（SLGO）

### 2.1 收听记录 `MinimapVoiceTracker`（`Features/Sidecar/Minimap/`）

- 订阅游戏静态事件 `VoiceChat.Networking.VoiceTransceiver.OnVoiceMessageReceiving(VoiceMessage msg, ReferenceHub receiver)`。
  它在所有 `ReceivingVoiceMessage` 处理（SLGO 队伍路由、观察者静音、热身桥接）之后、`Send` 之前触发，而且只针对真正发出的语音包。
  这正好对应 CS2 的「服务器允许你听到 + 你正在收到」。由 `SidecarMinimapPublisher.Initialize/Shutdown` 幂等地订阅和退订
  （和它订阅 `SeedSynchronizer` 的方式相同）。
- 处理函数（主线程、高频）：说话者或接收者为空时跳过；说话者 `IVoiceRole.VoiceModule.CurrentChannel == Mimicry` 时跳过
  （939 模仿不算，用户决定）。其余情况记录 `last[(receiver.PlayerId, speaker.PlayerId)] = nowMs`，键为
  `((long)receiver << 32) | (uint)speaker`，用 `Dictionary<long, long>`。不在热路径上解析 SteamID，不分配内存，不写日志；
  异常吞掉，按节流记一次日志，不让异常逃出 Mirror 处理函数。
- 频道：近距离、对讲机、SCP 频道、079 摄像头广播（Proximity）、Intercom，以及插件桥接后的 RoundSummary 都会走到这里，
  全部计入；观察者频道和 SCP-1576 的发送者已死亡，由 §2.2 的活人条件排除。
- 时钟：使用发布器已有的 `clock`（`Stopwatch` 毫秒）。`IsHearing(receiverId, speakerId, nowMs)` =
  `nowMs - last <= SidecarConstants.MINIMAP_SPEAKING_HOLD_MS`（200，对应 CS2 `0x180b32c10` 的 0.2 s）。
  每个 15 Hz tick 修剪超过保持时间的条目，字典大小只和「正在说话的人数 × 收听者数」有关。`Shutdown` 时清空。

### 2.2 组帧

- `MinimapPlayerState` 增加 `int PlayerId`（采集器已经持有 `ReferenceHub`）。
- `BuildFrame` 增加参数 `Func<int, int, bool> isHearing`（接收者、说话者），由发布器传入 `tracker.IsHearing(…, nowMs)`。
  `AddOwnTeam` 为 `teammate` 实时标记计算 `speaking = isHearing(viewer.PlayerId, member.PlayerId)`；`self`、死亡标记、
  observed 和发现的敌人一律为 false。观看者已死但仍有阵营时同样计算（CS2 里本地玩家死后仍然在 T/CT 队）。无阵营观看者
  不会走 `AddOwnTeam`，所以自然没有喇叭。
- `MinimapPosition` 增加 `bool Speaking`；`MinimapPositionsPayload` 只在版本为 8 时写出 `speaking`（放在 `has_commander_keycard`
  之后）。v7 回放帧不写这个字段。
- `SidecarConstants.MINIMAP_SCHEMA_VERSION = 8`；init 和 positions 默认都使用它；回放仍然使用 `MINIMAP_SCHEMA_VERSION_REPLAY = 7`。
- `Validate` 接受 8 和 7，并镜像协议规则：`speaking` 只能出现在活着的 teammate 上，v7 的标记不能说话。
- `Signature` **不**加入 `Speaking`，注释写明原因（「说话不是授权」，和 SLUI `authorizationKey` 保持同构）。

### 2.3 测试

- 纯规则：保持时间边界（199 / 200 / 201 ms）、Mimicry 跳过、键的组合和修剪。
- `BuildFrame`：队友说话时为 true；自己、敌人、observed 和死亡标记都为 false；死亡但有阵营的观看者能看到；无阵营观看者看不到；
  说话变化不改变 revision。
- `Validate`：v8 的非法说话标记被拒绝，v7 不能有说话标记。
- IPC 夹具：`publish-minimap-positions.example.json` 升到 v8，带一个说话中的队友；新增或更新 invalid 夹具。
- 模块 `CLAUDE.md`（Sidecar/Minimap，并在 Voice 中加一句「雷达说话读取 OnVoiceMessageReceiving」）。

## 3. backend（slgo-backend sidecar）

- 校验直接复用 `@slgo/protocol`（工作区链接到 slui 的 `packages/protocol`），所以 v8 能自动通过。`hub.publish` 没有按版本
  设置 capability 门槛（v7 的约束全部在解析器里），所以 v8 也不加门槛。
- **降级**：新增 `forClient(link, event)`。客户端声明了该事件的版本时原样发送；事件为 v8、客户端没有 8 但有 6 时，发送副本：
  版本改成 6，positions 去掉每个标记的 `speaking`（init 只改版本号）；其他情况不发送。`deliver` 和连接后的快照重放
  （现在 `accepts` 的两处调用点）都改走它。这样一来，旧 SLUI 在新插件的服务器上仍然能看到 v6 小地图，只是没有喇叭；
  不需要等所有玩家更新。
- 夹具：`protocol/ipc/v1/publish-minimap-init.example.json` 与 `publish-minimap-positions*.example.json` 升到 v8（观察者示例里的
  标记都是 `speaking: false`）；新增 invalid：说话标记在敌人或自己身上、v6 标记带 `speaking`。
- `protocol/ipc/README.md`：事件表中把版本改成「v8（旧插件 v6；回放 v7）」，并写明降级规则。
- dev 工具：`dev-client-core` 的摘要中显示说话人数（可选）；`fake-replay-hud` 保持 v7。
- 测试：hub 降级（只声明 [6, 7] 的客户端收到不带 `speaking` 的 v6；声明了 8 的收到原样 v8；只声明 [7] 的什么也收不到）、
  缓存重放走同一路径；`bun test`。

## 4. SLUI

### 4.1 版本与模型

- `connection.ts` 声明 `[6, 7, 8]`（来自 `MINIMAP_SCHEMA_VERSIONS`）；`resolver.ts` 接受 8。
- `model.ts`：`RadarMarker` 增加 `speaking: boolean`（`position.speaking === true`；插值时取较新那一帧的值，不插值）。
  `authorizationKey` 不加入它，注释写明原因。CS2 不做淡入淡出，标志变了就立即显示或隐藏。
- 过期、断线或无效帧清空动态标记，喇叭随之消失（现有规则）。

### 4.2 绘制（`MinimapRadar.tsx` / `.css`）

CS2 `#PI_FirstRotated` 子元素的顺序是 ViewFrustrum → Speaking → …… → 点 / 边缘箭头 → Selected。SLUI 在
`minimap-marker__direction` 里，把喇叭放在视角扇区之后、点和箭头之前。

| 状态 | 元素 | 尺寸 / 位置 | 旋转 |
| --- | --- | --- | --- |
| 在范围内 | `speaking-onmap.svg` | 18×18，居中（`left/top -9px`） | 跟随 `marker.yaw` |
| 在边缘 | `speaking-offmap.svg` | 26×24，居中，y −3px（`left -13px; top -15px`），压在 22px 边缘箭头下 | 跟随 `marker.edgeAngle` |

- 两者都在 `.minimap-marker` 里，所以都会受 `--radar-icon-scale` 影响（CS2 把整组 PlayerIcons 一起缩放）。
- 颜色：`RadarFilters` 增加一个 `speaking` wash 滤镜（与其他 wash 一样做 sRGB 乘法），颜色为 `#78ff00`。
  CSS 写 `filter: url(#…-speaking)`，并覆盖掉 `.minimap-marker img` 继承来的 `--marker-filter`。
- 素材：由 SLUI 自己绘制（和其他雷达图标一样，不打包 CS2 文件），几何从 `pak01` 中的 `map_speaking_*.vsvg_c` 内嵌源 SVG 量取，
  源文件只放在本地 `D:/Temp/slui-speaking`，不进仓库：
  - onmap（27.885 见方的画布）：一个圆环，圆心 (14.012, 14.080)，外半径 ≈13.43，内半径 ≈11.43；喇叭是多边形
    `8.322,17.154 8.322,11.006 11.771,11.006 17.027,6.319 17.027,21.842 11.77,17.154`。画成 18px 时，圆环正好套在
    11px 的点外面（直径 ≈17.3px，宽 ≈1.3px），喇叭大部分会被点盖住，这和 CS2 一致。
  - offmap（66×56.115 的画布）：朝上的三角形描边，外侧顶点 (33.245, 0.919)、(0.669, 55.196)、(65.821, 55.196)，内侧
    (33.245, 8.241)、(7.325, 51.429)、(59.166, 51.429)；喇叭多边形
    `25.247,40.304 25.247,31.513 30.178,31.513 37.696,24.81 37.696,47.007 30.177,40.304`。
  - 填充色保留源图的 `#68ac4b`，再叠加 `#78ff00` 的乘法 wash，得到约 `#31ac00`。这里假设 Panorama 的 `wash-color` 是乘法，
    SLUI 现有所有 wash 都按这个理解实现；源图本身不是白色，所以这次的结果是可以看出差别的。用户本地的 CS2 录像是机器人对局，
    没有语音，无法核对，所以列为视觉评审项：如果用户记得 CS2 里是亮绿色 `#78ff00`，只需把源图填充色改成白色。
- `SOURCE-MAP.md` 增加一行；`PlayerMarker` 增加 `data-speaking`，供审计脚本和测试使用。

### 4.3 mock 与审计

- mock provider：一名队友按 1.5 s 说、1.5 s 停的节奏切换 `speaking`，并让一名在雷达边缘的队友也在说话。审计场景固定为说话状态。
- `scripts/minimap-visual-audit.mjs`：增加范围内和边缘说话的截图；`minimap-model-smoke` 验证 `speaking` 不影响 authorization、
  会透传到 `RadarMarker`；`minimap-contract-smoke` 覆盖 v8 的合法和非法情况，以及 v6 / v7 不能带这个字段；
  `backend-connection-smoke` 期望 `[6, 7, 8]`。

## 5. 兼容、部署顺序与回滚

| 组合 | 结果 |
| --- | --- |
| 新 SLUI + 旧 backend / 插件 | 收到 v6，没有喇叭，其他不变 |
| 旧 SLUI + 新 backend + 新插件 | sidecar 降级为 v6，没有喇叭，其他不变 |
| 新插件 + **旧** backend | 旧 sidecar 拒收 v8，**小地图整体消失** |

- 所以部署顺序固定为：backend（sidecar）→ 插件。SLUI 的发版时间不受限制。这条写进 PR 描述和交接记录
  （插件和 backend 目前都只合入本地 main、尚未部署，部署的人需要知道）。
- 回滚：只回滚插件即可回到 v6，backend 和 SLUI 都能兼容 v6。backend 不能先于插件回滚。

## 6. 风险

- 颜色（乘法 wash 还是纯色），见 §4.2，靠视觉评审决定。
- `OnVoiceMessageReceiving` 是游戏程序集的静态事件，不属于 EXILED 契约，游戏升级后需要重新反编译确认它的触发位置
  （写进 Voice / Minimap 模块的 `CLAUDE.md`）。
- 客户端本地静音（SL 设置里屏蔽某个玩家）服务器无从得知：被你本地静音的队友说话时，喇叭仍然会亮。CS2 本地静音会影响
  `UpdateSpeakerStatus`，所以这一点和 CS2 不同，属于已知差异。
