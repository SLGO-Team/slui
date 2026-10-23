# 交互模式下仍可移动（结论：不做）

## Goal

商店打开或计分板光标模式下，玩家仍能用 WASD 移动、视角不随鼠标转动。

## Outcome (2026-10-23)

放弃。保持现状：交互面板持有前台，玩家在面板打开期间不能移动，作为已接受的限制记入
`.trellis/spec/frontend/system-boundaries.md`。

- 游戏只有在前台进程时才收得到键盘和鼠标，不存在"游戏收键盘、不收鼠标"的状态；
  `10-02-shop-input-passthrough` 已证实低级钩子挡不住鼠标移动、`PostMessage` 按键无效。
- 方案一：游戏保持前台，用 `SendInput` 注入反向位移抵消鼠标移动。spike 代码写完未进游戏即撤回：
  注入输入可被识别，与外部自瞄工具同类，Northwood 反作弊按行为模式检测，一旦命中是全体
  SLUI 用户的全局封禁风险。
- 方案二：SLUI 读按键，插件每 tick `ServerOverridePosition` 驱动行走。可行但有一个往返的
  输入延迟、客户端无插值的位置跳变、与服务端按客户端上报位置回拉的冲突，用户判定不够优雅。

## Acceptance Criteria

- [x] 否决原因与"不要再尝试注入输入"的规则写入 spec。
- [x] spike 代码全部撤回，主线代码无改动。
