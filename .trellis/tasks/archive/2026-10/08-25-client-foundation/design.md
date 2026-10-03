# 基础链路设计

## 模块

- `src/contracts`: v0 envelope、route、match/shop/chat/minimap payload、command/result 的 runtime parser。
- `src/platform/identity`: Steam local identity、proof provider、授权状态。
- `src/platform/control`: route resolve、TTL、server/instance binding。
- `src/platform/sidecar`: WSS/loopback abstraction、baseline、sequence guard、reconnect。
- `src/mocks`: deterministic provider and fixtures used by every feature.

## Overlay shell source map

`layout/hud/hud.xml` 的 `HudTopCenter`、`HudTopLeft`、`HudBottomCenter`、`HudBottomRight`、`HudTopRight` 和 `HudBlur` 是 shell 的结构基准；`hittest`/`hittestchildren` 映射为 React overlay 的 pointer-events 层。shell 只负责 composition、窗口输入模式和连接诊断，不复制 feature 业务状态。

## 状态机

`signed-out -> discovering -> route-pending -> connecting -> baseline-required -> live`，异常分支为 `stale`、`incompatible`、`unauthorized`、`offline`。新 `instance_id` 只能从 baseline 重新进入 live；旧订阅必须释放。

## 授权

`local-steamid` 只产生 discovery identity。只有 proof provider 返回 verified/pairing session，route 才可携带 player-scoped authority。command factory 在发送前再次检查 authority 与 instance binding。
