# Workspace Index - 23q3

> Journal tracking for AI development sessions.

---

## Current Status

<!-- @@@auto:current-status -->
- **Active File**: `journal-1.md`
- **Total Sessions**: 50
- **Last Active**: 2026-10-28
<!-- @@@/auto:current-status -->

---

## Active Documents

<!-- @@@auto:active-documents -->
| File | Lines | Status |
|------|-------|--------|
| `journal-1.md` | ~1192 | Active |
<!-- @@@/auto:active-documents -->

---

## Session History

<!-- @@@auto:session-history -->
| # | Date | Title | Commits | Branch |
|---|------|-------|---------|--------|
| 50 | 2026-10-28 | Game exit ends the SLUI game session | `265f7cf` | `fix/game-exit-lifecycle` |
| 49 | 2026-10-27 | Home Steam tile: avatar and persona name | `2d92010` | `feat/home-steam-profile` |
| 48 | 2026-10-26 | SLUI shop purchase refunds (CS2 sellback) | `0cad8c1` | `feat/shop-refund` |
| 47 | 2026-10-25 | CS2 team select menu | `176475e`, `3eb9cf1`, `d25778a`, `f04d455`, `2182b7f`, `484082b`, `8a16fa8` | `feat/team-select` |
| 46 | 2026-10-24 | Move windows-sys to 0.61 | `ad9eca3` | `build/windows-sys-0.61` |
| 45 | 2026-10-24 | CI gates: clippy, npm audit, pinned Rust, Dependabot npm | `a390b3c` | `ci/health-gates` |
| 44 | 2026-10-24 | SLUI health check and dependency refresh | `c131768` | `chore/deps-refresh` |
| 43 | 2026-10-23 | Cache the game-process check per window | `4f2d778` | `perf/foreground-process-cache` |
| 42 | 2026-10-23 | Drop unused library crate types | `96449a5` | `perf/drop-unused-crate-types` |
| 41 | 2026-10-23 | Size-optimised Rust release profile | `f98927c`, `cac013f` | `perf/rust-release-profile` |
| 40 | 2026-10-23 | Release builds without mock code | `3517aec`, `1d6c626` | `perf/release-without-mocks` |
| 39 | 2026-10-23 | Bundled fonts as WOFF2; branch cleanup | `1783dde`, `8e26f34` | `perf/woff2-fonts` |
| 38 | 2026-10-23 | Overlay clock out of the App root | `f7caa0c`, `aa4e0b0` | `perf/overlay-clock` |
| 37 | 2026-10-23 | 交互模式下移动的方案评估（结论：不做） | `e469cd2` | `feat/overlay-move-while-interactive` |
| 36 | 2026-10-22 | SCP teammate purchase requests in the SLUI shop | `ed3dedf`, `e96de8c` | `feat/shop-teammate-requests` |
| 35 | 2026-10-21 | CS2 spectator panel | `c8557d0`, `ff93e6a`, `7d706c3` | `feat/spectator-panel` |
| 34 | 2026-10-21 | World blur under the remaining HUD panels | `91901b5`, `aaa31ce`, `b4f76de`, `66dc0cc`, `8634bd1` | `feat/backdrop-panels` |
| 33 | 2026-10-21 | World blur: DWM spike rejected, own WGC blur for scoreboard and shop | `fd16504`, `bae7e51`, `87113a4`, `3512be4` | `feat/backdrop-blur` |
| 32 | 2026-10-20 | Scoreboard deploy, live test and launch-crash fix | `4f81954`, `4ee24e3`, `3f92954` | `feat/scoreboard` |
| 31 | 2026-10-20 | One-click auto-update (PR #43) | `700b65a`, `9943583`, `08755d7`, `6ea6e43`, `8c5b2ac`, `23c43d4`, `79b463c`, `f22057a`, `625d2cf` | `claude/busy-blackwell-bc6894` |
| 30 | 2026-10-19 | 16:10 and 4:3 overlay support | `0c424fc` | `feat/aspect-ratio` |
| 29 | 2026-10-14 | 实例结束原因端到端传给 SLUI | `2dea224` | `feat/instance-end-reason` |
| 28 | 2026-10-14 | ended 状态改为正在重启语义 | `715e6d5` | `fix/ended-restarting-copy` |
| 27 | 2026-10-13 | sidecar 经 Rust 层无 SNI 连接 | `dd48bf1` | `feat/sidecar-no-sni` |
| 26 | 2026-10-10 | Installer: one slui-setup compile | `240810e`, `17c084a` | `perf/installer-single-compile` |
| 25 | 2026-10-10 | CI build speed: slimmer debug info | `1de17ab`, `9795830` | `perf/ci-build-speed` |
| 24 | 2026-10-10 | Bottom HUD live test and odometer glyph fix | `3c17b4b`, `d442221` | `chore/archive-bottom-hud` |
| 23 | 2026-10-06 | Generator overload countdown | `db39284` | `feat/overload-countdown` |
| 22 | 2026-10-06 | CS2 HUD panels integration | `2cd1b57` | `chore/archive-cs2-hud-panels` |
| 21 | 2026-10-06 | CS2 generator progress card | `d8c5c97`, `4a3e21c` | `feat/hud-progress` |
| 20 | 2026-10-06 | CS2 HUD alerts and hints | `db8d14b` | `feat/hud-alerts` |
| 19 | 2026-10-05 | CS2 win panel | `f3f269f` | `feat/win-panel` |
| 18 | 2026-10-05 | CS2 HUD panels: planning + data channel | `855dfb2` | `feat/hud-data-channel` |
| 17 | 2026-10-05 | Branded uninstaller with optional theme pack / user data removal | `e09dd93` | `feat/uninstaller` |
| 16 | 2026-10-04 | CI、分支保护与 release-please 发版流程 | `da9fa11`, `0e21299` | `ci/release-workflow` |
| 15 | 2026-10-04 | 安装器界面重做与打包提速 | `d305d3d`, `f125bf1` | `main` |
| 14 | 2026-10-03 | 修复玩家时钟偏快导致商店永远禁购 | `a01c2d9`, `6773b60` | `main` |
| 13 | 2026-10-02 | 小地图包点 A/B 显示（payload v5） | `8b7d2c5` | `main` |
| 12 | 2026-10-02 | 商店热键关闭修复（输入穿透方案实机否决） | `e6c3c25` | `main` |
| 11 | 2026-10-02 | 主界面重做为 SLGO 启动器风格与 SLUI 图标 | `4b65e95` | `main` |
| 10 | 2026-10-01 | 小地图指挥官卡（CS2 C4）与己方箭头修正 | `eec26df` | `main` |
| 9 | 2026-10-01 | overlay 内存泄漏排查与修复 | `d626420` | `main` |
| 8 | 2026-10-01 | 小地图 payload v3 与 CS2 最后已知位置/死亡 X 渲染 | `14e0856`, `cf969be` | `main` |
| 7 | 2026-09-29 | 聊天接收闭环：chat.message / chat.notice 跨三仓库打通 | `2de7ff3` | `main` |
| 6 | 2026-09-28 | SLUI 聊天输入（CS2 还原）与后端默认值修正 | `19b8637`, `73dbaac` | `main` |
| 5 | 2026-09-27 | Connect SLUI to the real SLGO backend | `df64613`, `ee839df`, `a53d922` | `claude/nifty-pasteur-162d96` |
| 4 | 2026-09-27 | Extract @slgo/protocol and set licenses | `7b0d649` | `main` |
| 3 | 2026-09-17 | 雷达背景模糊校准与实像素验收 | - | `master` |
| 2 | 2026-09-12 | 雷达实机效果与配置接口 | - | `master` |
| 1 | 2026-09-07 | 实现小地图客户端与回归验收 | - | `master` |
<!-- @@@/auto:session-history -->

---

## Notes

- Sessions are appended to journal files
- New journal file created when current exceeds 2000 lines
- Use `add_session.py` to record sessions