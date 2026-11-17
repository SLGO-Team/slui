# 小地图 CS2 对齐：成员槽位色按模式与人数

父任务：`11-17-minimap-cs2-parity`。来源：#117 评审时用户指出颜色规则，2026-11-17 决定「按 CS2 做，另开任务」。

## Goal

SLUI 现在只要有 match.snapshot 就给玩家上 CS2 五色槽位色。CS2 只在「竞技类模式」且「人数上限 ≤ 10」时才这样做，
其余情况全部回落阵营色。本任务让插件告诉 SLUI 模式类别和人数上限，并让 SLUI 所有用到槽位色的地方按 CS2 的规则
选择槽位色或回落色。依据见 `research/cs2-teammate-colour-rule.md`。

## 用户决定（2026-11-17）

| 问题 | 决定 |
| --- | --- |
| 范围 | 还原 CS2：所有用槽位色的地方都按规则来，并逆向核实每个地方的回落样子 |
| 回落的「阵营色」 | SLGO 身份色（HUD 已经把 CS2 的 CT / T 配色换成 SCP / NTF），雷达 NTF `#1ed2ff`、SCP `#ec6972` |
| 模式类别 | 按 profile id，沿用计分板现有的划分：`casual` 是休闲，`competitive` 和自定义 profile 都算竞技类 |
| 人数上限 | 2 × `max_players_per_team`（竞技 10、休闲 20），不用 SL 的 `max_players`（本地竞技服配了 20 个槽位给观众） |
| 和说话提示子任务的顺序 | 本任务的 slui PR 先开，`11-17-minimap-speaking` 在它之后 |

## Requirements

1. 插件在 match.snapshot 上写出模式类别和人数上限（可选字段，旧 SLUI 忽略；回放服暂不写）。
2. `@slgo/protocol` 校验新字段，contract 测试覆盖；backend IPC 夹具和 README 同步。
3. SLUI 规则：槽位色只在「模式类别为竞技」且「人数上限 ≤ 10」时启用（插件没发这两个字段时保持现状：启用）。
   不启用时各处按 CS2 回落：
   - 雷达：己方成员（含自己、死亡 X）用身份色；对手红色不变；观众规则沿用 #117（身份色）。
   - 雷达上携带中的钥匙卡：橙色 `#ff9b25`（CS2 CreateBombPack 默认色），不跟携带者颜色。
   - 顶部队伍头像边框：阵营色（CS2 `#6f9ce6` / `#eabe54` 的 SLGO 对应色）。
   - 聊天：名字前不画圆点。
   - 计分板：不画槽位色圈。
   - 商店队友小点：只看模式类别（CS2 不看人数）；休闲时为灰色 `#787878`。
4. 观众编号：有人数上限时按「上限 > 10 不显示」，没有时沿用「名单超过 10 人不显示」。
5. `.trellis/spec/frontend/minimap.md`（以及涉及的 HUD / 聊天 / 商店 / 计分板 spec）同步。

## Acceptance

- [ ] 竞技 5v5（上限 10）：和现在一样，槽位色、编号都在。
- [ ] 休闲（上限 20）或任何上限 > 10 的 profile：雷达队友是身份色、敌人红色；携带钥匙卡为橙色；头像边框为阵营色；
      聊天无圆点；计分板无色圈；商店小点灰色；观众看不到编号。
- [ ] 自定义 profile 上限 ≤ 10：按竞技处理；上限 > 10：槽位色关闭，但商店小点仍有槽位色（只看模式）。
- [ ] 旧插件（没有新字段）和回放：行为和现在一致。
- [ ] 协议 contract、插件单元测试（含 IPC 夹具对比）、backend 测试、SLUI 模型测试与小地图视觉审计都通过。
- [ ] SLUI PR 是视觉类：用户看过 mock 截图后再合；插件和 backend 只在本地合入，不部署（等用户指示）。

## Ordering

- SLUI 的标记代码（`MinimapRadar.tsx` / `.css`、`App.tsx`、`hud/presentation.ts`）等 #117 合入 main 后再改，
  从新的 main 开分支；`11-17-minimap-speaking` 在本任务的 slui PR 之后开。
- 协议、插件、backend 的改动不碰这些文件，可以先做。

## Out of scope

- `cl_teammate_colors_show` 的玩家开关和 `== 2` 的字母（PlayerLetter），`cl_show_enemy_avatar_colors`（SLUI 保持两队都上色）。
- 回放里写出模式和上限（demo 头没有 `max_players_per_team`，要改录像格式，另议）。
- 服务器端 `m_iCompTeammateColor` 的分配细节（SLUI 继续按名单位置排槽位）。
