# 正式包剥离 mock 与地图模板懒加载

> **已被替代，未在本任务实施（2026-10-31 重测后归档）。** 本 PRD 依据的是过时快照（`23q3/slui` main，2026-10-03）。
> mock 剥离已由 #55「packages carry no mock code, debug panels or preview art」（归档任务 `10-23-release-without-mocks`）交付：
> `src/mocks/harness.ts` 由 `main.tsx` 仅在 mock 模式动态导入，`mock-boundary-check` 在 `npm test` 中守护。
> 地图模板懒加载的前提已不存在：自 #33（v6）起地图来自插件发送的房间布局，没有 345 KB 生成模板和生成器。
> 重测：正式包 `App-*.js` 199 KB，不含 mock 字符串。`design.md`、`implement.md` 一并作废。以下为原规划，仅作记录。

## Goal

正式（非 mock）构建的覆盖层不再包含、也不再执行任何 mock 数据与调试面板代码；345 KB 的地图生成模板和生成器不进入覆盖层主包，
在首次需要解析地图（收到 `minimap.init`）时才加载。`npm run dev:mock` 的预览、调试面板和视觉审计行为保持不变。

父任务：`10-31-overlay-perf`（基线见其 `research/perf-baseline.md`）。

## Background

- `src/App.tsx:7-33` 静态导入 `./mocks/provider`、`./mocks/HudDebugPanel`、`./mocks/ShopDebugPanel`、`./mocks/shopDebug`、`./mocks/hudDebug`、`./mocks/minimapFixtures`。
  只有 `src/App.tsx` 从应用代码引用 `src/mocks`（`scripts/minimap-provider-smoke.mjs`、`scripts/shop-model-smoke.mjs` 直接测试 mock 模块，不经过 App）。
- 生产构建实测：`App-*.js` 503 KB（gzip 66 KB），包含 mock 字符串（`map-demo-1`、mock 聊天内容）和 345 KB 模板；模块顶层执行 `createMockMinimapInit()`
  （`src/mocks/minimapFixtures.ts:110`），即启动时完整生成一次地图（Node 实测 10–22 ms）。
- `App.tsx:322-331` 的调试商店/HUD 状态（`mockShopSnapshotFor`、`createShopDebugState`、`createHudDebugState`）没有开关保护，正式环境每 250 ms 也计算一次。
- 正式环境用到了 mock 模块里的 `defaultMinimapPreviewOptions` 作为雷达选项初值（`App.tsx:72`）。
- mock 模式只由 Vite 模式决定：`readBackendConfig` 在 `MODE === "mock"` 时返回 mock 后端（`src/platform/backend.ts`），`vite.config.ts` 禁止构建 mock 模式。
- 地图解析：`model.ts` 从 `resolver.ts` 取值 `assertSupportedMap`、`mapDescriptorKey`；`useMinimapFeature.ts` 取 `mapDescriptorKey`、`resolveMinimap`（已是 async）；
  `resolver.ts` 顶层静态导入模板 JSON 与 `generator.js`。`camera.ts`、`dynamicZoom.ts`、`room-artwork.ts` 只做类型导入。
  Node 冒烟测试（`--experimental-strip-types`）直接导入 `resolver.ts` 并使用 `resolveMinimapSync`。

## Requirements

- R1 应用代码（`src/` 中除 `src/mocks/` 外）不得静态导入 `src/mocks/` 的任何值；类型导入允许。
- R2 mock 与调试代码只在 `import.meta.env.MODE === "mock"` 时由 `src/main.tsx` 动态加载，并以 props 交给覆盖层根组件；条件写成构建期常量，使正式构建不生成相关分块。
- R3 正式环境不执行任何调试/mock 计算：调试 HUD/商店状态、调试 URL 同步、mock 地图生成都只在 mock 模式下发生。
- R4 正式环境的雷达选项初值来自非 mock 模块（雷达默认偏好 + `alternateZoomActive: false`），与现在的 `defaultMinimapPreviewOptions` 中实际被正式环境使用的字段取值相同。
- R5 地图描述与校验（`mapDescriptorKey`、`assertSupportedMap`、几何类型）拆到不依赖模板的轻量模块；`resolveMinimap` 改为在调用时动态导入模板与生成器；
  `resolver.ts` 继续导出 `resolveMinimapSync` 及原有全部名字，现有测试与 mock 无需改导入。
- R6 `dev:mock` 行为不变：HUD/商店调试面板、URL 参数（`hudDebug`、`shopDebug`、`background`、`minimap*`、`shopOpen` 等）、`window.__SLUI_MINIMAP_DEBUG__`、预览背景与焦点模拟照常工作。
- R7 首页窗口（`label === "home"`）不加载 mock 分块。

## Acceptance Criteria

- [ ] 正式构建（`VITE_CONTROL_PLANE_URL=https://control.example.invalid npx vite build`）：覆盖层入口及其静态依赖分块中不含 `map-demo-1`、mock 聊天文本，也没有顶层 mock 地图生成调用；
      模板（可用 `HczCheckpointToEntranceZone` 标识）只出现在一个按需加载的分块中；`App-*.js` 体积 ≤ 基线 503 KB 的 50%。
- [ ] `dev:mock` 下雷达正常进入 `live`（经由新的懒加载 `resolveMinimap` 路径），调试面板可用，`__SLUI_MINIMAP_DEBUG__` 存在。
- [ ] `npm run minimap-visual-audit` 与 HUD/聊天审计脚本：在本环境能运行的，改动前后结论一致；不能运行的，在实施记录中说明原因。
- [ ] `npm run lint`、`npm test`、`npm run build:local` 通过。
- [ ] `.trellis/spec/frontend/quality-guidelines.md` 记录约定：应用代码只通过 `main.tsx` 的 mock 模式动态导入使用 `src/mocks`；`.trellis/spec/frontend/minimap.md` 记录模板懒加载与轻量描述模块。

## Out of Scope

- mock 数据、调试面板本身的功能变化。
- 首页窗口的分块优化。
- 把 `RealtimeMockProvider` 等 mock 实现改写或删除。
