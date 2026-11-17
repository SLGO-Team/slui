# Implement：成员槽位色按模式与人数

## 步骤

1. **协议（slui，本分支 `feat/minimap-team-colour-mode`，可先做）**
   - `packages/protocol/src/index.ts`：`MatchSnapshot` 加 `mode_family?` / `player_limit?`，`parseMatchSnapshot` 校验。
   - `packages/protocol/v0/README.md`、`match-snapshot.schema.json`、`match-snapshot.example.json`。
   - `scripts/contract-smoke.mjs`：合法 / 非法值、旧快照仍通过、backend 夹具解析。
2. **backend（slgo-backend，分支 `feat/match-snapshot-mode-family`）**
   - 夹具 + `protocol/ipc/README.md`；`bun test`。本地 `--no-ff` 合入 main（提交信息中文），不推送、不部署。
3. **插件（SLGO，分支 `feat/match-snapshot-mode-family`）**
   - `SidecarConstants`、`SidecarMatchSnapshotRules`（`ModeFamily`、`MatchSnapshotInput`）、`IpcPayloads.MatchSnapshotPayload`、
     `SidecarMatchSnapshotPublisher`；`Slgo.Tests` 单测与 `IpcContractFixtureTests`；`Features/Sidecar/CLAUDE.md`。
   - `dotnet build Slgo.sln -p:Configuration=Debug -p:Platform=x64`，`dotnet test Slgo.Tests/Slgo.Tests.csproj -c Debug`（需 backend 夹具已在 main）。
   - 本地 `--no-ff` 合入 main，不部署。
4. **等 #117 合入**：`git fetch && git rebase origin/main`（或从新 main 重开分支并带上步骤 1 的提交）。
5. **SLUI**
   - `hud/model.ts` 带入 `modeFamily` / `playerLimit`；`hud/presentation.ts` 加 `teammateColorRule`，改 `playerObserverNumbers`。
   - `App.tsx` 接线；`MinimapRadar.tsx`（自己的 wash、`--pack-wash`）；`HudTeamCounter.tsx`（边框回落）；`chat/presentation.ts` +
     `ChatInput.tsx`（无圆点）；`scoreboard/presentation.ts` + `Scoreboard.tsx` / css（无色圈）；`shop/presentation.ts`（灰色小点）。
   - mock：休闲快照参数。
   - 测试：`scripts/hud-model-smoke.mjs`（规则真值表、编号上限）、`scripts/minimap-model-smoke.mjs`、`contract-smoke`、
     聊天 / 商店 / 计分板相应 smoke；`scripts/minimap-visual-audit.mjs` 加休闲场景截图。
6. **检查**：`npm test`（含 typecheck / lint / smoke）、`npm run build`；Rust 未改则不跑 clippy。
7. **spec**：`.trellis/spec/frontend/minimap.md`（颜色规则段落，替换 #117 写的「SLUI 还不知道」）、HUD / chat / shop / scoreboard
   相关 spec；把 `research/cs2-teammate-colour-rule.md` 追加到 `archive/2026-11/11-17-minimap-cs2-slui/research/cs2-radar-client-re.md`。
8. **收尾**：`/trellis:finish-work` → 推送 → PR `feat(hud): follow CS2 teammate colour rule by game mode and player limit`；
   视觉类，不开 auto-merge，附 mock 截图（竞技 / 休闲对比），等用户评审。

## 校验命令

- slui：`npm test`、`npm run build`（node 在 fnm 路径）。
- SLGO：上面的 dotnet build / test。
- backend：`bun test`。

## 回滚点

- 每个仓库独立分支；SLUI 不合入则插件新字段无人使用，无副作用。
