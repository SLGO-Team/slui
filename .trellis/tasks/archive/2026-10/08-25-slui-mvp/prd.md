# SLUI MVP 客户端核心功能

## Goal

在 Windows/Tauri 客户端中交付一个只服务 SLGO 的可用 MVP，让玩家在游戏内获得可信的回合状态、商店、聊天和受权限约束的小地图能力，并将整个前端按指定 CS2UI 源码的结构、样式和交互语义重写。客户端通过中心控制面找到玩家当前所在的 SLGO 游戏实例，再通过同机 sidecar 获取低延迟实时数据；后端实现仍属于另一个闭源项目，本任务只负责客户端、可审计的协议契约和 mock 数据链路。

最终应用以正式主界面作为启动入口，提供覆盖层启停和统一设置；该子任务在小地图之后实施。

## Confirmed Facts

- 当前仓库是 Tauri 2 + React 19 + TypeScript/Vite 客户端，现有 `App.tsx` 仍是演示用单体 overlay。
- 当前仓库未内置 CS2UI 源码；现有前端主要保留基础链路、数据模型和一个顶部 HUD POC。
- CS2UI 基准源码已提供于 `../cs2ui/panorama`，包含 Panorama XML 布局、CSS 样式和图片/SVG 资源；相关布局包括 `layout/hud/hudteamcounter.xml`、`layout/hud/hudchat.xml`、`layout/buymenu.xml` 和 `layout/mapoverview.xml`。
- SLGO Backend 为闭源系统，分为中心控制面和与游戏服务器同机的 sidecar；高频 match、shop、chat 和 minimap 数据走 sidecar。
- v0 协议已固定 `server_id + instance_id + round_id + sequence` 隔离模型、`team-a/team-b` 稳定比分身份，以及新实例必须先 baseline 的规则。
- 首版小地图基线为 SCP:SL `14.2.7` 与锁定的 `@scpsl-tools/map-seed@1.0.0`；位置帧在到达 React 前必须已经按玩家视野过滤。
- 所有 feature 必须通过 typed contract、platform adapter 和 mock provider 工作，React 组件不能直接调用 Tauri、WebSocket 或原始 JSON。

## Requirements

1. **身份与路由**
   - Steam 客户端必须运行并能读取当前登录 SteamID；SteamID 读取只用于发现/展示。
   - 未完成可验证 Steam proof 或 SLGO 一次性游戏内配对前，不得授权小地图位置、聊天发送或商店命令。
   - 客户端向中心控制面请求 `server_id`、`instance_id`、sidecar endpoint 和短期 session token；高频数据不经过中心控制面。
   - 同一 sidecar 可承载多个 SLGO 实例，所有事件按 `server_id + instance_id` 隔离。

2. **统一协议**
   - 使用 `protocol/v0` 的版本化 envelope、序列号和 payload 契约。
   - 稳定比分身份使用 `team-a/team-b`，当前 NTF/SCP 仅作为本回合角色展示；不得把双方写死为固定阵营。
   - 未知 schema、旧 sequence、错误 instance、过期 route、断线和 stale 数据都必须有显式 UI 状态。

3. **首版功能**
- 顶部回合状态：回合阶段、回合计时、比分、双方人数、双方玩家头像、本方服务端授权的血量/护盾/经济/装备摘要。
   - 商店：展示 SLGO 插件权威库存/余额/购买结果，购买操作带 command id、pending、成功和失败状态。
   - 聊天：遵循 SLGO 插件定义的聊天范围，支持历史、实时消息、发送结果和断线状态。
   - 小地图：根据服务端提供的 SCP:SL 14.2.7 地图 seed/descriptor 生成真实地图；只渲染服务端已按玩家视野过滤的 marker，不接收或隐藏全量玩家数据。
   - 主界面与设置：应用启动进入正式主界面，提供覆盖层启停和统一设置入口，保存并应用小地图方向偏好；独立子任务在小地图之后实施。
   - 保留被动 click-through；interactive 模式不由玩家手动切换，而是在商店 / 聊天框等界面打开时自动进入、关闭后自动退出（2026-09-26 修订），不能因网络状态改变输入行为。

4. **工程边界**
   - React 组件不得直接调用 Tauri、WebSocket 或解析原始协议；通过 `src/contracts`、`src/platform` 和 feature adapter 访问数据。
   - 不支持其他游戏、其他插件的通用协议，不实现后端服务，不读取游戏进程内存或注入进程。
   - 所有功能必须能接入 mock provider 运行，便于后端尚未就绪时并行开发。

5. **CS2UI 视觉重写**
   - CS2UI 源码/资源/目标版本是唯一视觉基准；React/Tauri 实现应按其布局层级、状态变体、字体、颜色、尺寸、动效、输入行为和资源裁切还原，不以当前 POC 的 CSS 作为设计依据。
   - HUD、商店、聊天、小地图及 overlay shell 均纳入重写范围；协议、权限、实例隔离和 mock provider 的行为契约保持不变。
   - 视觉验收必须覆盖至少桌面默认分辨率、窄窗口和 live/buy/spectator/stale 等状态，并以源码或对应基准截图逐项比对。

   视觉基准映射固定为：
   - overlay shell：`layout/hud/hud.xml` 的全屏层级、hit-test 和 bottom/top 区域语义，以及 `styles/csgostyles.css` 的公共 token。
   - HUD：`layout/hud/hudteamcounter.xml`、`layout/hud/hud.xml`，配套 `styles/hud/hudteamcounter.css`、`styles/hud/hud.css` 和 `images/hud/teamcounter/*`。
   - 商店：`layout/buymenu.xml`，配套 `styles/buymenu.css`、`styles/weaponstyles.css` 和 `images/icons/equipment/*`。
   - 聊天：`layout/hud/hudchat.xml` 与 `layout/chat.xml`，配套 `styles/hud/hudchat.css`、`styles/chat.css`。
   - 小地图：`layout/mapoverview.xml`、`layout/hud/hudradar.xml`，配套 `styles/mapoverview.css`、`styles/hud/hudradar.css` 和 `images/hud/radar/*`。

## Acceptance Criteria

- [x] `npm run build` 通过，Windows Tauri overlay 可启动；浏览器预览可用 mock provider 展示完整 MVP。
- [x] Steam 未运行、SteamID 变更、无 route、route 过期和未配对时，客户端显示对应状态且不打开未授权数据流。
- [x] 两个实例共用一个 sidecar 的事件不会互相覆盖；实例重启需要新的 baseline，旧 sequence 被丢弃。
- [x] 顶部 HUD 能由 match snapshot 驱动并正确处理 `Idle/WaitingForPlayers/PreRoundWait/BuyPhase/ActionPhase/RoundEnd/MatchEnd`。
- [x] 商店和聊天命令只发送到 sidecar/插件，重复 command id 不造成重复应用，拒绝/断线状态可恢复。
- [x] 小地图固定 seed 回归结果稳定；不支持的 generator/template/coordinate 版本不会渲染地图；未授权 marker 在进入 React 前被拒绝。
- [x] 被动模式保持 click-through，interactive 模式只在商店等界面打开时生效、关闭后恢复点击穿透，二者与连接状态解耦。
- [x] 正常启动先显示主界面，覆盖层可明确启停；小地图方向设置在主界面修改后正确应用并在重启后保持。
- [x] 单元、协议 fixture、可见性边界、路由多实例和 Windows smoke 检查均有记录，失败项不能被静默吞掉。
- [x] 提供的 CS2UI 源码/资源在仓库中可追溯；每个纳入范围的界面都有对应的结构/样式映射和基准截图，关键状态与目标实现的视觉差异在验收记录中为零或有明确豁免。

## Out of Scope

- 闭源中心服务器、sidecar 或 SLGO 插件的实现与部署。
- 未提供的 CS2UI 页面、资源或交互变体；无法从基准源码/截图验证的“猜测式”视觉扩展。
- 通用多游戏/多后端 SDK、管理员面板、跨机器低延迟优化。
- 在没有 AppID/服务端密钥时伪造 Steam 官方认证；生产 proof 方案在身份子任务中以可替换接口落地。

## Deferred Technical Items

以下事项需要后端或运营环境确认，但不阻塞本 MVP 的 mock 链路和客户端边界：

- 生产身份 proof 采用 Steam session ticket、OpenID 还是 SLGO 一次性设备配对。
- sidecar 如何注册并隔离同一主机上的多个 `server_id/instance_id`，以及 control plane 如何选择 endpoint。
- sidecar 最终的小地图坐标和更新频率契约。
- CS2UI 源码路径已确认；其上游提交、授权方式和 Panorama 内部运行时不可直接移植的行为继续作为实现记录项，不改变本 MVP 的页面范围。
- HUD 服务端时间插值：当前 envelope 有 `sent_at`，但 `MatchSnapshot` selector 尚未携带并本地 tick；在不改变 v0 payload 的前提下补齐这一跨层数据流。

## Child Tasks

- `08-25-client-foundation`: 协议、数据源、控制面路由、SteamID/配对边界、mock 基础设施。
- `08-25-round-hud`: 顶部回合状态 HUD。
- `08-25-shop`: 插件权威商店 UI 与命令状态。
- `08-25-chat`: 插件聊天 UI 与命令状态。
- `08-25-minimap`: seed 地图生成、可见性过滤 marker 与实时渲染。
- `09-07-app-home-settings`: 正式启动主界面、覆盖层启停与统一设置，在小地图之后实施。

## Related Planning Requests

- 2026-09-07 用户批准创建 `09-07-app-home-settings`，并确认先实现小地图。应用最终启动时先进入主界面，而不是直接进入覆盖层。
- 正式设置入口应承载小地图的固定方向/跟随朝向偏好；小地图任务先提供配置接口，不在雷达旁增加临时设置弹窗。主界面任务需规划覆盖层生命周期及设置与覆盖层同步，不能将调试入口视为正式设置完成。
- 小地图最新的两区域范围、中文特殊房间标签、死亡队伍共享视野与计分板缩放要求以 `../08-25-minimap/prd.md` 为准。
