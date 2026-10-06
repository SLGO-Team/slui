# CS2 HUD 面板：回合结算、MVP、中下部提醒、拆弹卡片

## Goal

SLUI 按 CS2 原样渲染插件已准备好的 HUD 内容，并接管插件对应的 Hint：回合/比赛结算卡片（含 MVP）、屏幕中下部各种提醒、拆弹（发电机启动/关闭）进度卡片。来源：用户 2026-10-05 请求；插件侧已在 2026-10-04 的 UI 统一任务中为此重构。

## Background（已核实）

- 插件（`../SLGO`）语义层契约 `.trellis/spec/plugin/hud-semantic-model.md`：
  - `HudMessageBoard`：每玩家 4 个槽位，自上而下 `Progress`（= CS2 `CSGOHudProgressBar`）、`Alert`（`CSGOHudAlerts` 比赛流程播报）、`HintHigh`（红条警告）、`HintLow`（一般提示）。4 槽同时可见、同槽单条替换；`HintHigh` 3 s、`HintLow` 6 s，`Progress` / `Alert` 常驻直到来源清除；Alert 分层 `Pause > StartVote > MatchFlow`。消息 = 键（CS2 本地化键或 `SLGO_*`）+ 参数 + 语调 `HudTone` + 时长/截止时间；倒计时以 `{time_remaining}` + 截止时间表达；每次写入递增 `Sequence`（倒计时逐秒重写也递增）。
  - `RoundResultModel`：获胜阵营（`ntf`/`scp`/null=平局）、结束原因键、MVP（玩家、获选标签键与参数、音乐盒名）、是否比赛结算。标题与语调观看者相对，规则在 `HudMessageRules.ResultTitleFor`。回合必有胜方，平局只出现在比赛结算（`RoundResultModelBuilder.ForMatch`）。面板停留时长为插件常量 `UIConstants.RoundResultAnim.HoldDuration`。
  - 发电机进度 = `HudMessages.GeneratorProgress`（`Progress` 槽，`SLGO_Progress_Generator_Start` / `_Shutdown`，参数为剩余/总毫秒）。
  - 接管功能名已在插件预留：`hud-messages`（4 槽整体）、`win-panel`、`hud-money`（`HudTakeoverRules` + `SidecarConstants` 别名）；SLUI 声明后对应 Hint 设 `Hide`，语义状态照常推进。
- 插件**尚未**经 IPC 发布 HUD 消息或回合结果：slgo-backend `protocol/ipc/v1`、sidecar `PUBLISH_EVENT_TYPES` 与 slui `@slgo/protocol` v0 都没有对应事件。sidecar 用 `@slgo/protocol` 的 `parseEvent` 校验插件 publish，所以新事件必须先进 `@slgo/protocol`。本任务因此覆盖插件发布 → backend IPC 契约与 sidecar 转发 → slui 协议解析 → 渲染的完整链路（同 `10-02-minimap-bombsites` 的跨仓库模式）。
- 先例：`chat.notice` 由插件下发已解析的中文文本分段 + 语义色调，SLUI 不持有文案目录。时间一律以"发送时剩余毫秒 + 本机接收时间插值"表达，禁止比较服务器与本机时钟（`10-03-clock-skew-stale`）。
- 视觉依据：1920x1080 CS2 实机截图（用户 2026-10-05 用本地离线服脚本采集，仅本地留存），文字结论见 `research/cs2-reference-capture.md`；CS2 Panorama 源（`../cs2ui/panorama`）只作测量参考（`.trellis/spec/frontend/cs2-visual-replication.md`）。

## Task Map

| 子任务 | 交付 | 依赖 |
|---|---|---|
| `10-05-hud-data-channel` | `@slgo/protocol` 新事件 + 夹具；backend IPC v1 契约与 sidecar 转发/缓存；插件发布器；`hud-messages` / `win-panel` 功能名进入 `@slgo/protocol` | — |
| `10-05-win-panel` | 回合/比赛结算卡片 + MVP 区；声明 `win-panel` | data-channel |
| `10-05-hud-alerts` | 中下部比赛播报 + 高/低优先级提示 | data-channel |
| `10-05-hud-progress` | 发电机启动/关闭进度卡片 | data-channel |

`hud-messages` 一次接管全部 4 个槽位，所以 SLUI 只有在 `hud-alerts` 与 `hud-progress` 都完成后才声明它（由后完成的那个子任务加入声明）。

## Requirements

### R1 文案来源（用户 2026-10-05 决定：插件下发已解析文本）
- 插件 `HudMessageCatalog` 是唯一文案来源：插件把参数（物品、阵营、玩家名、击杀数等）代入模板后下发纯文本，同时附带消息键与语调，供 SLUI 选样式。
- 倒计时 `{time_remaining}` 不代入，原样保留占位符并附剩余时间，由 SLUI 本地逐秒绘制 `m:ss`。
- 结算标题（观看者相对）同样由插件按观看者阵营算好下发，SLUI 不复刻 `ResultTitleFor`。
- SLUI 不持有键→模板目录、不做多语言；插件新增提示不需要 SLUI 发版即可正确显示。

### R2 阵营配色（用户 2026-10-05 决定：用 SLGO 阵营色）
- CS2 中随阵营变化的颜色（结算标题、边条、箭头、底色、MVP 标签、格子背景等）一律换成 SLGO 阵营色：NTF `rgb(150, 200, 250)`、SCP `#d94652`（`src/shared/roleColors.ts` 的 `ROLE_COLORS`，与聊天、商店同源），不使用 CS2 的 T 金 / CT 蓝。
- 观看者所在队伍输掉时，标题、边条、箭头按 CS2 改为失败红（`negativeColor` `#DB4437`）、底色转中性深灰（实机截图核实）。
- SCP 阵营色 `#d94652` 与失败红 `#DB4437` 几乎相同（用户 2026-10-05 决定：照 CS2 规则，不做特殊处理）：SCP 胜利与败北靠标题文字、底色（胜利带阵营色调 + MVP 条与格子背景，败北中性深灰、无 MVP 条）区分。
- 平局与观察者视角无截图：平局用中性配色；观察者标题着胜方阵营色。

### R3 发电机进度卡片（用户 2026-10-05 决定：启动与关闭都显示）
- CS2 安包无进度卡片、只有拆弹有（实机截图核实）；SLGO 的启动发电机（≈ 安包）与关闭发电机（≈ 拆弹）**都**显示 CS2 拆弹卡片版式，只换图标与文字（文字来自插件：「你正在启动发电机。」/「你正在关闭发电机。」）。
- 理由：SCP:SL 没有安包手部动画，SLUI 接管 `hud-messages` 后插件 Hint 隐藏，没有卡片就没有任何进度反馈。

### R4 结算面板副标题行（用户 2026-10-05 决定：本任务沿用结束原因）
- CS2 在标题下显示每回合变化的趣味数据（实机截图核实）；插件目前在同一位置放结束原因（规范注明为占位）。
- 本任务 SLUI 原样显示插件下发的这一行文本，不做趣味数据；插件日后实现趣味数据时 SLUI 无需改动。趣味数据已另立后续任务（插件仓库）。

### R5 接管与兼容
- SLUI 只在对应渲染器就绪后声明 `win-panel` / `hud-messages`；断开或关闭覆盖层即撤销，插件 Hint 原样恢复（既有 `client.features` 机制）。
- 新事件对旧客户端无害（未知事件类型跳过）；新 SLUI 遇旧插件/旧 sidecar 时不声明的事件不会到达，界面上不显示这些面板，插件 Hint 照常（旧插件忽略未知功能名）。
- 断线重连或中途连接时，正在显示的消息与结算面板经 sidecar 快照缓存补发，不丢失、不重复闪现。

## Acceptance Criteria

- [ ] AC1 数据链路：插件在 HUD 消息变化与结算时发布新事件，经 sidecar 校验、按观看者投递并缓存补发；三仓库契约测试与夹具覆盖合法/非法示例（data-channel）。
- [ ] AC2 结算面板：1920x1080 下回合胜利 + MVP（最多击杀 / 回合王牌标签、头像、玩家名、音乐盒行）、无 MVP 胜利、回合败北、比赛结算、平局、观察者各态布局与实机截图一致（标题框 400 宽，MVP 条两端渐隐），配色符合 R2，停留时长跟随插件，副标题行显示插件文本（win-panel）。
- [ ] AC3 中下部消息区：4 个槽位位置与实机截图一致（播报 y≈750、高优先级 y≈803、低优先级 y≈868，宽 300），可同时显示；同槽替换；新播报闪白；倒计时 `m:ss` 本地逐秒走动；高优先级左侧红条、可两行（hud-alerts）。
- [ ] AC4 进度卡片：500x120 卡片位于 y≈630，进度环按剩余/总时长本地插值走动并随进度红→黄→绿变色，启动/关闭各有图标与插件文本，倒计时 `mm:ss.mmm`；取消/完成时消失（hud-progress）。
- [ ] AC5 接管：声明对应功能名后插件同区 Hint 隐藏、SLUI 显示；关闭覆盖层或断线后插件 Hint 恢复；实服联调通过。
- [ ] AC6 各仓库 lint / test / 构建与视觉审计通过；spec 更新（slui `system-boundaries.md` / `cs2-visual-replication.md`，插件 `hud-semantic-model.md` / `sidecar-ipc.md`，backend `protocol/ipc/README.md`）。

## Out of Scope

- `hud-money`（左下金钱）接管、CS2 计分板、击杀信息、比赛结束全屏画面（EndOfMatch）、死亡面板、投票面板。
- 趣味数据（另立插件任务）、结算/MVP 音乐与音效（插件游戏内播放）。
- 多语言、SLUI 侧文案目录。

