# Implement：雷达说话喇叭

顺序按依赖排列：协议先行（backend 通过工作区链接读取 slui 的 `packages/protocol` 工作副本），然后是 backend 和插件，最后是 SLUI。
三个仓库各开一个分支；backend 和插件按惯例以 `--no-ff` 合入本地 main（提交信息用中文），不推送、不部署。

## 步骤

1. **协议（slui，分支 `feat/minimap-speaking`）**
   - `packages/protocol/src/index.ts`：加入 `MINIMAP_SPEAKING_SCHEMA_VERSION = 8`，`MINIMAP_SCHEMA_VERSIONS = [6, 7, 8]`；
     `MinimapPosition.speaking?`；`parseMinimapPositions` 按版本选择键集合，并校验 `speaking` 规则（design §1）。
   - `packages/protocol/v0/README.md`（新增 Speaking (v8) 一节，修改握手和 revision 说明）、`minimap-positions.schema.json`、
     v8 示例。
   - `scripts/minimap-contract-smoke.mjs`：覆盖 v8 合法帧、`speaking` 出现在 self / 敌人 / observed / 死亡标记上、
     v8 缺少该字段、v6 / v7 带该字段，以及 `MINIMAP_SCHEMA_VERSIONS` 的值。
2. **backend（slgo-backend，分支 `feat/minimap-speaking`）**
   - `apps/sidecar/src/hub.ts`：用 `forClient` 降级，替换 `accepts` 的两处调用（实时投递、连接后的缓存重放）。
   - `hub.test.ts`：覆盖 [6, 7] / [6, 7, 8] / [7] 三种客户端，实时投递和缓存重放都要测。
   - `protocol/ipc/v1` 夹具升到 v8（回放夹具保持 v7），新增 invalid 夹具；`protocol/ipc/README.md`。
   - `bun test`；本地 `--no-ff` 合入 main。
3. **插件（SLGO，分支 `feat/minimap-speaking`）**
   - `SidecarConstants`：`MINIMAP_SCHEMA_VERSION = 8`、`MINIMAP_SPEAKING_HOLD_MS = 200`。
   - 新增 `Features/Sidecar/Minimap/MinimapVoiceTracker.cs`（记录、修剪，把纯规则单独拆出来便于测试）；`SidecarMinimapPublisher`
     负责订阅、退订、修剪，并把 `isHearing` 传给组帧。
   - `MinimapWorldSnapshot.MinimapPlayerState.PlayerId`、`SidecarMinimapCollector` 填写它；`SidecarMinimapRules.BuildFrame` /
     `AddOwnTeam` / `Marker` / `Validate`；`IpcPayloads.MinimapPosition.Speaking` 和 v8 写出；`ReplayMinimapRules` 不需要改动
     （确认 v7 不写这个字段）。
   - `Slgo.Tests`：组帧、校验、修剪、IPC 夹具对比（需要步骤 2 的夹具已经在 backend main 上）。
   - 更新 `Features/Sidecar/Minimap/CLAUDE.md` 和 `Features/Voice/CLAUDE.md`。
   - `dotnet build Slgo.sln -p:Configuration=Debug -p:Platform=x64`、`dotnet test Slgo.Tests/Slgo.Tests.csproj -c Debug`；
     本地 `--no-ff` 合入 main。
4. **SLUI**
   - `public/assets/minimap/speaking-onmap.svg`、`speaking-offmap.svg`：按 design §4.2 的几何由 SLUI 自己绘制，填充色 `#68ac4b`。
   - `model.ts`（`RadarMarker.speaking`；`authorizationKey` 不变，加注释）、`resolver.ts`、`MinimapRadar.tsx`（滤镜、DOM 顺序、
     `data-speaking`）、`MinimapRadar.css`。
   - mock provider 与夹具（说话节奏、边缘说话的队友）。
   - `scripts/minimap-model-smoke.mjs`、`minimap-visual-audit.mjs`（新增说话场景）、`backend-connection-smoke.mjs`（期望 [6, 7, 8]）。
   - `public/assets/minimap/SOURCE-MAP.md` 新增一行。
5. **检查**：slui `npm test`、`npm run build`（node 在 fnm 路径）；没改 Rust，不跑 clippy。用 `trellis-check` 对照 spec 审查。
6. **spec**：`.trellis/spec/frontend/minimap.md`（说话规则、v8、降级）；`archive/.../cs2-radar-client-re.md` 已在规划阶段追加。
7. **收尾**：`/trellis:finish-work` → 重跑 `npm test`（public check）→ 推送 → PR
   `feat(minimap): show CS2 speaking icons for teammates on the radar`。这是视觉类 PR，不开 auto-merge，附 mock 截图
   （范围内和边缘），等用户评审颜色。PR 描述写明部署顺序：backend 先于插件。

## 校验命令

- slui：`npm test`、`npm run build`。
- backend：`bun test`。
- SLGO：上面的 dotnet build / test。

## 回滚点

- 协议和 SLUI 只在本分支，不合入就没有影响。
- 插件回滚到 v6 后，新 backend 和新 SLUI 都兼容；backend 不能先于插件回滚（design §5）。
