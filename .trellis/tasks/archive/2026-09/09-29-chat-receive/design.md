# 设计：聊天接收闭环

涉及仓库：`slui/packages/protocol`（契约，MIT）→ `slgo-backend`（sidecar、IPC 夹具、fake-plugin）→ `SLGO`（插件）→ `slui`（客户端）。
协议改动先在 `slui/packages/protocol` 落地，backend 通过 workspace 直接引用，不复制类型。

## D1 本地回显与服务端消息的关联：`ChatMessage.command_id?`

```ts
export type ChatMessage = { message_id; scope; sender_id; sender_name; team_id?; role?; body; sent_at;
  /** The client command that produced this message; absent for console/game-originated messages. */
  command_id?: string | null };
```

- 只有由 SLUI `command.chat.send` 产生的消息才带这个字段，而且只发布一次，所有收件人拿到同一份 payload。
- 不选“给发送者单独发一份”的原因：command_id 是客户端随机生成的，插件去重按 `(player_id, command_id)` 做，别人知道了也用不上；拆成两次 publish 会让插件受众逻辑和 message_id 语义都变复杂，却换不来实际收益。
- 不选“去掉本地回显”的原因：chat.message 可能被 IPC 发送队列淘汰（chat 类可淘汰，command.result 不会被淘汰），也可能碰上还没转发的旧插件。这时 accepted 之后 SLUI 什么都不显示，属于静默丢失。
- 这是向后兼容的：旧 parser 本来就接受 payload 里的多余字段。

**一条规则**：同一个 `command_id` 只占一行——本地回显和服务端消息谁先到谁先显示，服务端消息到了覆盖本地回显。

**顺序事实**：真实插件先投递（发布 chat.message），再入队 command.result，同一 IPC 连接 FIFO，同一实例共用一个 sequence，所以 SLUI 先收到 message。fake-plugin 顺序相反（先 result），正好用来覆盖“回显→替换”这条路径。

## D2 系统提示：新事件 `chat.notice`

```ts
export type ChatNoticeTone = "default" | "money" | "muted";
export type ChatNoticeSegment = { text: string; tone: ChatNoticeTone };
export type ChatNotice = { notice_id: string; segments: ChatNoticeSegment[]; sent_at: string };
// SlgoEvent |= ProtocolEnvelope<ChatNotice, "chat.notice">
```

- 校验：`notice_id` 非空；`segments` 1..8 段，每段 `text` 非空，全部段合计不超过 512 个 UTF-16 码元；`tone` 只能是枚举值。
- 文案由插件决定（中文），色调是语义值，SLUI 自己映射颜色。插件映射：`White→default`、`MoneyGreen→money`、`NeutralGray→muted`，映射来源是同一张表（见 D4），不是从颜色字符串反推。
- 受众规则与 chat.message 相同（任意非空列表），不缓存，不做能力开关（见 D3）。
- 投掷物警示在游戏内就是以投掷者名义发的团队消息，所以走 `chat.message`（`scope: "team"`，不带 command_id），不走 notice。

## D3 前向兼容：未知事件类型安全跳过（取代能力协商）

现在 `parseEvent` 碰到未知 `type` 会返回 `invalid-payload`，intake 随即 `rejectGlobal`，整条流进入 stale、要求重新 baseline。改为：

- `parseEvent` 对未知类型返回新错误码 `unsupported-event-type`。
- `sidecarIntake` 碰到这个错误码时：sequence 照常消费（guard 已接受），不调用 `rejectGlobal`，不改变状态，只丢弃这一帧。

**不做 `session.open` 能力协商**（2026-09-29 与用户确认）：协商要同时改三个仓库的握手，还会让新 SLUI 连不上旧 sidecar；而 v0 没有已部署的旧客户端需要保护。以后新增事件类型只要满足“旧客户端忽略即可”就不需要握手改动；只有“旧客户端必须拿不到”的事件（例如 minimap 那样的版本不兼容 payload）才另做协商。这条规则写进协议 README 和 backend `docs/decisions.md`。

## D4 插件（../SLGO）

**转发钩子**（依赖方向保持 `SidecarIpcManager → ChatManager`）：
- `ChatManager` 新增事件 `Relayed`，参数为不可变记录：
  - `PlayerChatRelay { Scope(team/global), Player Sender, TeamType SenderTeam, string SenderName, string Body, string CommandId, IReadOnlyList<Player> Recipients }`
  - `NoticeRelay { IReadOnlyList<(ChatTone tone, string text)> Segments, IReadOnlyList<Player> Recipients }`
- `DeliverMessage` 返回实际投递的收件人列表（替代计数），调用方据此触发事件；`PublishMoneyIncrease`、`PublishSuicideCompensation`（每个 viewer 一次）、`PublishPlayerJoined/Left`、`PublishThrownProjectile` 各自触发对应记录。
- `TrySendTeamChat` / `TrySendBroadcastChat` 新增可选参数 `string commandId = null`；`SidecarIpcManager.HandleChatCommand` 传入 `command.CommandId`，控制台命令不传。
- 没有订阅者（sidecar 未启用）时零开销：先判断事件是否为 null，再去构建记录。

**语义色调**：新增 `ChatTone { Default, Money, Muted }` 和唯一的 `tone → UIConstants.Colors` 映射。系统提示的 `ChatTextSegment` 按 tone 构造，HUD 颜色由它派生；队伍标签这类非 tone 段保留显式颜色构造。

**文本净化拆层**：`SanitizeUntrustedText` 只做语义规范化（去控制/格式/换行字符、trim），不再把 `<>` 转成全角；`ChatTextSegment.AppendRendered` 在写 HUD 富文本时统一转义 `<`→`＜`、`>`→`＞`。游戏内显示效果不变（常量文案里没有富文本标签，实现时要逐一确认）；长度校验是一对一字符映射，结果不变。

**发布**（`SidecarIpcManager` 订阅 `Relayed`）：
- 受众 = 收件人中满足 `TestDummyRules.IsSidecarVisible(...)` 且 `SidecarRosterRules.TryGetSteamId64` 成功的玩家，去重；为空不发布；`client` 未就绪（`IsReadyForPublish` 为 false）时直接丢弃（聊天不重发）。
- `message_id` / `notice_id` = `chat-` / `notice-` + `Guid.NewGuid().ToString("N")`。
- `team_id` = `matchTeamManager.GetMatchTeamByRole(team)` → `team-a`/`team-b`，`TeamType.None` 时为 null；`role` = `ntf`/`scp`/null。
- `round_id` 与 command.result 一样取 `SidecarMatchSnapshotRules.RoundId(scoreManager.CurrentRound)`。
- `ChatMessagePayload` 增加可选 `CommandId`（为 null 时不写这个字段）；新增 `ChatNoticePayload`；`PublishMessage` 的受众校验和 `IpcOutgoingQueue` 的淘汰规则把 `chat.notice` 当作 `chat.message` 同类处理。
- 顺序：`HandleChatCommand` 里 ChatManager 同步触发事件 → chat.message 先入队 → 然后 `PublishCommandResult`。

## D5 后端（../slgo-backend）

- `ipc/messages.ts`：`PUBLISH_EVENT_TYPES` 加 `chat.notice`（不进 SNAPSHOT，也不进单收件人集合）；`toProtocolEvent` 用新 parser 校验。
- sidecar 投递逻辑不变（chat.notice 与 chat.message 一样按受众投递给所有客户端）。
- `protocol/ipc/v1`：`publish.schema.json` 的 event_type 枚举加上 `chat.notice`；新增 `publish-chat-notice.example.json`、`publish-chat-message-command.example.json`（带 command_id）；README 事件表和缓存说明同步更新。
- 测试：hub 多人受众（同阵营 A、B 收到，敌方 C 收不到，全体都收到），chat.message / chat.notice 不缓存（新客户端连上后收不到旧消息），chat.notice 发布校验与投递。
- fake-plugin：hello 之后发一条 `chat.notice`（例如“Nova 加入了游戏”，muted）。收到 `command.chat.send` 时依次发 `command.result accepted` → 本人 `chat.message`（带 command_id）→ 夹具队友 Vega（`76561198000000002`，team-a/ntf）的回复 → 一条金钱 notice（`default`+`money` 两段）。
- dev-client 打印 `chat.notice`。

## D6 SLUI 模型（src/features/chat/model.ts）

```ts
type ChatPlayerStyle = { name: string; tag: string; teamColor: string; dotColor: string }; // 收到时冻结
type ChatLine =
  | { id: string; kind: "player"; scope: ChatInputScope; style: ChatPlayerStyle; body: string; atMs: number; commandId?: string; echo: boolean }
  | { id: string; kind: "notice"; segments: ChatNoticeSegment[]; atMs: number }
  | { id: string; kind: "system"; text: string; atMs: number };   // 本地发送失败
state += { source: { serverId: string; instanceId: string } | null; seen: string[] /* 最近 256 个 message_id/notice_id */ }
```

- `sidecar.baseline`：source 变了（换服或换实例）→ 清空 `lines`、`seen`，更新 source；source 相同 → 不动（同实例重连保留）。
- `chat.message` / `chat.notice`：source 为空或不匹配 → 忽略；id 已在 `seen` 里 → 忽略；否则追加（到达顺序 = sequence 顺序，由 intake 的 `EventSequenceGuard` 保证）。`spectator` scope 按 global 的样式显示（插件目前不会发）。
- 本人消息（`command_id` 存在）：
  - 等于 `pending.commandId` → 清掉 pending，追加服务端行；之后到达的 accepted result 因为 pending 已空而被忽略。
  - 已有 `echo` 行的 `commandId` 等于它 → 原位替换成服务端行，沿用回显行的 `atMs`（淡出不重新计时）。
- accepted/duplicate result 到达时 pending 还在 → 追加 `echo: true` 行（style 用当时的 `resolveChatSelf`，冻结）。
- 样式在收到时冻结（和 CS2 的文本行一样，换边后旧行不变色）：`resolveChatSender(message, teams)` 放在 `presentation.ts`，与 `resolveChatSelf` 共用槽位逻辑——在 match.snapshot 两队的 `players` 里找 `sender_id`，得到 `PLAYER_COLORS[hudSideForRole(team.role)][index % n]`；找不到用白色。tag：team scope 显示 `[${role.toUpperCase()}]`（没有 role 时 `[TEAM]`），global 显示 `[ALL]`；`teamColor = role ? ROLE_COLORS[role] : "white"`；名字用 payload 的 `sender_name`。
- reducer 保持纯函数：hook 的 `receiveEvent(event, teams)` 从 App 拿到当前 `hud.teams`（通过 ref 读最新值），在 dispatch 前算好 style 放进 action。

## D7 渲染（ChatInput.tsx / presentation.ts / §9）

- `ChatRow` 按 `kind` 分三种：player 行沿用现有 DOM（tag/dot/name/body），颜色从 `line.style` 取，不再读 `self`；notice 行 = 按段着色的 `<span>` 序列，不带 tag/dot；system 行不变。
- `presentation.ts` 新增 `CHAT_NOTICE_TONE_COLORS = { default: "white", money: "#4CAF50", muted: "#A9A9A9" }`（取值来自插件 `UIConstants.Colors`，注明出处）。
- 更新 spec §9：他人行、notice 行的规则，以及“样式在收到时冻结”。

## 兼容矩阵

| 组合 | 结果 |
|---|---|
| 旧 SLUI + 新 sidecar | 旧 SLUI 收到 chat.notice 会进入 stale（v0 未部署，没有这样的客户端；本任务之后的 SLUI 都会忽略未知类型） |
| 新 SLUI + 旧 sidecar | 正常，只是没有 notice |
| 新 sidecar + 旧插件 | 没有 chat 事件；SLUI 在 accepted 时显示本地回显 |
| 旧 sidecar + 新插件 | chat.notice 发布被拒（可恢复的 diagnostic，丢弃）；chat.message 正常 |

## 回滚

每个仓库各自提交，顺序为 protocol → backend → plugin → SLUI。协议字段和事件都是新增，回滚某个仓库时按上面的矩阵降级，不需要数据迁移。
