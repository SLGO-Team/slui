# SLUI 顶部回合状态 HUD

## Goal

负责回合状态、计时、比分、人数、双方头像与队友血量的实时展示。

## Requirements

- 顶部区域展示当前回合阶段、回合编号/计时、TeamA/TeamB 比分和双方在线/存活人数。
- 双方玩家头像、昵称和当前角色可识别；稳定比分使用 `team-a/team-b`，NTF/SCP 仅展示当前角色，支持换边。
- 对服务端授权提供的本方玩家血量显示状态：正常回合使用细白血条并以红色底色表达损失，购买/观战状态额外显示数字；敌方卡片不显示血量；未提供本方血量时显示未知状态，不由客户端猜测数值。
- 由 `match.snapshot` 驱动，按服务端时间/剩余秒数计算显示，不在客户端重新解释胜负规则。
- 处理七种 SLGO `RoundState`，以及 stale、断线、实例重启和无比赛状态。
- 视觉结构以 CS2UI `layout/hud/hudteamcounter.xml`/`layout/hud/hud.xml`、`styles/hud/hudteamcounter.css` 和 `images/hud/teamcounter/*` 为准，建立 XML/CSS/资源到 React 元素的 source map。

## Acceptance Criteria

- [x] mock snapshot 能展示完整顶部 HUD，且阶段、计时、比分、人数、头像和队友血量字段均来自 contract。
- [x] TeamA/TeamB 交换当前 NTF/SCP 角色后，比分归属不颠倒，角色标签正确更新。
- [x] 敌方 payload 没有 health 字段；队友死亡/离线/未知血量有明确视觉状态。
- [x] 收到旧 sequence 或 stale snapshot 时不倒退计时/比分，并显示 stale 指示；新 instance 只在 baseline 后恢复 live。
- [x] formatter、selector 和 reducer 有单元测试，覆盖 Idle、BuyPhase、ActionPhase、RoundEnd、MatchEnd。
- [x] 默认桌面与窄窗口截图在 live/buy/spectator/stale 状态下与 source map 基准一致；差异均有证据化记录。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
