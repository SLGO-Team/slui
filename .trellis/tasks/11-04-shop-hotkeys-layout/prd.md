# 商店退款拦截与键盘布局

## Goal

数据过期时所有商店命令都被拦住；快捷键在非 QWERTY 布局下仍与设置里显示的键一致。

## Requirements

- P1：数据过期（stale）时单件退款没被拦（ShopPanel），而购买、请求和全部退款都会被拦。
  App 的 `handleShopCommand` 在 reducer 拒绝命令时仍然发送。两处都改：stale 时单件退款也拦；reducer 拒绝时不发送。
- P2：设置里存的是 `KeyboardEvent.code`（物理键位），Rust 键盘钩子按 VK（布局产生的字母）匹配。
  AZERTY / QWERTZ 下设置的键和实际触发的键可能不同；ChatInput 的按住检测也可能失效。
  先确认游戏本身（SCP:SL / Unity）按什么匹配按键，再统一：物理键位按扫描码匹配，或在保存/显示时按当前布局换算。

## Acceptance Criteria

- [x] P1 有 smoke 用例：stale 时单件退款不会发出命令；reducer 拒绝的命令不会发送。
- [x] P2：在 AZERTY 布局下（切换系统输入法实测或单元测试覆盖换算），设置的键 = 实际触发的键；ChatInput 按住检测正常。
- [x] `npm run lint`、`npm test`、cargo clippy/test 通过。

## 调研结论（2026-11-05）

- 游戏：SCP:SL 用 Unity 6000.0.43f1 的旧 Input（ScriptingAssemblies 里没有 Unity.InputSystem）；
  `SCPSL_Data/globalgamemanagers` 里 InputManager（class 13）的 `m_UsePhysicalKeys` = false，
  即游戏按当前布局（Windows 虚拟键）匹配按键，不按物理键位。
- 所以统一按虚拟键（VK）：Rust 钩子已按 `KBDLLHOOKSTRUCT.vkCode` 匹配，不用改；
  前端录入、显示和页面内判断改用 VK。WebView2（Chromium）在 Windows 上的 `KeyboardEvent.keyCode` 就是 VK。
- 存储格式不变（`KeyX` / `F1`–`F12` / `CapsLock`），含义改为「产生该字母的键」（VK 名），
  QWERTY 用户不受影响；旧文件在 AZERTY 下本来就按 VK 触发，含义不变，只是标签与录入现在一致，无需迁移。
- 输入法组字时 `keyCode` 是 229（VK_PROCESSKEY），JS 拿不到原 VK，只能退回 `event.code`；
  中日韩输入法的字母键底层布局都是 QWERTY，此时 code 与 VK 一致。

## 设计

- P1：reducer 的 `command` 动作按 `availabilityForState(state, sentAtMs) === "live"` 拦（覆盖按时间过期）；
  `ShopItemView` 加 `canRefund`（live + 购买时段 + refundable + 无在途退款），ShopPanel 用它拦单件退款；
  `useShopFeature.beginCommand` 同步跑 reducer 并返回是否接受，App 只在接受时发送。
- P2：`hotkeys.ts` 加 `eventVirtualKey` / `hotkeyFromEvent`，录入（HotkeySettings）、页面快捷键和计分板
  （platform/index.ts）、ChatInput 按住检测、商店 R 和数字键、选队 M 和数字键都用它。

## 验证（2026-11-05）

- shop-model-smoke：stale / 购买时段关闭 / 退款在途时 `canRefund` 为 false，reducer 对这些命令返回原 state（beginCommand 返回 false，App 不发送）。
- settings-smoke：AZERTY 换算（A 键 keyCode 0x41 / code KeyQ → `KeyA`，标签 A，钩子 VK 0x41）、IME 229 回退、数字键。
- 浏览器预览（QWERTY）：设置页录 G 成功、R 被拒、改回 B；overlay 里 B 打开商店，1 选第一列，无控制台错误。
- Rust 未改（钩子本来按 VK）。未切换系统布局实测（改系统设置），由单元测试覆盖换算。
