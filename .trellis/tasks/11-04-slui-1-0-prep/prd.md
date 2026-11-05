# SLUI 1.0 前待办

## Goal

1.0 发版前把审查（2026-11-04 交接清单）里剩下的问题收尾，然后切 1.0.0。
本任务是父任务：存需求总表、子任务映射和跨子任务验收；实现都在子任务里。

## 维护者决定（2026-11-04）

- 范围：全部，按顺序分 PR 做。
- publisher / copyright / authors 统一写 **SLGO Team**。
- 依赖许可证文本用 cargo-about + license-checker 生成。
- 新增：解耦 scpsl-map-seed（slui 已不引用该 npm 包，只剩从它导出的数据和致谢）。
- 1.0.0 用 release-please-config.json 的 `release-as`，最后单独一个 chore PR；
  release PR 仍等维护者说「发版」才合并，1.0.0 发布后再开 PR 删掉 `release-as`。

## 子任务映射（按顺序，一个子任务一个 PR）

| 顺序 | 子任务 | 清单条目 |
|---|---|---|
| 0 | （父任务直接做）在 Windows 上验证 #94 并合并 | #94 |
| 1 | `11-04-security-csp-urls` | S1–S3 |
| 2 | `11-04-window-capabilities` | S4 |
| 3 | `11-04-updater-hardening` | S5、U1–U3 |
| 4 | `11-04-connection-liveness` | S6、C1–C2 |
| 5 | `11-04-installer-hardening` | I1–I4 |
| 6 | `11-04-shop-hotkeys-layout` | P1–P2 |
| 7 | `11-04-map-seed-decouple` | 新增 |
| 8 | `11-04-metadata-licenses-docs` | 决定 2–4、D1–D2 |
| 9 | （父任务直接做）release-as 1.0.0 chore PR | 决定 1 |

安全条目的细节写在各子任务的 PRD 里，随修复一起公开；这里不写。

## Constraints

- 仓库公开：任务文件里不写控制平面 host、真实 SteamID 或玩家名。
- PR 依次开：上一个合并后再从最新 main 开下一个分支（journal 冲突）。
- 改了画面的 PR 不开自动合并，等维护者看过；其他 PR 开 squash 自动合并。
- Rust 改动推送前跑 CI 的 clippy `-D warnings` 和 workspace 测试。

## Acceptance Criteria

- [ ] #94 的 Windows 检查完成（需要标准账户的那条由维护者自测），PR 已合并。
- [ ] 每个子任务的 PR 已合并，任务已归档。
- [ ] slui 不再含有从 scpsl-map-seed 导出的数据或对它的致谢。
- [ ] release-as 1.0.0 的 chore PR 已合并，release PR 标题变成 `chore(main): release 1.0.0` 并保持打开。

## 进度（2026-11-04 会话结束时）

- #94 本机验证（PR 分支 `ccr-3df2649c-99yyna`，本地构建）：
  - [x] `node scripts/build-installer.mjs --local` 编译通过（无 PREUNINSTALL 钩子）。
  - [x] 同版本重装：位置只读、无「浏览…」，DOM 强改被 reducer 还原；文件装回原目录，其他目录无残留。
  - [x] `uninstall.exe /S`：退出码 0，注册表项和 exe 删除，用户数据保留（主题包按设计保留）。
  - [x] 品牌卸载程序勾选「删除用户设置和数据」：当前用户的 Roaming/Local `com.slui.desktop` 被删。
  - [-] 标准账户 + 管理员凭据的场景：维护者决定跳过，#94 已于 2026-11-04 合并（80c785b）。
  - 测试后已装回官方 0.11.0 release 到 `D:\Program Files\SLUI`，用户数据已从 `D:\Temp\slui-94-backup` 还原。
- 调研结论（写进子任务设计时用）：
  - S2：protocol `parseRoute` 已要求 `wss://`；`ws://` 只来自开发覆盖 `VITE_DEV_SIDECAR_ENDPOINT`。
    `build:local`（`vite build --mode development`）的 dist 里含该覆盖，所以本地测试包确实用 ws://；Rust 端拒绝 ws:// 需要按构建区分（如 cargo feature `local-backend`，tauri:build:local 和 build-installer --local 传入）。
  - S1：Tauri 2.12 只给 script-src/style-src 注入 nonce/hash，不会自动加 `ipc:`；release.yml 构建时有 `VITE_CONTROL_PLANE_URL`，slgo-deploy 的 host/lib/render.sh 也构建 slui，两处都要注入 CSP 的控制平面 origin。
  - 前端网络/资源来源：route.ts fetch 控制平面；minimap 美术 fetch 同源；商店音效 `new Audio(theme URL)`；字体 `FontFace(theme URL)`；Steam 头像 data:image。
  - map-seed：插件 `MinimapRoomTable.Rebuild` 读 `AtlasZoneGenerator.Spawned`；全部预制体可从 `CompatibleRooms` + `HolidayVariants` 枚举（SLGO/artifacts/asc-decomp/MapGeneration）。
- 子任务 1 `11-04-security-csp-urls`（2026-11-04）：分支 `fix/csp-and-url-validation`。
  CSP 改为 Vite 从 `VITE_CONTROL_PLANE_URL` 生成 meta，构建入口（含 slgo-deploy 两个脚本）都不用改；
  安装器外壳的 CSP 记到 installer-hardening（I5）。
  PR #95 已合并（f99bb43）。
- 子任务 2 `11-04-window-capabilities`：分支 `fix/window-capabilities`。命令清单 `src-tauri/app-commands.rs` +
  AppManifest，capability 拆成 shared / home / overlay，`core:default` 收窄；CDP 实测每个窗口只能调自己的命令。
  PR #96 已合并（7a76b28）。
- 子任务 3 `11-04-updater-hardening`：分支 `fix/updater-hardening`。地址取自构建产物 `slui-build.json`，
  下载上限 150 MB，新版本失败回退到已验证的旧安装包，启动失败显示 unavailable，requireSignedVersion + `--app-version`。
- 2026-11-05：维护者决定 1.0.0 等数据系统完成后再发（第 9 步暂缓），其余子任务照常做。
- 子任务 4 `11-04-connection-liveness`：分支 `fix/connection-liveness`。Rust sidecar socket 10 s ping、25 s 无帧按 1006 断开，
  发送/关闭握手限时，队列 64、最多 2 个 socket；vdf 1 MiB / 8 层上限；身份轮询在要求更新期间不重试，
  稳定 live 只重置同一 attempt 的退避。
- 子任务 5 `11-04-installer-hardening`：分支 `fix/installer-hardening`。卸载有残留时照常完成并列出残留；
  `SLUI-Setup.exe /S` 静默安装；EstimatedSize 按整个目录；模板「删除应用数据」改由钩子以未提权用户身份删除；
  安装器外壳 CSP。本机实测全部通过，测后已还原官方 0.11.0。完成页有新提示，PR 等维护者看过再合并。
- 子任务 5 PR #100 已合并（1959ca3）。
- 子任务 6 `11-04-shop-hotkeys-layout`：分支 `fix/shop-refund-gate-and-key-layout`。reducer 按 stale 拦所有命令，
  beginCommand 同步返回是否接受、App 只发已接受的；单件退款看 `canRefund`。游戏 InputManager `m_UsePhysicalKeys` = false
  （按布局 VK 匹配），所以快捷键、ChatInput、商店 R/数字、选队 M/数字都改按 VK（keyCode，IME 229 回退 code）；Rust 不变。
- 子任务 6 PR #101 已合并（fe7a977）。
- 子任务 7 `11-04-map-seed-decouple`：分支 `chore/minimap-fixtures-from-game`。插件加 Debug 专用 `MinimapDevExport`
  （SLGO 本地合并 f4ac287），本机专用服务器导出 14.2.9 的预制体目录和四份布局，与旧夹具一致（仅浮点噪声）；
  README 致谢、PROVENANCE、spec 改为来自游戏导出。
- 下一步：子任务 8 `11-04-metadata-licenses-docs`。
