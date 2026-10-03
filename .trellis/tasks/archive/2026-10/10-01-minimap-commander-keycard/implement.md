# Implement — 小地图指挥官卡 / 己方箭头白色

执行顺序：协议（slui）→ backend 夹具 → 插件 → slui 渲染。本任务负责 slui（协议 + 渲染）和跨仓库验收；
SLGO 与 slgo-backend 的改动在各自仓库的 Trellis 任务中执行（实施时创建，PRD 引用本任务）。

## Step 1 — 箭头白色（slui，独立，可先做）
- [x] `src/features/minimap/MinimapRadar.css`：按 design §1 修改 heading / ghost 的选择器特异性。
- [x] 浏览器验证：`getComputedStyle(heading).filter === "none"`，截图。

## Step 2 — 协议 v4（slui `packages/protocol`）
- [x] `src/index.ts`：`MINIMAP_SCHEMA_VERSION = 4`；类型 `has_commander_keycard`、`MinimapKeycardDrop`、`commander_keycard_drop`；更新 key 集合；`parseMinimapPositions` 加上 design §2 的规则 1–4。
- [x] `v0/minimap-positions.schema.json`、`minimap-init.schema.json`、示例、`v0/README.md`（Minimap payload v4 一节）。
- [x] `scripts/minimap-contract-smoke.mjs` / `contract-smoke.mjs`：合法 v4 示例，以及每条新规则的非法样例。
- [x] 验证：`npm run` 对应的协议 / contract smoke 全绿。

## Step 3 — slgo-backend 夹具（`slgo-backend` 仓库任务）
- [x] `protocol/ipc/v1` 的 minimap 示例和 invalid 夹具升级到 v4；新增敌方持卡、双持卡人、持卡人与掉落卡并存三条 semantic invalid。
- [x] `tls.test.ts` 等处硬编码的 `[3]` 改为 `MINIMAP_SCHEMA_VERSION`。
- [x] `bun test` 全绿。

## Step 4 — 插件（`SLGO` 仓库任务）
- [x] `MinimapPlayerState.HasCommanderKeycard`，采集器填充。
- [x] 掉落卡采集 + `MinimapVisionProbe` 静态点目标 + `MinimapSpotRules` 点目标编排。
- [x] `SidecarMinimapRules.BuildFrame` / `Signature` / `Validate`，`IpcPayloads` 序列化，`MINIMAP_SCHEMA_VERSION = 4`。
- [x] `Slgo.Tests`：可见性矩阵（NTF 存活 / NTF 死亡 / SCP 有视野 / SCP 无视野 / 观察者 / 无阵营），持卡标志只出现在 live 己方 / observed，竞态时以持卡人为准，签名变化触发 revision 递增；IPC 契约夹具测试同步 backend 的 v4 夹具。
- [x] `dotnet test` 全绿。

## Step 5 — slui 渲染
- [x] `model.ts`：`authorizationKey` 纳入新字段；`validRooms` 检查掉落卡；视图模型 `keycardDrop`。
- [x] `camera.ts`：抽出 `clampToRadar`，`RadarMarker.hasKeycard`。
- [x] `MinimapRadar.tsx` / `.css`：持卡图标、掉落卡图标 + 脉冲圈（design §5）。
- [x] `src/mocks/minimapFixtures.ts` / `minimapProvider.ts`：mock 通过 `?minimapKeycard=carried|dropped` 展示两种状态（URL 参数切换，不自动轮换）。
- [x] `scripts/minimap-model-smoke.mjs` / `minimap-provider-smoke.mjs` 新增持卡 / 掉落断言；`minimap-integration-smoke.mjs` 未改动、在 v4 下仍通过。
- [x] 类型检查、lint、全部 smoke；浏览器预览：持卡、掉落、箭头 `filter: none` 已验证（掉落贴边只在 model smoke 中验证；脉冲圈只验证了计算样式，截图里不可辨）。

## Step 6 — 收尾
- [x] `.trellis/spec/frontend/minimap.md`（v4 契约、持卡与掉落规则）、`public/assets/minimap/SOURCE-MAP.md`（新增图标和脉冲圈来源，修正 heading 的描述）。
- [x] 跨仓库验收：插件 `IpcContractFixtureTests` 和 sidecar 契约测试使用同一批 v4 夹具通过。
- [ ] fake-plugin → sidecar → SLUI 实时端到端、真服视线 / 掉落物位置验证：未执行。

## 回滚点
- Step 1 可单独提交、单独回滚。
- Step 2–5 必须三端一起合并；回滚 = 三端一起回退到 v3 的提交。
