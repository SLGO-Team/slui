# SLUI 聊天界面

## Goal

负责 SLGO 插件聊天范围、消息历史、发送和实时接收。

## Requirements

- 展示 SLGO 插件定义的聊天范围（例如全体/队伍/观察者等）和按服务端顺序排列的消息历史。
- 发送前明确当前范围，生成 client command id；发送后显示 pending、成功、拒绝、限流、断线状态。
- 消息内容、发送者 SteamID/昵称、队伍/角色和服务端时间来自插件；不得由客户端猜测范围或改写权限。
- 重连获取 baseline/history 时去重，旧消息和不同 instance 的消息不可污染当前会话。
- 视觉结构以 CS2UI `layout/hud/hudchat.xml`、`layout/chat.xml`、`styles/hud/hudchat.css` 和 `styles/chat.css` 为准，保留聊天背景、历史区、输入区、发送按钮和 spectator/GOTV 变体的层级语义。

## Acceptance Criteria

- [x] mock history 和实时事件可渲染，范围切换仅使用服务端允许的选项。
- [x] 空消息、超长消息和失焦/被动 overlay 状态不会发送非法命令。
- [x] 插件拒绝、限流、断线和重连状态可见；重复 command id 不重复显示/发送。
- [x] 消息排序、去重、输入校验和 command 状态有单元测试。
- [x] 默认桌面与窄窗口截图覆盖历史、输入聚焦、发送 pending/失败和 passive 状态，并能追溯到 chat source map。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
