# Implement: 小地图 v6（服务器下发真实布局）

顺序按依赖：协议包是 sidecar 校验与插件自检的基准，先落地；backend 夹具是插件 `IpcContractFixtureTests` 的唯一权威，其次；插件与 SLUI 客户端最后（互不依赖）。插件、backend 各在自己仓库建配套 Trellis 任务（PRD-only，引用本任务），本任务负责 slui 并记录跨仓验收。

## 0. 工作区（三仓各一个 worktree，同名分支 `claude/minimap-server-layout`，基于各自 main）

- slui：`slui/.claude/worktrees/minimap-server-layout`（已建）。
- SLGO：`SLGO/.claude/worktrees/minimap-server-layout`。测试时 `SLGO_BACKEND_DIR` 指向 backend worktree（`IpcFixtures.cs:19`）。
- slgo-backend：`slgo-backend/.claude/worktrees/minimap-server-layout`。先把 `.claude/worktrees/` 加进 `.git/info/exclude`（与另两仓一致）。workspace 依赖 `../slui/packages/protocol` 是相对路径，worktree 里需建目录联接 `slgo-backend/.claude/worktrees/slui` → slui worktree 根，再 `bun install`，确认 `node_modules/@slgo/protocol` 指向 slui worktree。

## 1. `@slgo/protocol`（slui）

- [x] `MINIMAP_SCHEMA_VERSION = 6`；新增 `MinimapRoom`、`MINIMAP_MAX_ROOMS = 256`、`MINIMAP_MAX_ROOM_TEXT_LENGTH = 64`；`MinimapInit` 改为 v6 字段（删除生成器/版本/种子/节日，加 `grid`、`rooms`）。
- [x] `parseMinimapInit`：键白名单；`grid` 有限正数；`rooms` 1..256，每项键白名单、`room_id`/`name`/`shape`/`prefab` 非空 ≤ 64、zone 两区、有限坐标、`yaw_degrees ∈ [0, 360)`；`room_id` 唯一；非 null 包点 `room_id` 必须存在且 zone 一致。
- [x] `v0/minimap-init.schema.json`、`minimap-positions.schema.json`（版本 6）、两份 example；`v0/README.md` 改为「Minimap payload v6」：新增 Layout (v6) 小节，`room_id` 语义改为「本 init 的 `rooms`」，删除生成器描述；`session.open` 示例版本。
- [x] `scripts/minimap-contract-smoke.mjs`：合法（示例、包点 room_id null、未知 name/shape/prefab 字符串）与非法（缺 `rooms`/`grid`、空 rooms、257 项、多余键、旧生成器字段、重复 room_id、空串/超长、yaw = 360、非有限坐标、LCZ zone、grid 0、包点引用不存在的房间、包点 zone 与房间不符、v5 版本号）。
- 回滚点：协议包单独提交。

## 2. slgo-backend（配套任务 `10-18-minimap-v6-fixtures`）

- [x] `protocol/ipc/v1/publish-minimap-init.example.json` 改 v6（用导出布局中的真实房间，包点 room_id 指向其中房间）；其余 minimap 夹具版本 5 → 6（共 21 个 JSON），保证每个 semantic invalid 仍因其原本原因被拒。
- [x] 新增 semantic invalid：重复 `room_id`、包点引用不存在的房间、空 `rooms`。
- [x] `protocol/ipc/README.md` 若有 v5 字样同步。
- [x] `bun run lint`、`bun test`。

## 3. SLGO 插件（配套任务 `10-18-minimap-v6-server-layout`）

- [x] `MinimapRoomTable` 重写：`FindObjectsOfType<AtlasZoneGenerator>()` → EZ/HCZ `Spawned` → `MinimapRoom` 列表 + `RoomIdentifier → room_id`；(zone, x, z) 排序编号；去重；失败/任一区为空 → 不可用并给出原因。纯规则（排序编号、yaw 规范化、自检）放可单测的静态类，游戏读取留在适配层。
- [x] 删除 `MinimapRoomIndex` 及其测试；`SidecarConstants` 删除 `MINIMAP_TEMPLATE_GAME_VERSIONS`、`MINIMAP_GAME_VERSION`、`MINIMAP_MAP_GENERATOR*`、`MINIMAP_MAP_SCHEMA_VERSION`，`MINIMAP_SCHEMA_VERSION = 6`，加房间上限/长度常量；`SidecarMinimapRules` 删除 `Holidays`/`IsSupportedHoliday`，`EvaluateAvailability` 只看「已生成 + 布局可用」，`BuildInit` 带 `grid`、`rooms`。
- [x] `MinimapInitPayload` v6 序列化 + `MinimapRoom` DTO；`Validate(MinimapInitPayload)` 与 v6 parser 等价。
- [x] `SidecarMinimapPublisher.EnsureMap`：布局读取失败 → 本代不发并 `Log.Warn`；「就绪」日志含房间数、种子、节日、游戏版本。
- [x] 测试：编号确定性与排序、yaw 规范化、去重/空区不可用、自检合法与非法（同 parser 列表）、v6 序列化字段精确、可用性不再受游戏版本影响、backend v6 夹具通过（`IpcContractFixtureTests`）。
- [x] 文档：`SLGO/Features/Sidecar/CLAUDE.md`、`.trellis/spec/plugin/sidecar-ipc.md`。
- [x] `dotnet build Slgo.sln -p:Configuration=Debug -p:Platform=x64 -p:RunAccessScan=true`（确认 `Spawned` / `ChosenCandidate` / `GridScale` 运行时可访问）、`dotnet test Slgo.Tests/Slgo.Tests.csproj -c Debug`。

## 4. SLUI 客户端

- [x] **先导出夹具，再删生成器**：一次性脚本（不入库）用 `vendor/map-seed` 导出 `src/mocks/minimap-layouts.json`：`1062329959/None`、`142007/None`、`1/Halloween`、`2147483647/Christmas` 的 EZ/HCZ 房间（v6 `MinimapRoom` 形状，按插件同一 (zone, x, z) 规则编号）+ `grid`，文件头注明来源。
- [x] `resolver.ts`：布局 → `MapGeometry`；删除生成器导入、`assertSupportedMap` 版本判断、`connections`/`connectors`/检查点配对；`mapDescriptorKey` 改为布局内容。
- [x] `room-artwork.ts` + `room-artwork.json`：`byPrefabName` → `byZoneShape`（D3 表）→ 不画；`diagnostics` 加 `unknown-room-artwork`；`PROVENANCE.json` manifest 哈希更新；`MinimapRadar.tsx` 跳过无美术的房间。
- [x] `model.ts`：删除 `resolved` 中的包点 room 校验（已在 parser）；`assertSupportedMap` 调用处随之调整。
- [x] Mock：`minimapFixtures.ts` 从布局夹具建 init，`minimapProvider.ts` 换图在两份布局间切换；`?minimapBombsites=0` 不变。
- [x] 删除 `src/features/minimap/vendor/map-seed/`；README 致谢改为「美术映射的预制体名清单取自 scpsl-map-seed 的 14.2.7 模板」；`SOURCE-MAP.md`、`rooms/PROVENANCE.md` 去掉布局来源于生成器的描述。
- [x] Smoke：`minimap-model-smoke.mjs` 去掉 vendor 哈希与生成器输出断言，几何断言（美术路径、边界、两种概览都装得下、检查点两半美术边界对齐）遍历静态夹具；新增降级用例（未知 prefab 用形状底图、未知形状不画且有诊断、未知 name 标题退回区域）。`minimap-provider-smoke.mjs`、`minimap-integration-smoke.mjs` 改用布局夹具（integration 里的换种子改为换布局）。
- [x] `src/platform/connection.ts` 宣告 `[6]`（随常量自动）；`backend-connection-smoke` 若断言 `[5]` 同步。
- [x] spec：`.trellis/spec/frontend/minimap.md`（v6 合同、美术降级、删除生成器钉版本段落）、`system-boundaries.md`（删除生成器基线与 14.2.7 段落，改为插件权威布局）、`index.md` 描述。

## 验证命令

```
# slui worktree
npm run lint
npm test
npm run build:local
npm run minimap-visual-audit   # 需要 dev:mock 预览，按脚本说明
# slgo-backend worktree
bun run lint
bun test
# SLGO worktree
dotnet build Slgo.sln -p:Configuration=Debug -p:Platform=x64 -p:RunAccessScan=true
SLGO_BACKEND_DIR=<backend worktree> dotnet test Slgo.Tests/Slgo.Tests.csproj -c Debug
```

## 合并与上线顺序（D2）

1. 三仓 worktree 分支各自测试通过后，按「slui → slgo-backend → SLGO」合并进本地 main（slui 推送远端由用户决定；SLGO、slgo-backend 无远端）。
2. 用户在人少时经 slgo-deploy TUI 发游戏机 release：插件与 `bin/slgo-sidecar` 同包上线（sidecar 编译时从本地 slui main 打包 v6 协议）。
3. 上线核对：插件日志「SLUI 小地图已就绪：…房间 N 个」两实例都出现、无「布局不可用」告警；sidecar 无 `minimap.init payload rejected`。
4. 用户紧接着构建并在 QQ 群发布新 SLUI 安装包；装上新版的玩家进服后雷达正常出现、房间美术完整。
5. 窗口期内未更新的玩家没有小地图（预期，D2）。

## 风险与回滚点

- 每仓 1 个以上独立提交；协议包提交是 sidecar 与插件的共同基准，最先完成。
- 实机预制体名若与美术表不符，雷达显示形状底图（D3），按插件日志或 SLUI 诊断补 `byPrefabName`，只需发 SLUI。
- 回滚 = 三仓 revert（回到写死版本号的 v5），不额外投入（「不做回退」偏好）。
