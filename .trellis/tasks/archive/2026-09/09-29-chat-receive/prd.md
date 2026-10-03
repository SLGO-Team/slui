# 聊天接收闭环：chat.message / chat.notice 转发与渲染

## Goal

完成父任务 `08-25-chat` 的剩余部分：SLGO 插件把游戏内消息区收到的内容（玩家团队/全体聊天、投掷物警示、系统提示）
按与游戏内完全相同的收件人集合发布给 SLUI；SLUI 接收、去重、按服务端顺序写入 CS2 聊天框历史区，
并用服务端消息取代本地回显。跨三个仓库：`../SLGO`（插件）、`../slgo-backend`（sidecar、fake-plugin）、本仓库（协议 + 客户端）。

## 已确认的决策（2026-09-29）

- **回显关联**：由实现方选择最优方案 → `ChatMessage` 增加可选 `command_id`（见 design.md D1）。
- **实例/重连**：同一 `server_id + instance_id` 重连保留历史与去重集；换实例（或换服）清空历史。sidecar 不重放聊天，断线期间的消息丢失可接受。
- **转发范围**：全部转发——玩家聊天、投掷物警示、金钱到账、自杀补偿、加入/离开。系统提示需要新增协议事件。
- **正文文本**：语义文本。插件只做规范化（去首尾空白、去控制/格式/换行字符、长度校验）；游戏 HUD 的 `<`/`>` 转全角属于 Hint 富文本转义，挪到 HUD 渲染层，不进协议。

## Requirements

### 插件（../SLGO）
- `ChatManager` 每次向游戏内消息区投递时，同步发布一条对应事件，受众 = 该次实际投递的收件人中，进入 sidecar roster 的 Steam 玩家（含登记的测试假人）。受众为空则不发布。
  - 团队聊天、投掷物警示 → `chat.message`，`scope: "team"`，受众只包含发送瞬间同阵营的玩家。
  - 全体聊天 → `chat.message`，`scope: "global"`，受众为全部在线玩家。
  - 金钱到账、自杀补偿（按收件人分别生成）、加入/离开 → `chat.notice`，受众与游戏内一致。
- `chat.message` 字段：`message_id`（实例内唯一）、`scope`、`sender_id`（SteamID64）、`sender_name`、`team_id`（发送者比赛队伍，无则 null）、`role`（ntf/scp，无则 null）、`body`、`sent_at`；消息由 SLUI 命令触发时带上该命令的 `command_id`，否则省略。
- 所有转发都复用游戏内的校验、冷却和收件人规则，不新增第二套规则。发布必须发生在同一命令的 `command.result` 之前。

### 后端（../slgo-backend）
- sidecar 把 `chat.notice` 当作可发布、不缓存的事件，受众规则与 `chat.message` 相同。
- 确认并用测试覆盖 `chat.message` 的多人受众投递：同阵营收到、敌方收不到、全体都收到、不缓存、不重放。
- fake-plugin 能演示：带 `command_id` 的本人消息（先 result 后 message，走“回显→替换”路径）、其他玩家的消息、系统提示。

### SLUI（本仓库）
- 协议：`ChatMessage.command_id?`、`chat.notice` 事件；SLUI 遇到未知事件类型时只丢弃这一帧，不让整条流进入 stale（不做握手能力协商，2026-09-29 确认）。
- 接收 `chat.message` / `chat.notice`：按 `message_id` / `notice_id` 去重，按到达顺序（即 sequence 顺序）进历史区；只接受当前实例的事件。
- 本人消息：`command_id` 匹配 pending 时直接落服务端行；已经有本地回显时原位替换，不产生两行。
- 其他玩家的行格式和颜色与本人一致：`[ALL] ● Name:  body` / `[NTF] ● Name: body`；标签和名字用 `ROLE_COLORS[role]`，圆点用发送者在比赛快照中的 `PLAYER_COLORS` 槽位色，查不到时用白色。
- 系统提示按语义色调渲染（默认白色 / 金钱绿 / 灰色），整行无标签、无圆点。
- 同实例断线重连后历史不重复、不丢已有行；换实例清空。

## Acceptance Criteria

- [ ] 插件：团队消息的受众只含同阵营 Steam 玩家，全体消息含全部 Steam 玩家；非 Steam 玩家和未登记 NPC 不进受众；SLUI 命令触发的消息带 `command_id`，控制台 `.chat/.bc` 触发的不带；系统提示按收件人发布。以上都有单元测试，契约夹具测试通过。
- [ ] 插件：游戏内 HUD 显示不变（包括 `<`/`>` 仍显示为全角、防止富文本注入）。
- [ ] 后端：`bun run lint`、`bun test` 通过；新增或更新的 IPC 夹具通过 ajv 和插件夹具测试；多人受众、`chat.notice` 投递、不缓存都有 hub 测试。
- [ ] SLUI：`npm test` 和类型检查通过；reducer 单测覆盖去重、换实例清空、同实例重连保留、回显替换（两种到达顺序）、pending 被服务端消息清除、他人行着色、系统提示、未知事件类型被跳过。
- [ ] 端到端（`dev:control-plane` + `dev:sidecar` + `dev:fake-plugin` + `npm run dev`）：本人消息只出现一行；他人消息和系统提示按 §9 样式显示；重启 sidecar 或断线重连后不重复；重启 fake-plugin（新实例）后历史清空。附截图。
- [ ] 1920x1080 和较小 16:9 尺寸下运行 `npm run chat-layout-audit` 通过。

## Out of Scope

- sidecar 的聊天历史缓存/重放（断线期间的消息接受丢失）。
- spectator 范围聊天（插件拒绝）。
- 游戏内 HUD 与 SLUI 同时显示聊天的去重（由插件任务 `09-28-slui-presence` 负责）。
- `command.shop.purchase`、minimap 等其它“待接入”项。
