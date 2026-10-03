# 小地图设计

2026-09-11 实机效果与配置增量的设计见 `research/radar-settings-plan.md`，用户已明确批准实施并要求移除地图内部中文名称；本轮不交付正式设置页面。该增量将形状/大小改为偏好驱动，替代下文首轮固定圆框规则。SVG 接入保持，逐房间中文标签布局移除，下面标签修复章节仅为历史记录；底部当前位置提示继续按已审阅实机方案实现。

本设计已完成技术研究，用户于 2026-09-07 授权开始实现。协议证据与完整错误矩阵见 `research/protocol-and-state.md`，生成器、坐标、资产和探测结果见 `research/generator-and-rendering.md`；客户端验证和生产联调结论分别记录。

## 模块与数据流

地图生成器封装为纯 `MapResolver`：输入固定版本的 init，输出房间、区域、连通性和世界坐标 transform。完整生成结果缓存后只选取 `Entrance` 与 `HeavyContainment` 作为显示几何，不随位置帧重复生成。渲染层只消费 resolver 输出和 parser 已校验的 marker。positions 是完整帧，缺失 marker 必须从 store 移除。

```text
minimap.init -> version guard -> MapResolver -> supported-zone geometry
minimap.positions (viewer + viewpoint + scoreboard + markers) -> parser/store -> radar view model
local preferences + scoreboard visibility -> radar camera
geometry + view model + camera -> hand-built React radar
```

服务端先按真实视线过滤。contracts parser 校验结构与本帧可证明的身份/队伍关系，platform 验证认证 viewer 绑定，store 检查地图/时序/房间引用；未知字段或关系违规时整帧拒绝。客户端不能证明服务端提供的 LOS 标签是否符合真实遮挡，不新增视线计算。UI 只渲染已校验的 view model。

## 消息合同

保留 `minimap.init` 和 `minimap.positions`，不新增单独的视点或计分板消息。envelope 继续使用 `protocol_version: 0`、`schema_version: 1`，仅小地图 payload 使用显式版本 2；保留 `map_schema_version: 1` 表示地图描述格式。这避免改变 HUD、商店和聊天 payload。

| 位置 | 新增/明确的字段 | 规则 |
| --- | --- | --- |
| 两类 payload | `minimap_schema_version: 2`, `map_id: string` | 每次真实地图生成分配不复用的 map_id，相同 seed 重新生成也不同。 |
| 两类 envelope | 非空 `round_id`、有效 `sent_at` | 此要求只加在小地图事件 parser；新 round 要重新 init。 |
| positions | `viewer: { player_id, team_id, is_alive }` | 稳定授权身份，不随观战对象变化；无队伍权限用 team_id=null，此时列表为空、视点为 null。 |
| positions | `viewpoint: (MinimapPose & { player_id }) \| null` | 有效视点必须为本帧中存活且 pose 一致的本人/队友；本人活着跟随本人，死亡可跟随服务端指定队友。 |
| positions | `scoreboard_visible: boolean` | 插件实际计分板 UI 是否显示，每张完整帧重述；变化时可立即发完整帧。 |
| 每个 marker | `yaw_degrees`, `zone`, `room_id` | yaw 为有限的 [0,360) 角度；zone 仅支持两个区；room_id 为生成器房间 ID 或 null。 |

`MinimapPose` 包含 `x/y/z/yaw_degrees/zone/room_id`，不从位移猜朝向。room_id 非 null 时必须对应当前地图且区域一致；无法确定房间可为 null，不能将插件原生 room ID 直接当成生成器 ID。

第一版沿用 fixture 的 SteamID64 player_id，adapter 要求 viewer.player_id 与认证 route.steamId 一致。真实插件若使用其他标识，必须在会话层先建立可信映射。self 必须是 viewer，本队其他玩家只能是 teammate，spotted 必须是敌队；重复玩家 ID、未知字段、非法有限数值、死亡 viewer 的 spotted-by-self 均拒绝。所有嵌套对象严格字段白名单，不能让额外 health/inventory/all_players 进入 UI。

完整帧原子提交 viewer、viewpoint、scoreboard 和 marker。`visibility_revision` 在授权成员/关系或 viewer 队伍变化时递增；同 revision 不允许改变授权集合，纯位置/朝向及同队观战视点变化可以复用。源身份绑定 `(server_id, instance_id, round_id, map_id)`；全流 sequence 与 revision 分别检查，不能互相替代。

legacy 或未知小地图版本只让小地图显示不兼容。旧客户端 parser 可能忽略未知字段，所以服务端必须通过会话能力协商只向支持版本 2 的客户端发送新版；没有协商时不得宣称与旧版兼容。实际协商属于后端联调，本仓先同步公开 schema、types、parser 和 mock。

## 地图生成与坐标

- 锁定生成器 commit `65c82b8f930eaef3ee30304a23c96af3a75711a3`，按研究文件记录的原始 SHA-256 保留源文件、模板和实际 LICENSE。注意 package.json 的 MIT 字段与实际 Apache-2.0 LICENSE 不一致，不能只复制旧规范的 MIT 描述。
- 在 feature 内 vendor generator/random/errors 与模板，保留声明和修改记录；仅把 atlas 的 Buffer 解码改为 atob/Uint8Array，并用 JSON 资产加载替代文件系统入口。此适配和 browser 平台 bundle 已通过 16 组完整输出等价检查；不额外引入 Buffer polyfill。
- 从生成器的实际房间坐标、旋转和 connector 数据推导显示几何。核验办公区与重收容区的世界对齐关系，不能凭区域枚举自行平移或旋转后仍将坐标当作世界坐标。
- 标签和 marker 与地图使用同一 world-to-view transform；旋转模式下标签保持正向，marker 朝向相对于地图旋转修正。
- 本地 SCP-079 图标映射标记为 `heuristic-not-authoritative`，且素材版本与地图模板版本不同。用户于 2026-09-11 明确选择采用此 SVG 资源；按显式 prefab 映射与实际变换接入，称为房间示意艺术资源，不宣称碰撞墙体一比一映射。
- 上游 connectorAdjacency 不包含 HCZ/EZ 跨区边。两个检查点半间按固定模板的同 Y/Z、相距一个 X 网格规则成对渲染；这类 `checkpoint-pair` 与上游边分开记录，不伪造通用最近邻连通关系，也不引入寻路。
- 坐标统一为世界 `(x,-z)` 投影。yaw=0 指 +Z，yaw=90 指 +X；摄像机先以视点为原点再旋转 `-viewYaw`。不用上游方向相反的 render.mapPosition 与新投影混算。
- resolver 按完整生成描述缓存；init 清旧帧并携带 request token，异步结果只有 token 和来源仍有效时可提交。加载期间最多保留当前地图的一张最新完整帧，完成时重新检查时效和 room 引用。

## 视野与视点

- 服务端授权的队伍共享集合与雷达摄像机视点是两个独立输入。本人死亡只改变跟随视点，不自动清空或缩减队友共享视野。
- viewer 和 viewpoint 采用上面的原子帧合同；不能以空间视点对象取代 viewer 的权限身份。
- 没有合法视点时固定方向拟合两个支持区域，继续显示新鲜授权 marker，同时显示等待视点状态。此回退不修改保存偏好、不使用历史死亡坐标。视点在不支持区域时同样由服务端发送 null。
- 明确视野权限已发生变更时清除旧授权集合，避免等待下一位置帧期间残留敌人。旧 sequence、跨实例和重建帧按 feature reducer 的统一边界处理。

## 雷达视图与计分板

- 左上角 300px 稳定容器、250px 圆形可视范围，取自 CS2 radar 源码。普通模式跟随当前视点和区域，初始可视半径 45 世界单位（三个 15-unit 网格）；这是可集中调整的显示参数，不进入 wire 协议。
- 计分板显示时以两区完整旋转房间轮廓的联合边界中心拟合视窗，留出 12px 内边距，不只取房间中心以免裁掉边缘。当前批准的配置增量按圆形最远半径或方形最大轴向距离拟合，允许可配置圆/方形；300px面板中心保持稳定，关闭后按最新视点恢复普通模式。
- 屏外但仍被服务端授权的 marker 显示边缘方向提示；切换区域不删除授权集合。只在接受新帧后对仍存在的同一 marker 做位置/最短角度过渡，不外推敌人；缺失、越权或过期立即移除，不等待退场动画。
- 全图切换只改变摄像机，不改变 geometry、marker 权限、保存的方向偏好或 overlay 输入模式。
- SLGO 的 `SLGO/Features/Stats/StatsKeybindHandler.cs:35` 注册可改键的计分板设置，默认 `CapsLock`；`:62` 起还会按模态窗口和比赛阶段决定是否真正打开计分板。因此生产联动应消费插件实际显示/隐藏状态，经 sidecar 的版本化上下文传入。
- 原生 `src-tauri/src/lib.rs` 已有按下/松开的键盘钩子，但目前没有计分板状态事件，也不掌握玩家的游戏内改键。它可提供非侵入式本地输入适配能力，不能仅硬编码默认键作为最终游戏状态。
- 浏览器 fixture 模拟实际显示状态，原生层提供单独的 `subscribeGameForeground`（初始未知按 false）。失焦立即抑制全图；重新聚焦后先等待当前流的 scoreboard_visible=false 帧重新武装，再接受后续 true。恢复时仍按住计分板需先松开再按，避免游戏漏收 keyup 后遗留 true 卡住。
- 现有前台跟踪器只跟踪任意前台窗口，实施中需增加窄范围的实际 SCP:SL 可执行文件/窗口辨认及 focus 通知。不得读取游戏内存，不将浏览器 blur 当成已经完成的 Windows 游戏焦点验证，不重写无关的窗口跟随行为。

## 设置与正式主界面

- 小地图接受 typed `RadarPreferences` 的11项配置（字段、默认、范围见本任务配置方案），兼容原 `orientation: "fixed" | "heading-up"` 局部输入。feature 不拥有应用导航或设置页面。
- 正式产品从主界面进入，由 `09-07-app-home-settings` 承担覆盖层启停及统一设置，该任务在小地图之后实施；不在雷达旁添加临时设置弹窗。
- 无有效偏好时回退到 fixed。本阶段由 adapter/开发 fixture 注入配置并验证两模式；正式本机存储、主界面设置与多窗口同步交给主界面任务，不为当前雷达增加配置页面。
- 计分板全图状态是短暂状态，不写入持久配置。

## 房间标签与视觉（首轮历史，下文标签布局已按用户最新要求撤销）

- 使用已覆盖两区域全部 base room name 的 `research/special-room-labels.json` 作为实现初始中文词表。它按 room.name.name 显式选取地点，不依赖生成器的 specialRoom 标志；普通走廊、转角、路口与坡道通路不标名称。未知名称记录诊断，不显示英文 prefab 名。
- 按 CS2 radar 的结构、边框、marker 和色彩手工实现 React；固定 1920x1080 基准并复用既有整体缩放规则。
- `mapoverview.xml` 的 `MapOverview__Square/MapOverview__Map/Canvas` 与 `hudradar.xml` marker package 作为 source map 证据，不能引入已废弃的 Panorama 运行时或机械生成组件。
- 仅复制使用到的资源到受维护目录，记录来源。标签采用固定优先级和碰撞处理，以两区域拟合全图为最拥挤场景验证中文可读性。
- 优先显示当前特殊房间、检查点/出口、主要收容与功能房；保持中文正向、固定字号和屏幕空间尺寸，按确定性优先级隐藏碰撞标签，避免通过缩小字体塞入所有名称。检查点两半合并标签。
- 2026-09-11 标签漂移修复：`placeRoomLabels` 仅投影固定房间中心/检查点两半世界中点作为标签中心，删除 `[12,-13,25,-26]` 屏幕偏移候选。标签边界和相互碰撞仅决定显隐，不改变坐标；marker 不再输入此函数，玩家运动不触发标签避让。renderer 明确让 marker 层位于标签层之上以保留玩家可见性。保持字形水平，不把文字本身放进随地图旋转的 group。
- 首轮没有可用的 CS2 实机雷达参考截图；2026-09-11用户已提供自定义配置的裁剪实机图和设置图。当前按该配置和参考校准视觉，不能推断原厂默认或完整屏幕绝对像素；同版本游戏资产形状与坐标仍需单独记录联调证据。

## 新鲜度与兼容

- 位置流使用注入的本地单调时钟独立计时，不能被 HUD/商店消息续期。默认阈值 `max(1000ms, 3 * 1000 / position_update_hz)`，只有有效新 positions 刷新时间；Hz 来自 init，mock 统一使用 15Hz。
- stale、非法帧、断线或撤权时清全部动态 marker 和临时全图状态，保留仍能确认适用的静态底图；不引入最后已知位置规则。重连/实例重启必须重新 baseline/init/frame。已缓存 geometry 不等于新来源已经确认地图。
- 协议、类型、parser、mock 和 schema 同步变更。真实 sidecar 的发送频率、视点/朝向及计分板状态桥接属于联调依赖，客户端 mock 通过不代表生产接通。

## 失败传播与共享模块改动

- 给 SlgoConnection 增加持续 `subscribeStatus` 和小地图专用 `subscribeDiagnostic`，沿用现有订阅清理模式。诊断只含客户端固定类别与已验证外壳的 server/instance/sequence/eventId/receipt-time，不包含 raw payload。
- 非 baseline 接收顺序为 parseEnvelope -> route 校验 -> EventSequenceGuard -> payload parser -> typed event 或安全诊断。合法外壳即使 payload 失败也占用 sequence，旧帧不能复活。过期序号仅忽略，不把健康连接永久改成 stale。
- baseline 是例外：必须先完整验证 baseline payload，再调用 guard 激活同步资格；非法 baseline 后面的 init 仍应被 baseline 门槛拒绝。
- 未知小地图版本发布局部不兼容诊断，HUD/shop 继续收合法消息；未知 envelope/schema、身份和路由错误通过持续连接状态通知处理，不能从非法外壳猜测 feature 身份。
- clientSession 在 connect 前订阅三类通知，仍用 attempt/isCurrent 防旧会话回调；App 将状态和安全诊断交给 minimap hook。清理必须取消全部订阅。旧代码只在 connect 后读一次 getStatus，不足以实现断线即时复位。
- reducer 收到当前来源的新诊断清理动态帧。非法 positions 可以被当前 map 的后续合法帧恢复；不兼容 init 清 init 资格，必须重新初始化。

## 实施边界与验收

### 2026-09-11 中文标签漂移增量

用户在 SVG 接入后反馈标签随着小地图变化漂移，继续沿用当前任务修复。根因是 `camera.ts:placeRoomLabels` 的逐帧屏幕偏移搜索与 marker 碰撞避让。改动范围仅该函数、`model.ts` 调用、必要的 marker/label 图层顺序，以及现有模型/浏览器验收脚本和文档。无需新增偏好、协议或标签布局缓存。对固定世界锚点建立跨相机轨迹回归，保留边界/标签防重叠和既有全部状态合同。

### 2026-09-11 房间 SVG 接入增量

用户已明确授权复用本任务并接入 SCP-079 房间 SVG。此前将资产仅列为候选的决定更新为实际采用：它们作为 SCP-079 房间示意艺术资源使用，保留来源中的版本/映射说明，不将图像等同于游戏碰撞墙体。现有生成器与 wire 版本保持不变。

最小缺口在 `resolver.ts` 的统一方块轮廓与 `MinimapRadar.tsx` 的多边形绘制。新增受维护的房间素材和显式映射/变换模块，resolver 输出房间图像及其世界边界，React 使用相同 camera 投影绘制 SVG。全图拟合包含实际图像范围；房间中心、朝向、玩家和中文标签继续使用既有世界坐标。素材内部颜色/透明度保留，渲染时避免将整个完整 SVG 压成单色遮罩。

修改范围限定为 `src/features/minimap/`、`public/assets/minimap/`、相关小地图测试/视觉脚本与本任务文档。此次不同时重做外圈背景、CS2 marker、文本设计、协议、权限、原生输入或其他 HUD。明确房间选择、定位、旋转和缩放公式，依据研究记录和已知 fixture 测试，避免靠截图手调修正位置。

复核补充：`.gitattributes` 对新增 SVG 和房间映射 JSON 固定 `text eol=lf`，确保 Windows 自动换行转换不会破坏来源 SHA-256 校验。两个检查点 SVG 已在共同格边界自然衔接，移除所有辅助中心线绘制，保留 `checkpoint-pair` 数据供拓扑和合并标签使用。

记录逐文件 hash；运行期和正式测试只读取随应用维护的素材。进一步细节写入 `research/room-svg-audit.md`。

最小行为缺口在五处：生成器/地图模型缺失、wire payload 没有视点上下文、连接失败未持续通知、React 雷达未挂载、原生层没有游戏焦点信号。各自只在 feature、contracts、platform/session、App 和窄范围 Rust adapter 中实现；不重构其他 feature 的领域模型。

客户端交付门槛：固定生成器回归、版本化协议/完整帧/错误传播测试、两种方向和死亡视野、计分板焦点复位、15Hz mock 持续流、1920x1080及较小16:9截图、现有 npm/Rust 检查。

生产接通门槛另行记录：真实身份和 room 映射、sidecar 能力协商、LOS 过滤、map/round 生命周期、实际计分板 UI 状态、Windows 游戏窗口辨认、同版本地图资产及更新延迟。闭源插件与 sidecar 实现不在本仓范围，不以 mock 通过代替这些验证。
