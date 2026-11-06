# 击杀栏图标整套重做

## Goal

把 SLUI 右上击杀栏的修饰图标做成一套风格统一、像 CS2 的自绘图标：重画用户不满意的爆头，以及自杀、闪光助攻；
补上 SCP:SL 里插件已有数据、但击杀栏还不显示的修饰：致盲击杀、173 / 3114 减益助攻、079 助攻。
来源：用户 2026-11-05 看到闪光助攻图标（#84，未经视觉评审随 0.12.0 发布）后说爆头难看，要求所有击杀栏图标一次性统一；
2026-11-06 用户发起本任务。

## Background

- CS2 `huddeathnotice.xml` 修饰顺序：`Revenge` `Domination` `AttackerBlindIcon` 击杀者 `+ [Flashbang] 助攻者`
  `AttackerInAir` 武器 `NoScope` `ThroughSmoke` `Penetrate` `HeadShot` `Suicide` 受害者；修饰图标 `height: 24px;
  margin: -2px 2px 0 2px`（`../cs2ui/panorama/styles/hud/huddeathnotice.css`）。
- SLUI 现状（`src/features/killfeed/presentation.ts:6-14`）：爆头、自杀为 10-18 自绘；闪光助攻借用商店
  `slui-svg/GrenadeFlash.svg`（竖放手雷，与 CS2「斜放手雷 + 加号」不同）。
- 协议（`packages/protocol/src/index.ts:1486-1529`）只有 `headshot`、`suicide` 和可选 `assisted_flash`
  （能力 `hud-killfeed-flash-assist`，`index.ts:979`）。
- 插件（`../SLGO`）已有：助攻来源 `AssistSource { Damage, Flash, ScpDebuff, Scp079 }`
  （`SLGO/Features/Stats/AssistSelectionRules.cs:7`），击杀栏只取 Flash（`SLGO/Features/Stats/KillFeedRecorder.cs:66`）；
  SCP 减益 = 173 污池 / 3114 勒颈（`AssistCreditLedger.cs:10`）；079 来源见 `SLGO/Features/Scp/ScpAssistRules.cs`；
  击杀者被闪判定见 `RoundFunFactTracker.cs:252`。

## Decisions (user, 2026-11-06)

- D1 范围：整套击杀栏图标，不只助攻。
- D2 新增修饰：致盲击杀、SCP 减益助攻、079 助攻。不做空中击杀（需新判定、出现少）；未开镜 / 穿烟 / 复仇 / 压制
  在 SCP:SL 无对应，穿墙未确认 SCP:SL 有该判定，均不做。
- D3 画风：照 CS2 构图和比例自己重画；CS2 原图只作本地参照，不进公开仓库。
- D4 173 污池与 3114 勒颈各用一个图标。
- D5（第一稿评审后，2026-11-06）：CS2 已有的图标（爆头、自杀、闪光助攻、致盲）按 CS2 原形约 98% 拟合重绘
  （实测逐像素 IoU ≥ 99.6%，取代 D3 的「按构图自画」）；173 去掉水滴只留污池；3114、079 第一稿被否，
  参照 SCP:SL 游戏内图标（`resources.assets` 的 `3114_Icon` / `079_Icon`，仅本地参照）重画。

## Requirements

- R1 重画爆头、自杀、闪光助攻图标；闪光助攻不再借用商店剪影。
- R2 致盲击杀：击杀者击杀瞬间处于闪光致盲时，在击杀者名字前画致盲图标（CS2 `attackerblind`）。自杀不画。
- R3 技能助攻：助攻来自闪光 / 173 污池 / 3114 勒颈 / 079 时，在 `+` 与助攻者之间画对应图标；伤害助攻只有 `+`。
- R4 七个图标风格统一：白色、24px 高、同线宽、负空间表达细节，无阴影。
- R5 未装 SLUI 的玩家：插件 Hint 文字版同样标出致盲与助攻种类。
- R6 兼容：已发布的 0.12.x SLUI 继续看到闪光助攻，新键不发给它；新旧插件 / sidecar 组合都不报错。

## Acceptance Criteria

- [x] 图标评审：用户看过 CS2 对照图与 1080p mock 击杀栏并认可七个图标（实现接线前完成）。
- [x] mock 截图（1920×1080）覆盖：每种助攻图标、致盲、爆头、自杀、致盲 + 技能助攻 + 爆头组合、本人击杀 / 阵亡底色、长名字。
- [x] 协议：`assist_kind` / `attacker_blind` 的正反例在 `contract-smoke` 与 backend 夹具中通过（与 `assisted_flash` 同时出现、
      无助攻者、自杀带修饰均被拒收）。
- [x] 插件：`dotnet test` 覆盖 173 / 3114 / 079 / 闪光 / 伤害助攻的种类选取、致盲判定、按能力写键（新能力写新键、
      只有旧能力写 `assisted_flash`、都没有则不写）、Hint 文字。
- [x] slui `npm test` / `lint` / `build:local` / `tauri:check`、backend `bun test`、插件 build（`RunAccessScan`）全过。
- [ ] slui PR 经用户视觉评审后才合并。

## Out of Scope

- 商店不卖的枪的武器图标（10-18 D3，仍走骷髅兜底）。
- 空中击杀、穿墙、未开镜、穿烟、复仇、压制。
- 删除 `assisted_flash` 兼容分支（等旧客户端淘汰后另做）。
- 部署插件 / sidecar 与实机测试（另行安排）。
