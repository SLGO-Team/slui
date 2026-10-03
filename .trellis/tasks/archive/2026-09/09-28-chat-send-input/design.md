# 设计：聊天输入

## 1. 快捷键（Rust 钩子 + TS）

- `OverlayShortcut` 由 `"chat" | "shop"` 改为 `"chat-global" | "chat-team" | "shop"`。
  - Rust：`VK_Y (0x59)` → `"chat-global"`，新增 `VK_U (0x55)` → `"chat-team"`。钩子仍不吞键、只发事件，是否打开由覆盖层决定。
  - 浏览器预览：`KeyY` / `KeyU` 同样映射。
- 保留键新增 U：`hotkeys.ts` 的 `RESERVED` 加 `KeyU`；Rust 的 `is_bindable_shop_hotkey` 排除 `0x55`，并补 Rust 测试。已存为 U 的商店热键由 `normalizeHotkeys` 回退为 B。

## 2. 键盘焦点（新 Rust 命令）

商店只需要鼠标；聊天需要键盘，所以覆盖层必须成为前台窗口。

- `set_overlay_keyboard_focus(focused: bool)`，只由覆盖层调用，且只在 interactive 为 true 时有效：
  - `true`：记下当前前台窗口（应为游戏），再 `SetForegroundWindow(overlay)`。后台进程抢前台会被 Windows 前台锁拒绝，失败时用 `AttachThreadInput(前台线程, 本线程)` 包裹后重试一次。仍失败则返回错误，前端关闭聊天。
  - `false`：如果覆盖层仍是前台，把前台还给之前记下的游戏窗口（此时我们是前台进程，可以设置）。
  - 覆盖层停用时拒绝 `true`，与 `set_overlay_interactive` 一致。
- 顺序：打开 = `setInteractive(true)` → `setKeyboardFocus(true)` → 聚焦 `<input>`；关闭 = `setKeyboardFocus(false)` → `setInteractive(false)`。两者都由派生状态驱动（与现有 `sentInteractiveRef` 模式一致）。
- 前台跟踪线程看到前台是覆盖层时本来就跳过对齐；游戏前台状态会变成 false。因此**不能**用“游戏失去前台”来关闭聊天，改用覆盖层 `window` 的 `blur` 事件（切窗口/点到外部）。小地图在聊天期间会解除备用缩放，属于可接受行为。
- `interactive = (shopOpen && shopAvailable) || chatOpen`。

## 3. 前端结构

- `src/features/chat/model.ts`（纯函数，可测）
  - `MAX_CHAT_LENGTH = 120`；`chatLength(body)` 用 `Intl.Segmenter`（grapheme）计数，对齐插件的 `LengthInTextElements`。
  - `validateChatBody` 返回中文原因；`createChatCommand` 不变。
  - `chatInputReducer(state, action)`：
    - state：`{ open, scope, draft, retry: { scope, body } | null, pending: { commandId, scope, body } | null, notice: { kind: "pending"|"accepted"|"failed", text, untilMs } | null }`
    - actions：`open(scope)`、`draft(text)`、`toggle-scope`、`submit(command, nowMs)`、`close("escape" | "blur" | "unavailable")`、`command-result(result, nowMs)`（只处理 `command.chat.send` 且匹配 pending id）、`connection(status, nowMs)`、`tick(nowMs)`。
  - `formatChatFailure(reason)`：机器码 → 中文；未知码 → “发送失败”；非码的中文原样。
- `src/features/chat/useChatFeature.ts`：与 `useShopFeature` 同构的 React 适配层。
- `src/features/chat/ChatInput.tsx` + `.css`：按 CS2 `hudchat.xml`/`hudchat.css` 手工还原的完整面板（历史区 + 输入行 + 发送按钮），关闭后残留行单独定位；截图得到的文案/颜色集中在 `presentation.ts`。处理 Enter/Esc/Tab（跳过 `isComposing`），以及打开键的自动重复。详见 spec `cs2-visual-replication.md` §9。
- `App.tsx`：
  - `subscribeShortcut`：聊天打开时忽略所有快捷键；`chat-*` 在 `gameFocused && overlayEnabled && sessionLive` 时打开并关闭商店；`shop` 行为不变。
  - `handleEvent` / `handleStatus` 转发给聊天 feature；覆盖层停用时关闭聊天。
  - `handleChatSend`：照 `handlePurchase` 调用 `connection.send`，`catch` 转为 `failed`。
- Mock：`RealtimeMockProvider` 收到 `command.chat.send` 时按插件规则（120 字、1 秒冷却）异步回 `command.result`，用于 `dev:mock` 预览。

## 4. 契约 / 文档

- 协议包不变（`ChatSendCommand` / `CommandResult` 已存在）。
- 更新 `.trellis/spec/frontend/system-boundaries.md`：`slgo-shortcut` 的取值、`set_overlay_keyboard_focus`、`interactive` 公式、保留键 U。

## 5. 风险与回退

- 前台锁：`AttachThreadInput` 仍可能失败（全屏独占等）。失败 → 关闭聊天、控制台报错，不留下 interactive 状态。需要实机验证。
- 回退：本任务改动集中在 chat feature、App 组装和两个 Rust 函数，可以整体回退。
