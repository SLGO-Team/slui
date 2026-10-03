# 实施计划：聊天接收闭环

每个阶段独立提交（各自仓库），阶段结束时校验通过才进入下一阶段。

## 阶段 1：协议（slui/packages/protocol）
- [x] `ChatMessage.command_id?: string | null`，parser 校验（缺省、null、非空字符串）。
- [x] `ChatNotice*` 类型、`parseChatNotice`、`SlgoEvent` 联合类型、`parseEvent` 分支。
- [x] `parseEvent` 碰到未知类型返回 `unsupported-event-type`（加入 `ParseErrorCode`）。
- [x] `v0/README.md` 事件表、Compatibility（写明“未知事件类型被忽略；只有旧客户端必须拿不到的事件才需要协商”）。v0 原本就没有 chat 的 JSON schema，契约以 TS parser 为准，这次不新增。
- [x] `scripts/contract-smoke.mjs` 补用例。
- 校验：`npm run lint`、`npm test`。

## 阶段 2：后端（../slgo-backend）
- [x] `ipc/messages.ts` 加 `chat.notice`；`publish.schema.json` 枚举；新增夹具 `publish-chat-notice.example.json`、`publish-chat-message-command.example.json`；README 更新。
- [x] hub/server/contract 测试（多人受众、不缓存、chat.notice 发布校验与投递）。
- [x] fake-plugin：hello 之后的 notice、聊天发送时的 result → 本人消息 → Vega 回复 → 金钱 notice；dev-client 打印 notice。
- [x] `docs/decisions.md` 记录“新增事件类型靠客户端忽略未知类型实现兼容，不做握手协商”；`docs/roadmap.md` 更新跨仓库状态。
- 校验：`bun run lint`、`bun test`。

## 阶段 3：插件（../SLGO，遵循该仓库的 AGENTS.md / CLAUDE.md）
- [x] `ChatTone` 和 tone→颜色映射；`ChatTextSegment` 在 HUD 渲染时转义 `<>`；`SanitizeUntrustedText` 去掉全角转换（逐一确认常量文案不含标签）。
- [x] `ChatManager.Relayed` 事件及记录类型；`DeliverMessage` 返回收件人；五类发布点接入；`TrySend*Chat(commandId)`。
- [x] `SidecarIpcManager` 订阅/退订、受众过滤、DTO（`ChatMessagePayload.CommandId`、`ChatNoticePayload`）、队列淘汰规则；更新类注释里的“已接入/待接入”。
- [x] `Slgo.Tests`：夹具测试覆盖两个新 example；受众规则（同阵营、全体、排除非 Steam、未登记 NPC、假人）、command_id 有无、notice 按收件人发布、HUD 转义行为不变。
- [x] 更新 `Features/Chat/CLAUDE.md`、`Features/Sidecar/CLAUDE.md`（变更记录、待办）。
- 校验：`dotnet build Slgo.sln /p:Configuration=Debug /p:Platform=x64`、`dotnet test Slgo.Tests/Slgo.Tests.csproj -c Debug`。

## 阶段 4：SLUI
- [x] `sidecarIntake` 跳过（提前在阶段 1 完成） `unsupported-event-type`。
- [x] `chat/model.ts`：新 `ChatLine`、source/seen、baseline、message/notice、回显替换、pending 清除；`presentation.ts`：`resolveChatSender`、notice 色表。
- [x] `useChatFeature.receiveEvent(event, teams)`；App 通过 ref 把当前 `hud.teams` 传进去。
- [x] `ChatInput.tsx` 分三种行渲染；CSS 按需调整。
- [x] `scripts/chat-model-smoke.mjs` 覆盖 PRD 列出的全部场景；backend-connection-smoke 覆盖未知类型跳过。
- [x] spec §9 更新；mock 后端（如果有 chat fixture）补上他人消息和 notice，用于预览。
- 校验：`npm run lint`、`npm test`、`npm run chat-layout-audit`（1920x1080 和较小 16:9）。

## 阶段 5：端到端
- [x] slgo-backend：`bun run dev:control-plane`、`bun run dev:sidecar`、`bun run dev:fake-plugin`；slui：`npm run dev`。
- [x] 验证：本人消息只有一行（回显被替换）；Vega/Rhea 行的标签、名字、圆点颜色；notice 的绿色金额与灰色加入提示；重启 fake-plugin（新实例）后历史清空并可继续收发。同实例重连由 chat-model-smoke 覆盖（fake-plugin 随 sidecar 退出，无法端到端复现同实例重连）。
- [ ] 真服（可选，由用户决定）：真实插件 + 测试假人，覆盖团队/全体受众和金钱提示。

## 评审关口
- 阶段 1 完成后先汇报协议 diff，再动 backend 和插件。
- 每个阶段结束时 trellis-check。
