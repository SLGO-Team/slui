# minimap payload v3 协议（最后已知位置与死亡标记）

## Goal
让小地图协议能表达 CS2 的「最后已知位置（红色 ?）」与「死亡 X」。状态机由 SLGO 插件权威计算，客户端只渲染。来源：SLGO 任务 `09-30-slui-minimap`（用户决策 2026-09-30：按 v3 跨仓库整体做）。

## Requirements
- 以 `research/minimap-v3-contract.md` 为需求：`minimap_schema_version = 3`（init 与 positions），`MINIMAP_SCHEMA_VERSION = 3`；marker 新增 `status`（live / last-known / dead）与 `status_age_ms`，删除 `is_alive`；删除 v2 解析分支（从未有生产对端）。
- 关系规则：last-known 仅敌方；live 年龄为 0；last-known < 6000；dead < 4000；self 的 live/dead 与 viewer.is_alive 一致；视点只能匹配 live 标记；死亡 viewer 不得有 spotted-by-self。
- schema、README「Minimap payload v3」、`src/index.ts` 解析器与类型、示例同步；SLUI reducer 的 authorizationKey 纳入 status（可放在渲染任务）。
- 行为依据：`research/cs2-last-known.md`。

## Acceptance Criteria
- [ ] schema 与解析器对 v3 合法示例通过、各类非法关系拒绝（含 last-known 用于己方、年龄越界、dead 作视点）。
- [ ] 协议测试全绿；slgo-backend 随后更新 IPC v1 minimap 夹具（其仓库任务）。

## Downstream
- slgo-backend：`09-30-minimap-v3-fixtures`；SLUI：`09-30-minimap-v3-render`；SLGO 插件：`09-30-slui-minimap`。
