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

- [ ] P1 有 smoke 用例：stale 时单件退款不会发出命令；reducer 拒绝的命令不会发送。
- [ ] P2：在 AZERTY 布局下（切换系统输入法实测或单元测试覆盖换算），设置的键 = 实际触发的键；ChatInput 按住检测正常。
- [ ] `npm run lint`、`npm test`、cargo clippy/test 通过。
