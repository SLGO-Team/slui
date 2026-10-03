# 聊天设计

Chat store 维护按服务端 sequence 排序的历史，并按 `message_id` 去重。可选聊天范围来自插件 capability；发送 command 只携带已选合法范围、文本和 command id。不同 instance 的历史不合并。

ChatPanel 按 `hudchat.xml` 的 `ChatContainer/ChatMain/ChatHistory/ChatTextEntry` 分层；`TextEntry`、`TextButton` 和背景 class 映射到可访问 HTML 控件，Panorama 的输入焦点和 hittest 语义由 overlay mode 控制。
