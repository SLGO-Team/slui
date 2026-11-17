# Design：成员槽位色按模式与人数

## 1. 协议（`@slgo/protocol`，match.snapshot，可选字段）

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `mode_family` | `"competitive"` \| `"casual"` | CS2 `0x180764600` 的 SLGO 对应：profile id `casual`（不区分大小写）为 `casual`，其余为 `competitive` |
| `player_limit` | 整数 2–128 | CS2 `0x180758180` 的 SLGO 对应：2 × `max_players_per_team`（cvar 范围 1–64） |

- 追加字段，`schema_version` / `ipc_version` 都不变（README「match.snapshot top-HUD fields」的做法）；旧解析器忽略未知键。
- 新解析器：字段存在时必须合法，否则整份快照 `invalid-payload`；两者各自可选。`omniscient` 快照也允许（回放现在不写）。
- `MatchSnapshot` 类型加两个可选属性；`v0/README.md` 表格加两行；`v0/match-snapshot.schema.json` 和示例加字段。

## 2. 插件（SLGO，`Features/Sidecar`）

- `MatchSnapshotInput` 加 `ModeFamily`（string，可为 null）和 `PlayerLimit`（int?）；`MatchSnapshotPayload` 同名属性，
  非 null 时写出 `mode_family` / `player_limit`（放在 `max_rounds` 之后）。`BuildOmniscient` 不传（回放不写）。
- 取值：`SidecarMatchSnapshotRules.ModeFamily(profileId)` 与计分板 `ModeIcon` 同一划分（casual → casual，其余 → competitive），
  常量放 `SidecarConstants`；`PlayerLimit = 2 * profile.MaxPlayersPerTeam`。由组装 `MatchSnapshotInput` 的发布者
  （`SidecarMatchSnapshotPublisher`）从 `GameModeManager` 读取。
- 测试：`SidecarMatchSnapshotRules` 单测（casual / competitive / 自定义 / 大小写），payload 写出顺序与 null 时不写，
  IPC 夹具对比（`publish-match-snapshot.example.json` 加两字段）。
- 模块 `CLAUDE.md`（Sidecar）补一句字段来源。

## 3. backend（slgo-backend）

- `protocol/ipc/v1/publish-match-snapshot.example.json` 加 `"mode_family": "competitive", "player_limit": 10`；
  `protocol/ipc/README.md` 的「match.snapshot top-HUD fields」表加两行。sidecar 用 `@slgo/protocol` 校验，无代码改动；
  跑 `bun test` 确认。`dev-client-core` 摘要不变。

## 4. SLUI

### 4.1 一个规则函数（`src/features/hud/presentation.ts`）

```ts
export type TeammateColorRule = { slots: boolean; pips: boolean; numbers: boolean };
/** CS2 0x18089fd20 / 0x180885500 / 0x180ecd9b0 (research/cs2-teammate-colour-rule.md). */
export function teammateColorRule(hud): TeammateColorRule
```

- `slots` = 没有 `mode_family` 或 `player_limit`（旧插件 / 回放）时 `true`；否则 `mode_family === "competitive" && player_limit <= 10`。
- `pips` = 没有 `mode_family` 时 `true`；否则 `mode_family === "competitive"`（CS2 小点不看人数）。
- `numbers`（观众编号）= 有 `player_limit` 时 `player_limit <= 10`；没有时沿用名单 ≤ 10。`playerObserverNumbers` 改为接收这个判断
  （或 limit），不再自己数人。
- hud model（`model.ts`）把 `mode_family` / `player_limit` 带进 `RoundHudViewModel`（`modeFamily` / `playerLimit`，可为 null）。
- 槽位色本身仍由 `playerSlotColors` 按名单位置算；规则只决定用不用。

### 4.2 各处回落

| 地方 | 规则 | 关闭时 |
| --- | --- | --- |
| 雷达标记 `PlayerMarker` | `slots` | 己方（含自己、死亡 X）用身份色 wash（`ntf` / `scp`），不再用白色 `self`；对手红色；观众沿用 #117 |
| 雷达携带的钥匙卡 `--pack-wash` | `slots` | 橙色 `observer` wash（CS2 默认 `#ff9b25`）；对手红色不变 |
| 顶部头像边框 `--hud-player-color` | `slots` | NTF `#6f9ce6`（SLGO NTF 在头像上沿用 CS2 CT 配色：`#a7e3ff` 名字、`#7289a3` 底色，所以取 CS2 CT 边框原值）；SCP `#d94652`（头像组现有的 SCP 强调色，计分数字同色）。视觉评审确认 |
| 聊天圆点 | `slots` | 不画圆点（`dotColor: null`） |
| 计分板色圈 `--sb-slot` | `slots` | 不画边框（`slotColor: null`，CSS 走透明 / 隐藏） |
| 商店队友小点 | `pips` | 灰色 `#787878`（`SHOP_PIP_NO_SLOT_COLOR`）；规则开启但不知道颜色时仍是白色 `SHOP_PIP_FALLBACK_COLOR` |
| 雷达观众编号 | `numbers` | 不显示 |

- 实现方式：App 里算一次 `teammateColorRule(hud)`，把 `playerColors` 在 `slots` 为假时换成空表传给雷达 / 聊天 / 计分板 /
  头像，另传 `teammateColors: boolean` 给需要区分「没颜色」和「规则关闭」的地方（雷达的自己、钥匙卡；头像边框）。
  具体落点以 #117 合入后的代码为准，原则是规则只在 `hud/presentation.ts` 一处。
- mock：`?hudMode=casual`（或沿用现有 mock 参数风格）让 mock 快照带 `mode_family: "casual", player_limit: 20`，供视觉审计截图。

## 5. 兼容与回滚

- 旧 SLUI + 新插件：未知键被忽略，行为不变。新 SLUI + 旧插件 / 回放：没有字段 → 现状。
- 回滚任一边只需 revert；字段可选，不需要协调发版。插件部署前 SLUI 看不到差异。

## 6. 风险

- SCP 头像边框颜色是 SLGO 自定的对应色，CS2 无原值，视觉评审时可能要调。
- 自定义 profile 一律算竞技类（和计分板图标一致）；若以后要更细，可再加 cvar。
