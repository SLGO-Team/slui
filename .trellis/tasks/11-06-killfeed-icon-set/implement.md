# Implement: 击杀栏图标整套重做

## Order

1. **图标草稿与评审（已完成 2026-11-06：第二稿通过，079 选摄像头 A1 下倾 28°）**
   - 核对用户 1080p 实拍（Steam screenshots 2026-10-05、录像 `2026.10.07 - 20.39.16.01.mp4`）里闪光助攻的 `+` 与图标。
   - 画 7 个 SVG 到 `public/assets/killfeed/`。
   - 出对照图（本地 `D:/Temp/slui-killfeed-ref/`）：CS2 原图 / 新图 24px 与放大；mock 击杀栏 1920×1080。
   - 交用户评审，按意见改，直到通过。
2. **slui 协议**（branch `feat/killfeed-icon-set`）
   - `packages/protocol/src/index.ts`：`HUD_KILLFEED_ASSIST_KINDS`、`assist_kind?`、`attacker_blind?`、
     `CLIENT_FEATURE_HUD_KILLFEED_MODIFIERS`；解析器规则（二选一、需助攻者、自杀不能有、只写 true）。
   - `packages/protocol/v0/hud-killfeed.schema.json`、`v0/README.md`。
   - `scripts/contract-smoke.mjs` 新增正反例。
3. **slui 渲染**
   - `features/killfeed/model.ts`（`assistKind`、`attackerBlind`，`assisted_flash` 映射为 flash）、`presentation.ts`、
     `KillFeed.tsx/.css`；`App.tsx` 能力列表把 `hud-killfeed-flash-assist` 换成 `hud-killfeed-modifiers`。
   - `src/mocks/hudScenes.ts`：每种修饰各一条；`scripts/killfeed-model-smoke.mjs` 更新。
   - spec：`.trellis/spec/frontend/cs2-visual-replication.md` 击杀栏节、`system-boundaries.md` 能力列表。
4. **slgo-backend**：协议依赖指向新 protocol；`protocol/ipc/v1` 夹具（valid：各 assist_kind、blind；invalid：
   两键同时、无助攻者、自杀带修饰）；`bun test`。
5. **SLGO 插件**：ledger kind、`AssistPick` 图标种类、致盲共用规则、`KillFeedEntry`、`SidecarKillFeedRules`
   （按能力写键、自检、指纹）、`SidecarConstants` 新能力、`KillFeedHintText` + 目录文案；`Slgo.Tests` 对应用例；
   spec `hud-semantic-model.md`、`sidecar-ipc.md`、`Features/Sidecar/CLAUDE.md`。
6. **验证与提交**：slui PR 等用户视觉评审后再合并；插件 / backend 本地合并（与以往相同，部署另行）。

## Validation

- slui：`npm test`、`npm run lint`、`npm run build:local`、`npm run tauri:check`；mock 截图（1920×1080）覆盖
  每种修饰、组合（致盲 + SCP 助攻 + 爆头）、本人击杀 / 阵亡底色、长名字。
- slgo-backend：`bun test`（sidecar）。
- 插件：`dotnet build Slgo.sln -p:Configuration=Debug -p:Platform=x64 -p:RunAccessScan=true`、`dotnet test`。
- finish-work 后再跑一次 `npm test`（公开仓库检查）。

## Risk / rollback points

- 协议是三仓共享契约：先合 slui 协议，backend 依赖更新后再动插件；插件必须在 sidecar 部署后才部署。
- 图标评审未过前不接数据，避免再次出现未评审就上线的图标。
