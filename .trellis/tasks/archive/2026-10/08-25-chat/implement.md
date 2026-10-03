# 聊天实施计划

1. 在 contracts 中定义 chat history/event、scope capability、send command/result。
2. 实现输入校验、历史 reducer、去重、pending/拒绝/限流状态和 mock fixture。
3. 接入按 `hudchat.xml`/`chat.css` 还原的聊天面板、范围选择和快捷键，遵循 interactive/passive 规则。
4. 测试空/超长消息、非法 scope、重复消息、断线重连和跨 instance 隔离。
