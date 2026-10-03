# 后端选择：mock 需显式启用，默认连本机后端

## Goal

去掉“没配控制面地址就悄悄用 mock”的默认行为。mock 只能显式启用，且不能进入安装包；任何非 mock 的运行或构建都必须有控制面地址。

## 背景

- 现状（`src/platform/backend.ts`）：`VITE_CONTROL_PLANE_URL` 未设置 → mock。仓库没有 `.env` / `.env.development` / `.env.production`，所以 `npm run dev`、`npm run tauri dev`、`npm run tauri build` 默认都是 mock。
- 正式包里的 mock 控制面会把任何 Steam 用户路由到演示服，并在真实 SteamID 下展示假 HUD / 小地图 / 商店数据，玩家无从分辨。
- 用户反馈：默认带 mock 不合理。

## Requirements

- mock 只在 Vite mode 为 `mock` 时启用（`npm run dev:mock`）。mode `mock` 不能用于构建（`vite build --mode mock` 失败）。
- 非 mock mode 必须有合法的 `VITE_CONTROL_PLANE_URL`；缺失或非法时，`vite` 启动 / 构建阶段直接失败并给出中文/英文可操作提示，而不是运行时白屏或回退 mock。运行时 `readBackendConfig` 也不再返回 mock。
- 本地开发默认连本机开发后端：`.env.backend` 改名为 `.env.development`（含 `NODE_ENV=development`，使 `vite build --mode development` 产出开发构建，从而允许回环 `VITE_DEV_SIDECAR_ENDPOINT`）。
  - `npm run dev` / `npm run tauri dev` → 本机后端；移除 `dev:backend`、`tauri:backend`、`tauri.backend.conf.json`。
  - 新增 `npm run tauri:mock`（桌面端 mock 预览）。
  - 新增 `npm run tauri:build:local`：本机测试安装包（开发构建前端 + release Rust + NSIS）。
- `npm run build` / `npm run tauri build`（mode production）在未配置 `.env.production` 或环境变量前失败——目前没有正式控制面，这是预期。
- 更新 README、`.claude/launch.json`、`vite-env.d.ts`、spec（system-boundaries 配置条目）。

## Acceptance Criteria

- [x] `readBackendConfig`：mode `mock` → mock；其余缺 URL → 抛错；原有 URL / override 校验不变；smoke 覆盖。
- [x] `vite`（development）读 `.env.development` 连本机后端；`vite --mode mock` 仍是 mock 预览。
- [x] `vite build`（production，无配置）失败并提示；`vite build --mode mock` 失败；`vite build --mode development` 成功且 `DEV` 为 true。
- [x] `npm run tauri:build:local` 产出安装包。
- [x] `npm run lint`、`npm test`、`npm run tauri:check` 通过；README / spec 同步。
