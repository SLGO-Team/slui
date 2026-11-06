# Design: 击杀栏图标整套重做

## Boundaries

数据链与 10-18 相同：插件 `KillFeedRecorder` → `KillFeedBoard` → `SidecarKillFeedRules` 按收件人构建 `hud.killfeed`
→ sidecar（`slgo-backend/apps/sidecar`，用 `slui/packages/protocol` 的 `parseHudKillfeed` 校验）→ SLUI
`features/killfeed`。三个仓库各自改、各自验证；发布顺序固定为 **SLUI 协议 → sidecar → 插件**（旧 sidecar /
旧 SLUI 严格拒收未知键）。

| 仓库 | 改动 |
|---|---|
| slui `packages/protocol` | 新可选键 `assist_kind`、`attacker_blind`，新客户端能力 `hud-killfeed-modifiers`；v0 README / JSON schema / contract-smoke |
| slui `features/killfeed` + `public/assets/killfeed/` | 7 个自绘 SVG；模型 / 视图按新键画图标；mock 场景 |
| slgo-backend | 升级 protocol 依赖后跑 sidecar 测试；新增 valid / invalid 夹具 |
| SLGO 插件 | 助攻来源细分到图标种类、致盲判定、按能力写键、Hint 文字版 |

## Contract (`hud.killfeed` entry)

- `assist_kind?: "flash" | "scp173" | "scp3114" | "scp079"`：助攻者前的图标种类。只在有助攻者、且该助攻
  来自闪光 / SCP 技能时写；伤害助攻不写（CS2 普通助攻只有 `+`）。自杀不能有。
- `attacker_blind?: true`：击杀者击杀瞬间处于 `Flashed` 效果中（CS2 `attackerblind`）。只写 true；自杀不能有。
- 两个键只发给声明 `hud-killfeed-modifiers` 的客户端。
- 兼容旧 SLUI（0.12.x 只声明 `hud-killfeed-flash-assist`）：插件对「只声明旧能力」的收件人继续写
  `assisted_flash: true`（只限 flash）；对声明新能力的收件人只写新键。解析器（sidecar 与 SLUI 共用）接受
  `assisted_flash` 与 `assist_kind` 二选一，同时出现拒收。新版 SLUI 只声明 `hud-killfeed-modifiers`，模型把
  `assisted_flash: true` 当作 `assist_kind: "flash"` 读（sidecar 回放旧格式时不丢图标）。
- 发布指纹（`SidecarKillFeedRules` 的 entry 签名）把 assist_kind / attacker_blind 计入，能力变化时重新发布。

## Plugin data rules

- `AssistCreditLedger.Credit` 增加 `ScpAssistKind Kind`；`RecordDebuff` 带上 `TantrumStained` / `Strangled`
  （调用点 `PlayerStatsManager.cs:103` 的 fact 已有 kind）。`AssistPick` 增加图标种类：
  Flash → flash；ScpDebuff → 最后那次减益的 kind（TantrumStained → scp173，Strangled → scp3114）；
  Scp079 → scp079；Damage → 无。
- 致盲：`attacker.IsAlive && attacker.IsEffectActive<Flashed>()`，与趣味数据 `RoundFunFactTracker.cs:252` 同口径；
  抽成一处共用规则。非敌方击杀也照实标（CS2 对队友击杀同样显示）。
- `KillFeedEntry`：`AssistedFlash` 换成 `AssistKind`（枚举，无助攻 / 自杀时恒为 None）+ `AttackerBlind`。
- Hint 文字版（`KillFeedHintText`）：致盲在击杀者名前加目录文案，助攻种类在 `+` 后加对应目录文案
  （`SLGO_KillFeed_*`，`HudMessageCatalog`，按 `ui-copy.md`）；未装 SLUI 的玩家也能看到同样的信息。

## SLUI rendering

- 顺序照 CS2 layout：`[blind] 击杀者 + [assist] 助攻者 武器 [headshot] 受害者`；自杀 `[killer] 骷髅 受害者`。
- 所有修饰图标高 24px、`margin: -2px 2px 0 2px`（现有 `.killfeed__icon`），白色。
- `presentation.ts`：`KILLFEED_ASSIST_ICONS: Record<HudKillfeedAssistKind, string>`、`KILLFEED_BLIND_ICON`；
  闪光助攻不再借商店 `GrenadeFlash.svg`。
- 资产 `public/assets/killfeed/`：`headshot.svg`、`suicide.svg`（重画）；`flash-assist.svg`、`blind.svg`、
  `scp173-assist.svg`、`scp3114-assist.svg`、`scp079-assist.svg`（新）。

## Icon art

- （已被 PRD D5 取代：爆头、自杀、闪光助攻、致盲按 CS2 原形约 98% 拟合重绘；173 / 3114 / 079 参照 SCP:SL 图标自画。）
  原计划：按 CS2 的构图和比例自己重画（用户 2026-11-06），不拷 CS2 路径（公开仓库）。CS2 原图从本地 `pak01_dir.vpk`
  提出的 SVG 只放 `D:/Temp/slui-killfeed-ref`，作对照，不进仓库、不进 PR。
- 统一规格：viewBox 高 32、按 24px 显示；纯白填充 + 负空间（镂空）表达细节，与 CS2 相同的粗线宽；不用描边阴影。
- 构图：爆头 = 侧脸头套 + 前额弹孔 + 向右出射的弹道与火星；自杀 = CS2 比例的骷髅交叉骨；闪光助攻 = 斜放闪光弹 +
  加号；致盲 = 被斜线划掉的眼睛；173 = 污池（扁平溅射斑 + 滴落）；3114 = 掐住的骨手；079 = 监控摄像头。
- 闪光助攻图标自带的加号与 `+` 标签是否同时出现，按用户实机截图 / 录像核对后定（CS2 layout 两者都在）。
- 评审：先出 1080p 对照图（CS2 原图 / 新图 / 实际击杀栏 mock 各一行）给用户看，通过后再接数据。

## Trade-offs

- 保留 `assisted_flash` 兼容分支而不是硬切：0.12.0 已发布，插件先上线时旧客户端仍要看到闪光助攻。等旧客户端
  淘汰后可单独删除（不在本任务）。
- 一个能力同时管两个新键：两者同时上线，拆开没有收益。

## Rollback

各仓库独立回滚：插件回滚后只是不再写新键；SLUI 回滚后不再声明新能力，插件自动退回 `assisted_flash`。
