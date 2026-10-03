# 实施计划：聊天输入

1. **快捷键**
   - `src/platform/hotkeys.ts`：`RESERVED` 加 `KeyU`，更新注释。
   - `src/platform/index.ts`：`OverlayShortcut` 改为 `chat-global | chat-team | shop`；浏览器键位映射 Y/U。
   - `src-tauri/src/lib.rs`：`VK_U`、钩子映射、`is_bindable_shop_hotkey` 排除 U、测试补 0x55。
   - 同步更新 `scripts/settings-smoke.mjs` / `desktop-adapters-smoke.mjs` 里涉及的断言。
2. **键盘焦点**
   - Rust `set_overlay_keyboard_focus` + 注册；`OverlayWindowController.setKeyboardFocus()`（浏览器为 no-op）。
3. **模型**：`src/features/chat/model.ts` reducer、长度、原因映射；新增 `scripts/chat-model-smoke.mjs` 并加入 `npm test`。
4. **UI**：`useChatFeature.ts`、`ChatInput.tsx`、`ChatInput.css`。
5. **App 组装**：快捷键路由、interactive 公式、焦点 effect、blur 关闭、事件/状态转发、发送。
6. **Mock 回执**：`RealtimeMockProvider` 的聊天 `command.result`，含冷却/超长拒绝。
7. **Spec**：更新 `system-boundaries.md`（和 `quality-guidelines.md` 里“currently only the shop”）。

## 验证

- `npm run lint`、`npm test`、`npm run build`、`npm run tauri:check`、`cargo test --manifest-path src-tauri/Cargo.toml`
- 浏览器 `npm run dev:mock`：Y/U 打开、Tab 切换、回车成功、1 秒内再发看到冷却拒绝、Esc/失焦行为、截图。
- 实机（由用户进行，`npm run tauri:backend` + 本机专用服）：前台切换是否成功、打字、焦点归还、B/Y 不误触、插件 reason 显示。

## 回退点

- 步骤 1–2 独立提交可单独回退；步骤 3–6 属于同一功能。
