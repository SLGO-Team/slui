# Implement: 小地图包点 A/B

顺序按依赖：协议包是插件自检与 sidecar 校验的基准，先落地。插件、backend 的改动在各自仓库按其 Trellis 流程开配套任务（参照 10-01 v4 指挥官卡的三仓拆分），本任务负责 slui 部分并记录跨仓验收。

## 1. `@slgo/protocol`（slui/packages/protocol）
- [ ] `MINIMAP_SCHEMA_VERSION = 5`；`MinimapBombsite` 类型、`MinimapInit.bombsites`。
- [ ] `parseMinimapInit`：`MINIMAP_INIT_KEYS` 加 `bombsites`；新增 `MINIMAP_BOMBSITE_KEYS`；数组、≤26、`/^[A-Z]$/`、唯一、`isMinimapPlace`。
- [ ] `scripts/minimap-contract-smoke.mjs`：合法（A/B、空数组、room_id null）与非法（缺字段、重复字母、`"AB"`、小写、数字类型 label、非有限坐标、LCZ zone、多余键、非数组、27 项）。
- 回滚点：协议包单独提交。

## 2. slui 客户端
- [ ] `model.ts`：`resolved` 时校验包点 room/zone，不通过 `clearInit(..., "invalid")`；`selectMinimap` 输出 `bombsites: RadarBombsite[]`。
- [ ] `MinimapRadar.tsx` / `.css`：`BombsiteIcon`（A/B PNG + 黄色 wash + 阴影，C+ 文字），`data-edge` 两档 12px/0.4 与 18px/0.7，渲染在 keycard 与 marker 之前。
- [ ] 资产：在 `public/assets/minimap/` 提供 A/B 字母图，更新 `SOURCE-MAP.md`（来源、尺寸、CSS 依据、`.BombZone_OnMap` 推断说明）。
- [ ] Mock：`minimapFixtures.ts` 计算包点（939=A、Nuke=B），`rebuildMinimap` 重算；`?minimapBombsites=0` 空数组。
- [ ] `minimap-model-smoke.mjs`：包点投影、贴边、stale 后保留、新 init 替换、room/zone 不符 → invalid；`minimap-provider-smoke.mjs` 覆盖 mock 包点。
- [ ] `minimap-visual-audit.mjs`：断言包点 DOM 数量、位置、正立、edge 两档尺寸、层级在 marker 下。
- [ ] spec `minimap.md` 更新 v5 合同与渲染规则；`index.md` 描述改为 v5。

## 3. slgo-backend（配套任务）
- [ ] `protocol/ipc/v1/publish-minimap-init.example.json` 加 `bombsites`，positions 夹具版本 → 5；契约测试通过。

## 4. SLGO 插件（配套任务）
- [ ] `GeneratorSiteLayout.Resolve`；`GeneratorManager` 改用它。
- [ ] `MinimapInitPayload` + `MinimapBombsitePayload` 序列化；`SidecarConstants.MINIMAP_SCHEMA_VERSION = 5`；`EnsureMap` 计算并缓存；`BuildInit` 带上。
- [ ] 自检与 v5 解析器等价；单测：配置顺序、缺失房间不顺移、重复类型、非支持区域跳过、>26 项。

## 验证命令（slui）
```
npm run lint
npm test
npm run build:local
npm run dev:mock   # 预览后浏览器验证 + npm run minimap-visual-audit
```

## 风险
- 三仓需同批部署（v5 破坏性）；部署顺序：sidecar+slui 同版本协议包 → 插件。
- `.BombZone_OnMap` 两档是命名推断（用户已接受），若实机不符只改 CSS。
