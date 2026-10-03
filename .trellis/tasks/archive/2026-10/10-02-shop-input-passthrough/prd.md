# 商店热键无法关闭已打开的商店

## Goal

商店打开时再按一次商店热键（默认 B）关闭商店，与 Esc 效果一致。输入模型保持现状（商店打开时覆盖层抢前台，可用鼠标点击，游戏收不到键盘）。

## Background

- 用户报告：B 能打开商店，但商店打开后按 B 不能关闭，只能 Esc。
- 预期路径：Rust `WH_KEYBOARD_LL` 钩子 → `slgo-shortcut { shortcut: "shop" }` → `setShopOpen(current => current ? false : …)`（`src/App.tsx:272`）。
- `09-07-app-home-settings` smoke 清单中“再按一次热键关闭”通过时，商店尚未抢前台；`2137ab5` 起商店打开时覆盖层成为前台窗口。
- 原始需求“只拦截商店按键、其他按键穿透”已放弃，实机验证结论见 `research/phase0-capture-spike.md`：
  - 低级钩子挡不住 Unity 通过 Raw Input 读取的鼠标移动（视角仍转）；
  - 覆盖层持有前台时，`PostMessage` 转发按键给后台游戏窗口，角色不移动。
  - 不注入游戏进程就无法同时做到“能走路”和“视角不转”。

## Requirements

- R1 商店打开时（覆盖层持有前台）按商店热键关闭商店，关闭后焦点交还游戏。
- R2 不改变其它现有行为：热键只在游戏前台且购买时段内打开商店；Esc、购买时段结束、停用覆盖层、Y/U 均照常关闭商店；按住热键不会反复开关。
- R3 修复基于诊断日志定位的根因，不用概率性的绕行。

## Acceptance Criteria

- [x] AC1 实机：购买时段按 B 打开商店，再按 B 关闭，鼠标回到游戏；可反复多次。
- [x] AC2 实机：按住 B 不放不会反复开关；Esc、Y/U 行为不变。
- [x] AC3 `npm run lint`、`npm test`、`npm run tauri:check`、`cargo test --manifest-path src-tauri/Cargo.toml` 通过。
- [x] AC4 临时诊断日志（`DIAG(10-02-shop-input-passthrough)`）在提交前移除或转为有意保留的诊断。

## Out of Scope

- 商店打开时让键盘穿透到游戏 / 虚拟光标（已验证不可行）。
