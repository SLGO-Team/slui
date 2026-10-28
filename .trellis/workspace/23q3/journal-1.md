# Journal - 23q3 (Part 1)

> AI development session journal
> Started: 2026-08-25

---



## Session 1: 实现小地图客户端与回归验收
<!-- trellis-session: v=2 fp=8c40139b9370c6d6 -->

**Date**: 2026-09-07
**Task**: 实现小地图客户端与回归验收
**Branch**: `master`

### Summary

已实现两区实时雷达、payload v2 与失败传播、15Hz mock、原生焦点接口；测试、构建及36场景截图通过，真实插件和Windows游戏联调待验。

### Main Changes

- 固定生成器、中文标签、死亡共享视野、两方向与计分板全图、stale清理。

### Git Commits

(No commits - planning session)

### Testing

- [OK] npm test、lint、build、Rust check/fmt/test及36场景浏览器审计通过。

### Status

[OK] **Completed**

### Next Steps

- 真实sidecar与Windows游戏联调；主界面设置接入单独任务。


## Session 2: 雷达实机效果与配置接口
<!-- trellis-session: v=2 fp=f19f5473291dae64 -->

**Date**: 2026-09-12
**Task**: 雷达实机效果与配置接口
**Branch**: `master`

### Summary

完成原小地图任务的11项偏好、圆方形与动态缩放接口、实机参考材质及地图内中文名移除。正式设置页后续交付。

### Main Changes

- 同区动态目标与渲染共用插值姿态，修复外区目标干扰恢复计时和新目标短暂贴边。

### Git Commits

(No commits - planning session)

### Testing

- [OK] npm test、lint、最终build、tauri:check通过；72个浏览器场景及材质像素比较、动态恢复连续采样通过。

### Status

[OK] **Completed**

### Next Steps

- 主界面任务接入已交付偏好接口；原生外部游戏背景模糊和既有游戏/服务端联调仍待验证。


## Session 3: 雷达背景模糊校准与实像素验收
<!-- trellis-session: v=2 fp=ee3aadaf56804eb1 -->

**Date**: 2026-09-17
**Task**: 雷达背景模糊校准与实像素验收
**Branch**: `master`

### Summary

将64px背景模糊施于共同雷达viewport，修复screen地图融合重新采样清晰场景；透明度0.63及地图marker清晰度保持。

### Main Changes

- 正式Chrome审计加入实际条纹对比度回归、可靠CDP关闭及隔离profile清理，避免旧headless与hash-only验证误判。

### Git Commits

(No commits - planning session)

### Testing

- [OK] npm test、lint/typecheck、build及72浏览器场景通过；两分辨率条纹对比度降低约84%，runtimeErrors为空。

### Status

[OK] **Completed**

### Next Steps

- 用户查看效果；原生外部游戏背景能力与既有服务端/Windows游戏联调仍未完成。


## Session 4: Extract @slgo/protocol and set licenses
<!-- trellis-session: v=2 fp=a0aa015e4bce25e7 -->

**Date**: 2026-09-27
**Task**: Extract @slgo/protocol and set licenses
**Branch**: `main`

### Summary

Agreed SLGO repo split (plugin / public slui / private slgo-backend in TS on Bun). Extracted wire contract from src/contracts into packages/protocol (@slgo/protocol, npm workspace, zero deps, ES-only tsconfig); src/contracts is now a facade re-exporting it plus client-only types; moved protocol/v0 into the package. Verified lint/test/build, Bun file: dependency smoke, mock preview. Licensed repo GPL-3.0-or-later with protocol package MIT so the closed backend can depend on it.

### Git Commits

| Hash | Message |
|------|---------|
| `7b0d649` | refactor: 提取 @slgo/protocol 协议包；仓库采用 GPL-3.0，协议包采用 MIT |

### Status

[OK] **Completed**


## Session 5: Connect SLUI to the real SLGO backend
<!-- trellis-session: v=2 fp=a79ce0a1339f53c3 -->

**Date**: 2026-09-27
**Task**: Connect SLUI to the real SLGO backend
**Branch**: `claude/nifty-pasteur-162d96`

### Summary

local-steamid sessions allowed (sidecar IP binding is the authority); HttpControlPlane (POST /v0/route, rejection mapping, backoff for not-in-game/rate-limited); WebSocketSidecarConnection with session.open handshake and close-code mapping, sharing SidecarEventIntake with the mock; session retry policy; VITE_CONTROL_PLANE_URL config with dev-only loopback VITE_DEV_SIDECAR_ENDPOINT; backend-connection-smoke with fake fetch/WebSocket; local E2E against slgo-backend dev servers passed. Known gap: fake plugin publishes shop.snapshot once, so the shop goes stale after 5 s.

### Git Commits

| Hash | Message |
|------|---------|
| `df64613` | feat(protocol): local-steamid 会话改由 sidecar IP 绑定授权；新增 not-in-game/rate-limited 错误码 |
| `ee839df` | feat: 接入真实 SLGO 后端（控制面客户端、sidecar WebSocket、共享 intake、自动重试） |
| `a53d922` | chore(task): 09-27-real-backend-connection 规划与验证记录 |

### Status

[OK] **Completed**


## Session 6: SLUI 聊天输入（CS2 还原）与后端默认值修正
<!-- trellis-session: v=2 fp=798542bcb35630a3 -->

**Date**: 2026-09-28
**Task**: SLUI 聊天输入（CS2 还原）与后端默认值修正
**Branch**: `main`

### Summary

聊天输入：Y 全体/U 团队、Tab 切换、120 字上限、Esc/失焦/点外面关闭（保留草稿）、失败原因与本人回显进历史行；按 CS2 hudchat 源码+实机截图还原面板（Noto Sans SC 0.9 倍、SLGO 阵营色、历史区与输入行 #00000099、CSS 淡出），chat-layout-audit 1920/1600/1280 通过。覆盖层键盘焦点：set_overlay_keyboard_focus（SetForegroundWindow → 空鼠标 SendInput → AttachThreadInput），不再显式 webview set_focus（会造成焦点抖动）。吞键根因：键盘钩子自行跟踪 key-up，前台切换时丢失 key-up 会吞掉下一次按键；改为在 LL 钩子回调内用 GetAsyncKeyState 判定连发，钩子线程 time-critical，事件携带按下瞬间 game_foreground。后端默认值：mock 仅 --mode mock 且不可打包，非 mock 缺控制面地址即报错；.env.backend → .env.development，新增 build:local / tauri:mock / tauri:build:local。实机验证通过。另在 SLGO 仓库建了 09-28-slui-presence 任务（插件感知 SLUI 以解决 Y 键冲突），聊天消息接收（08-25-chat 剩余部分）待插件推送 chat.message。

### Git Commits

| Hash | Message |
|------|---------|
| `19b8637` | feat: 聊天输入（CS2 hudchat 还原、Y 全体/U 团队、覆盖层键盘焦点与防吞键快捷键） |
| `73dbaac` | chore: 后端选择改为显式 mock，默认连本机后端；新增 build:local / tauri:mock / tauri:build:local |

### Status

[OK] **Completed**


## Session 7: 聊天接收闭环：chat.message / chat.notice 跨三仓库打通
<!-- trellis-session: v=2 fp=0a3adbc46f5c1e3f -->

**Date**: 2026-09-29
**Task**: 聊天接收闭环：chat.message / chat.notice 跨三仓库打通
**Branch**: `main`

### Summary

协议新增 ChatMessage.command_id 与 chat.notice，SLUI 跳过未知事件类型；SLUI 聊天模型按实例隔离、按 id 去重、服务端消息原位替换本地回显，他人行与本人同格式着色、系统提示按色调渲染。slgo-backend d89e022：sidecar 转发 chat.notice、受众测试、fake-plugin 聊天演示、decisions 记录不做握手协商。SLGO 2ec61a4：ChatManager 投递即转发，受众同游戏内收件人，HUD 转义挪到渲染层。端到端（control-plane/sidecar/fake-plugin/npm run dev）验证通过；同实例重连仅单测覆盖，chat-layout-audit 与真服未跑。

### Git Commits

| Hash | Message |
|------|---------|
| `2de7ff3` | feat(chat): 接收 chat.message / chat.notice，去重、按实例隔离并替换本地回显 |

### Status

[OK] **Completed**


## Session 8: 小地图 payload v3 与 CS2 最后已知位置/死亡 X 渲染
<!-- trellis-session: v=2 fp=6895eb5d173f95b1 -->

**Date**: 2026-10-01
**Task**: 小地图 payload v3 与 CS2 最后已知位置/死亡 X 渲染
**Branch**: `main`

### Summary

协议 v3：marker 以 status/status_age_ms 取代 is_alive，新增 observed（插件观察授权，无阵营 viewer 只收 observed，视点可跟随被观察者），status 纳入授权签名；渲染最后已知红色问号 6 s、死亡 X 4 s 线性淡出（CS2 原图标），不插值不作相机目标；队友与本人使用与 HUD/聊天同源的 CS2 五色标识（playerSlotColors），对面为红色；mock 预览 minimapLastKnown/minimapDeaths；smoke 覆盖 v3 关系、淡出、观察跟随与五色取色

### Git Commits

| Hash | Message |
|------|---------|
| `14e0856` | feat(minimap): 小地图 payload v3 并按 CS2 渲染最后已知位置与死亡 X |
| `cf969be` | chore(task): 09-30-minimap-v3-protocol 与 09-30-minimap-v3-render |

### Status

[OK] **Completed**


## Session 9: overlay 内存泄漏排查与修复
<!-- trellis-session: v=2 fp=2c264b22861c1649 -->

**Date**: 2026-10-01
**Task**: overlay 内存泄漏排查与修复
**Branch**: `main`

### Summary

overlay renderer 2.5h 涨到 4GB：React 19.2 开发版对 props 变化的重渲染写 performance.measure（约1KB/条，缓冲区不清），叠加小地图 32ms 时钟无条件驱动全树重渲染。修复：时钟仅在有位置帧时运行；DEV 每 10s clearMeasures；spec 记录规则。

### Git Commits

| Hash | Message |
|------|---------|
| `d626420` | fix(overlay): 小地图时钟仅在有位置帧时运行，开发版定期清理 React User Timing 条目 |

### Status

[OK] **Completed**


## Session 10: 小地图指挥官卡（CS2 C4）与己方箭头修正
<!-- trellis-session: v=2 fp=d004b52bc9a77f8f -->

**Date**: 2026-10-01
**Task**: 小地图指挥官卡（CS2 C4）与己方箭头修正
**Branch**: `main`

### Summary

minimap payload v4：持卡人标记（含被发现的敌方持卡人，随持有人着色、敌方红色）、commander_keycard 雷达物品（掉落 / 发电机安放 / 失去视野 8 秒淡出，CS:GO sfhudradar BOMB_FADE_TIME）、team_id 敌我着色；己方朝向箭头去染色、9px 按原图轴线 translate 居中。跨仓库：SLGO c68c8f9、slgo-backend c73034c。实机验证了发电机视线（根节点贴地被地板挡，改机身多点），其余真服链路待验证。

### Git Commits

| Hash | Message |
|------|---------|
| `eec26df` | feat(minimap): 小地图显示指挥官卡（payload v4），修正己方朝向箭头 |

### Status

[OK] **Completed**


## Session 11: 主界面重做为 SLGO 启动器风格与 SLUI 图标
<!-- trellis-session: v=2 fp=2f8a829fd1faa2da -->

**Date**: 2026-10-02
**Task**: 主界面重做为 SLGO 启动器风格与 SLUI 图标
**Branch**: `main`

### Summary

归档 08-25-slui-mvp 全部子任务与 bootstrap；logo 素材整理进 SLGO-assets/brand。新任务 10-02-app-home-redesign：主窗口改为自绘标题栏 + 左导航（首页 / 设置）的启动器风格，SLGO 配色，仅用 OFL 字体（禁 Stratum2 / DIN Next）；SLUI 图标（HUD 括号 + SCP 收容三箭头）生成全套 Tauri 图标；用户可见「覆盖层」统一为「UI」（含托盘）；首页 UI 主开关以品牌美术为主视觉并加启用动画（按钮排空、扫描线、依次点亮、中心脉冲，仅用户点击触发）。修复 SVG transform-box view-box 下 50% 原点落在右下角导致的动画偏移；spec 记录窗口外框、字体、图标生成与动画约定。Windows 实机窗口与回归清单用户已验证；托盘文案改动在实机验证之后。

### Git Commits

| Hash | Message |
|------|---------|
| `4b65e95` | feat(home): 主界面重做为 SLGO 启动器风格，新增 SLUI 图标 |

### Status

[OK] **Completed**


## Session 12: 商店热键关闭修复（输入穿透方案实机否决）
<!-- trellis-session: v=2 fp=7a8c46cf9d62c189 -->

**Date**: 2026-10-02
**Task**: 商店热键关闭修复（输入穿透方案实机否决）
**Branch**: `main`

### Summary

用户希望开商店时可走路、B 可关闭商店。实机验证：WH_MOUSE_LL 挡不住 Unity Raw Input 鼠标移动，PostMessage 转发按键给后台游戏窗口无效，输入穿透方案放弃，维持商店抢前台。诊断日志定位 B 关不掉根因：覆盖层持有前台时搜狗中文输入法在低级钩子前吞掉按键；改为页面 keydown 也上报商店键与 Y/U，商店键仅在游戏前台时打开以保证幂等。spec 记录规则与否决结论。

### Git Commits

| Hash | Message |
|------|---------|
| `e6c3c25` | fix(shop): 商店持有前台时商店热键可关闭商店 |

### Status

[OK] **Completed**


## Session 13: 小地图包点 A/B 显示（payload v5）
<!-- trellis-session: v=2 fp=6811609052a7f3bc -->

**Date**: 2026-10-02
**Task**: 小地图包点 A/B 显示（payload v5）
**Branch**: `main`

### Summary

照 CS2 BombZoneA/B 在小地图显示插件下发的包点：minimap payload v5（init.bombsites），包点随底图生命周期，范围内 12px/0.4、贴边 18px/0.7；配套 slgo-backend 夹具与 SLGO 插件 GeneratorSiteLayout，用户实机验证通过

### Git Commits

| Hash | Message |
|------|---------|
| `8b7d2c5` | feat(minimap): 小地图显示 CS2 风格 A/B 包点（payload v5） - 协议：minimap payload v4 → v5，minimap.init 新增必填 bombsites [{label, x, y, z, zone, room_id}]；label 单个大写字母且唯一、≤26、白名单字段 - 包点与底图同生共灭：resolved 时校验 room 属于 zone 后随 geometry 提交； 断线 / 过期 / 无效帧时随底图保留，丢底图的路径统一用 NO_MAP - 渲染照 CS2 BombZoneA/B：#ffcc00 染色 + 黑描边、始终正立、复用标记贴边投影； 范围内 12px / 0.4（.BombZone_OnMap），贴边 18px / 0.7（.BombZone）； 画在指挥官卡与玩家标记之下；C 及以后用同风格文字 - mock 按插件默认配置给出 939=A、核弹房=B，?minimapBombsites=0 发空数组 - 契约 / 模型 / provider smoke 与视觉审计覆盖；spec 与 SOU |

### Status

[OK] **Completed**


## Session 14: 修复玩家时钟偏快导致商店永远禁购
<!-- trellis-session: v=2 fp=63ae343621f6fd42 -->

**Date**: 2026-10-03
**Task**: 修复玩家时钟偏快导致商店永远禁购
**Branch**: `main`

### Summary

汐纳反馈商店点击有声音但买不了；selectShop 用服务器 sent_at 对比本机时钟，玩家时钟快 5 秒以上即永远 stale。陈旧判定与 HUD 倒计时改为只用本机接收时间，玩家同步时间后确认。

### Main Changes

- shop/hud 陈旧判定只看 now - receivedAtMs
- HUD 倒计时不再扣 receivedAt - sent_at 传输时间
- spec system-boundaries 记录 sent_at 不与本机时钟比较

### Git Commits

| Hash | Message |
|------|---------|
| `a01c2d9` | fix(shop,hud): 陈旧判定与倒计时只用本机接收时间 |
| `6773b60` | docs(spec): sent_at 不与本机时钟比较 |

### Testing

- [OK] shop/hud smoke 新增 ±60s 时钟偏差回归测试（旧代码失败）；npm run lint、npm test 通过

### Status

[OK] **Completed**

### Next Steps

- 构建新 SLUI 安装包分发给玩家


## Session 15: 安装器界面重做与打包提速
<!-- trellis-session: v=2 fp=6fa6f4465dfc7edb -->

**Date**: 2026-10-04
**Task**: 安装器界面重做与打包提速
**Branch**: `main`

### Summary

安装器外壳界面重做：去掉独立位置页，首装页内嵌安装位置与开始菜单/桌面两个独立快捷方式开关（startMenuShortcut 贯通到 NSIS /SLUI-STARTMENU），单列居中布局，去掉标题栏改为悬浮窗口控件+空白处拖动，窗口 640x440；真机验证通过。打包：新增 installer:build:shell 复用 NSIS 包只重编外壳（约 40s），外壳与 SLUI 共用 src-tauri/target。

### Git Commits

| Hash | Message |
|------|---------|
| `d305d3d` | refactor(home): 品牌色与字体令牌抽到 src/shared/brand-tokens.css |
| `f125bf1` | feat(installer): 品牌化安装器外壳 SLUI-Setup |

### Status

[OK] **Completed**


## Session 16: CI、分支保护与 release-please 发版流程
<!-- trellis-session: v=2 fp=5dc29afc38f6a233 -->

**Date**: 2026-10-04
**Task**: CI、分支保护与 release-please 发版流程
**Branch**: `ci/release-workflow`

### Summary

PR CI（build-and-test、pr-title）、main Ruleset、release-please 草稿发版加安装器上传、版本一致性检查、build-installer --theme-pack、CONTRIBUTING；试验 PR https://github.com/SLGO-Team/slui/pull/1 的检查和直推拒绝已验证，试验发版待合并后进行

### Git Commits

| Hash | Message |
|------|---------|
| `da9fa11` | feat(installer): add --theme-pack option to build-installer |
| `0e21299` | ci: add PR checks, release-please release workflow and contribution guide |

### Status

[OK] **Completed**


## Session 17: Branded uninstaller with optional theme pack / user data removal
<!-- trellis-session: v=2 fp=7d5ffd9555cffa30 -->

**Date**: 2026-10-05
**Task**: Branded uninstaller with optional theme pack / user data removal
**Branch**: `feat/uninstaller`

### Summary

slui-uninstall.exe (installer crate, uninstaller feature) registered as UninstallString; toggles for theme pack and user data (default keep); temp relocation + /SLUI-CLEANUP reboot deletion; theme pack moved from bundle.resources to NSIS hook File /r; E2E verified on dev PC except UAC-decline (ConsentPromptBehaviorAdmin=0).

### Git Commits

| Hash | Message |
|------|---------|
| `e09dd93` | feat(installer): add a branded uninstaller with optional theme pack removal |

### Status

[OK] **Completed**


## Session 18: CS2 HUD panels: planning + data channel
<!-- trellis-session: v=2 fp=ca38ff002fcb99ef -->

**Date**: 2026-10-05
**Task**: CS2 HUD panels: planning + data channel
**Branch**: `feat/hud-data-channel`

### Summary

Planned CS2 HUD panels (win panel+MVP, message zone, generator progress) as parent task 10-05-cs2-hud-panels with 4 children, using local CS2 reference captures. Delivered hud-data-channel: @slgo/protocol hud.messages/round.result + mock scenes (slui 855dfb2), sidecar relay with replay age adjustment (slgo-backend d77a68b), plugin publisher (SLGO 561ca78).

### Git Commits

| Hash | Message |
|------|---------|
| `855dfb2` | feat(protocol): add hud.messages and round.result events with mock scenes |

### Status

[OK] **Completed**


## Session 19: CS2 win panel
<!-- trellis-session: v=2 fp=95a49ccca617749c -->

**Date**: 2026-10-05
**Task**: CS2 win panel
**Branch**: `feat/win-panel`

### Summary

Implemented 10-05-win-panel: WinPanel feature (model/presentation/component), SLUI-drawn assets, model smoke + layout audit script, hudSceneAt mock freeze, win-panel feature declared; verified mock scenes visually at 1920x1080.

### Git Commits

| Hash | Message |
|------|---------|
| `f3f269f` | feat(winpanel): render the CS2 round result panel with MVP |

### Status

[OK] **Completed**


## Session 20: CS2 HUD alerts and hints
<!-- trellis-session: v=2 fp=f091361fd609b453 -->

**Date**: 2026-10-06
**Task**: CS2 HUD alerts and hints
**Branch**: `feat/hud-alerts`

### Summary

Rendered the CS2 bottom-centre message zone (alert, high and low hints) from hud.messages: shared reducer/selector, geometry and colours matched to 1080p captures, motion measured from the in-game recording incl. FlashAnim; layout audit and model smoke; PR #16 approved visually.

### Git Commits

| Hash | Message |
|------|---------|
| `db8d14b` | feat(hudmessages): render CS2 bottom-centre alerts and hints |

### Status

[OK] **Completed**


## Session 21: CS2 generator progress card
<!-- trellis-session: v=2 fp=767a665c6f7e5f65 -->

**Date**: 2026-10-06
**Task**: CS2 generator progress card
**Branch**: `feat/hud-progress`

### Summary

Rendered CS2's defuse card for generator start/shutdown from the hud.messages progress slot (anchored CSS timeline, colours, glow, icon by generator upgrade, success zoom), measured from the recording; declared hud-messages; denser message-zone/progress fills since the overlay cannot blur the game. PR #17 approved.

### Git Commits

| Hash | Message |
|------|---------|
| `d8c5c97` | feat(hudmessages): render the CS2 generator progress card and take over the message zone |
| `4a3e21c` | fix(hudmessages): denser message-zone and progress fills in place of the world blur |

### Status

[OK] **Completed**


## Session 22: CS2 HUD panels integration
<!-- trellis-session: v=2 fp=a8a1df34fd338d49 -->

**Date**: 2026-10-06
**Task**: CS2 HUD panels integration
**Branch**: `chore/archive-cs2-hud-panels`

### Summary

Parent integration review of the CS2 HUD panels: all children merged, live test on production passed with a SLUI main build, capture cfg deleted, parent archived.

### Git Commits

| Hash | Message |
|------|---------|
| `2cd1b57` | feat(hudmessages): render the CS2 generator progress card and take over the message zone (#17) |

### Status

[OK] **Completed**


## Session 23: Generator overload countdown
<!-- trellis-session: v=2 fp=8519e2c55204a4f9 -->

**Date**: 2026-10-06
**Task**: Generator overload countdown
**Branch**: `feat/overload-countdown`

### Summary

Generator-started hint moved to the high slot (as CS2 bomb planted) and followed by a standing 'N seconds to overload' countdown in the same slot; new {seconds_remaining} wire token across slui protocol, backend fixtures (691b61b) and plugin (0aec80d). Live test passed.

### Git Commits

| Hash | Message |
|------|---------|
| `db39284` | feat(hudmessages): draw the seconds countdown token and script the overload countdown |

### Status

[OK] **Completed**


## Session 24: Bottom HUD live test and odometer glyph fix
<!-- trellis-session: v=2 fp=8e3faeca202cfb41 -->

**Date**: 2026-10-10
**Task**: Bottom HUD live test and odometer glyph fix
**Branch**: `chore/archive-bottom-hud`

### Summary

Deployed backend 9eb724c + plugin b70cb81 (release 20261010-110008), built production SLUI; a 'can't connect' scare was the client PC's proxy in global mode. Live test passed; with the theme pack Stratum2's $ ink overflowed its 1em strip row by 1px and showed as a dash above 0 — each odometer symbol now clips to its row (#23). Spec notes the stacked-glyph rule; task 10-07 archived.

### Git Commits

| Hash | Message |
|------|---------|
| `3c17b4b` | fix(bottomhud): clip each odometer symbol to its row (#23) |
| `d442221` | docs(spec): clip stacked glyph rows; record the bottom HUD live test |

### Status

[OK] **Completed**


## Session 25: CI build speed: slimmer debug info
<!-- trellis-session: v=2 fp=82d494d742d4b6e4 -->

**Date**: 2026-10-10
**Task**: CI build speed: slimmer debug info
**Branch**: `perf/ci-build-speed`

### Summary

Measured CI/release build time (LLVM in final Tauri crates dominates; rustc knobs rejected). CI: CARGO_PROFILE_DEV_DEBUG=line-tables-only halves the Rust cache (836->399 MB), restore 54->21-33s, cargo test 38->28s; hakari check costs <3s, its 27s was dependency unpacking, so it stays. Planned child 10-10-installer-single-compile (one slui-setup compile, overlay payload).

### Git Commits

| Hash | Message |
|------|---------|
| `1de17ab` | perf(ci): slimmer debug info for the CI Rust cache |
| `9795830` | docs(spec): record where CI's Rust time goes |

### Status

[OK] **Completed**


## Session 26: Installer: one slui-setup compile
<!-- trellis-session: v=2 fp=f9bec3e5f1452b9e -->

**Date**: 2026-10-10
**Task**: Installer: one slui-setup compile
**Branch**: `perf/installer-single-compile`

### Summary

slui-setup is compiled once; build-installer.mjs appends an overlay (role, version, required bytes, NSIS payload) to make slui-uninstall.exe and SLUI-Setup. overlay.rs reads it; runtime role; uninstaller feature, RCDATA payload and slui_setup_no_payload removed. Local installer build 117s with one slui-setup compile; live install/uninstall test passed. Release-job timing to confirm on next release (baseline 309s).

### Git Commits

| Hash | Message |
|------|---------|
| `240810e` | perf(installer): build slui-setup once for the installer and the uninstaller |
| `17c084a` | docs(task): record the single-compile installer outcome |

### Status

[OK] **Completed**


## Session 27: sidecar 经 Rust 层无 SNI 连接
<!-- trellis-session: v=2 fp=e7d1b1acd3b2faa2 -->

**Date**: 2026-10-13
**Task**: sidecar 经 Rust 层无 SNI 连接
**Branch**: `feat/sidecar-no-sni`

### Summary

sidecar WebSocket 移到 Rust（rustls、enable_sni=false、webpki-roots 按主机名校验），前端 TauriSidecarSocket 适配 WebSocketLike，connection.ts 语义不变；Rust 测试覆盖无 SNI、主机名不匹配、关闭码；实网探测与群内自测版实机连上游戏主机 sidecar。

### Git Commits

| Hash | Message |
|------|---------|
| `dd48bf1` | feat(sidecar): 经 Rust 层不发 SNI 连接 sidecar |

### Status

[OK] **Completed**


## Session 28: ended 状态改为正在重启语义
<!-- trellis-session: v=2 fp=099cd16d08040a2d -->

**Date**: 2026-10-14
**Task**: ended 状态改为正在重启语义
**Branch**: `fix/ended-restarting-copy`

### Summary

ended 文案改为 正在重启 / 服务器重启后自动重连 与 SERVER RESTARTING；评估后不加长时间计时器（quiet reroute 约 15 s 内转为新实例 / not-in-game / offline）；按关闭原因区分需改协议，另建规划任务 10-14-goodbye-reason-to-slui；更新 system-boundaries spec 与 hud 冒烟测试

### Git Commits

| Hash | Message |
|------|---------|
| `715e6d5` | fix(session): show an ended server instance as restarting |

### Status

[OK] **Completed**


## Session 29: 实例结束原因端到端传给 SLUI
<!-- trellis-session: v=2 fp=9d06794a73979c89 -->

**Date**: 2026-10-14
**Task**: 实例结束原因端到端传给 SLUI
**Branch**: `feat/instance-end-reason`

### Summary

新增 v0 instance.ended { reason }（4003 前发送，开放枚举）；SLUI 连接层记录原因、会话层在 reroute / not-in-game 期间保持，主页与 HUD 按原因显示（正在重启 / 服务器已关闭 / 已停止 / SLGO 已停用 / 失联）。跨仓库：slgo-backend 989ac3d（goodbye 原因与 exit-intent 能力、instance.ended、replaced=server-restart、linger=lost），SLGO a708c3c（游戏发给 LocalAdmin 的退出动作截取、StopNextRound + restart_after_rounds、slgo-exit-intent 指令），slgo-deploy 562e134（slgoctl 停服前声明意图）。部署顺序 sidecar 先于插件。

### Git Commits

| Hash | Message |
|------|---------|
| `2dea224` | feat(session): show why a server instance ended |

### Status

[OK] **Completed**


## Session 30: 16:10 and 4:3 overlay support
<!-- trellis-session: v=2 fp=f31bd1f5181b36a4 -->

**Date**: 2026-10-19
**Task**: 16:10 and 4:3 overlay support
**Branch**: `feat/aspect-ratio`

### Summary

Overlay scales by height/1080 on a 1080*aspect canvas (capped 1920), per Panorama endofmatch-characters.js; centred panels anchor to canvas centre; 16:9 unchanged; spec viewport contract updated; PR #37 visually approved.

### Git Commits

| Hash | Message |
|------|---------|
| `0c424fc` | feat(overlay): 16:10 and 4:3 layouts follow Panorama's height scaling |

### Status

[OK] **Completed**


## Session 31: One-click auto-update (PR #43)
<!-- trellis-session: v=2 fp=6048fe2287b710d3 -->

**Date**: 2026-10-20
**Task**: One-click auto-update (PR #43)
**Branch**: `claude/busy-blackwell-bc6894`

### Summary

Planned and shipped one-click auto-update: @slgo/protocol update manifest (GET /v0/update, min_version), Rust-owned updater on tauri-plugin-updater (6 h checks, minisign verify, hand-over to the branded installer's unattended --update mode), release workflow signing. After visual review the update UI moved out of the connection status to a title-bar button, a settings 关于 group and a required-update banner. Real-install e2e passed on the dev PC (0.7.0->0.7.1, required 0.7.2 with UAC decline/retry). Maintainer generated the release signing key and secrets with their own script; backup intentionally skipped. Follow-ups: control-plane GET /v0/update (slgo-backend), publish-slui + download route (slgo-deploy).

### Git Commits

| Hash | Message |
|------|---------|
| `700b65a` | feat(protocol): update manifest contract and auto-update plan |
| `9943583` | wip(updater): partial step 2, see implement.md handoff |
| `08755d7` | feat(updater): background check, download and install hand-over |
| `6ea6e43` | feat(installer): unattended update mode for the updater |
| `8c5b2ac` | feat(updater): home version tile and required-update gating |
| `23c43d4` | ci(release): sign the installer for the updater and attach the .sig |
| `79b463c` | docs(updater): spec and README for auto-update |
| `f22057a` | fix(updater): move update UI out of the connection status |
| `625d2cf` | feat(updater): use the release signing public key |

### Status

[OK] **Completed**


## Session 32: Scoreboard deploy, live test and launch-crash fix
<!-- trellis-session: v=2 fp=cd3b9ce315fc8827 -->

**Date**: 2026-10-20
**Task**: Scoreboard deploy, live test and launch-crash fix
**Branch**: `feat/scoreboard`

### Summary

Kept SCP on top. Merged SLGO feat/scoreboard (8eadbad) and released 20261020-071902-8eadbad-78ccac7 (plugin + backend). The deploy build-slui exe aborted at launch: Tauri builds config windows before setup, and the embedded home page invoked updater_start before setup managed Updater; #45 manages it on the builder (spec rule in system-boundaries.md). Live test passed. The header's placeholder mode icons became the SLGO badge (brand logo without wordmark) in every mode at the user's request; mode_icon stays in the contract. Task archived; PR #44 merges on the user's go.

### Git Commits

| Hash | Message |
|------|---------|
| `4f81954` | fix(scoreboard): SLGO badge in the header instead of the placeholder mode icons |
| `4ee24e3` | docs(scoreboard): SLGO badge in the spec; acceptance criteria met |
| `3f92954` | fix(updater): manage the updater state before the windows are built (#45) |

### Status

[OK] **Completed**


## Session 33: World blur: DWM spike rejected, own WGC blur for scoreboard and shop
<!-- trellis-session: v=2 fp=8edc3db3dc9b6bee -->

**Date**: 2026-10-21
**Task**: World blur: DWM spike rejected, own WGC blur for scoreboard and shop
**Branch**: `feat/backdrop-blur`

### Summary

In-game tests showed DWM accent blur refreshes at ~30 Hz over the game (stutter, measured with a DXGI duplication tool). Replaced it with SLUI's own blur: Windows.Graphics.Capture of the game window, GPU Gaussian per region with CSS corner radius and opacity, click-through DirectComposition window under the overlay. Scoreboard (fill 0.6 over blur) and shop mask registered; setting with strength 1-3; dense fills as fallback (Windows 10, failures). In game: smooth (blur 66/s vs game 70/s), no measurable FPS cost, shop/Alt+Tab/strength OK. Specs updated; rect and shaped panel children remain.

### Git Commits

| Hash | Message |
|------|---------|
| `fd16504` | feat(overlay): native world blur under the scoreboard |
| `bae7e51` | feat(shop): native world blur under the buy-menu mask |
| `87113a4` | feat(overlay): own world blur through Windows.Graphics.Capture |
| `3512be4` | docs(spec): world blur contract, fills with and without it, in-game measurements |

### Status

[OK] **Completed**


## Session 34: World blur under the remaining HUD panels
<!-- trellis-session: v=2 fp=38d5ed9e9e45035c -->

**Date**: 2026-10-21
**Task**: World blur under the remaining HUD panels
**Branch**: `feat/backdrop-panels`

### Summary

Every remaining panel CS2 draws on hudWorldBlur now has SLUI's own world blur: message zone, progress card, killfeed rows, win panel result, bottom HUD circle and kill cards, radar, team counter equipment. Regions gained angle (turned kill cards) and a vertical fade profile (equipment mask), plus inset() clip-path from the page; panels register via the callback ref useBackdropRef; unregister re-sends in a microtask. Alerts/hints/progress use capture fills over the blur. Radar pageBackdrop capability and page backdrop-filters removed. Mock desktop build gained a no-background option (default in Tauri) so the blur can be reviewed in game. User approved in game; PR #47.

### Git Commits

| Hash | Message |
|------|---------|
| `91901b5` | feat(overlay): world blur regions turn, fade and follow inset clips |
| `aaa31ce` | feat(hud): world blur under the message zone, progress card, killfeed and win panel |
| `b4f76de` | feat(hud): world blur under the bottom HUD circle and kill cards, radar and team counter equipment |
| `66dc0cc` | docs(spec): world blur under every listed panel, turned and faded regions |
| `8634bd1` | fix(mock): HUD debug background can be none, the default in the desktop build |

### Status

[OK] **Completed**


## Session 35: CS2 spectator panel
<!-- trellis-session: v=2 fp=6790c9570fb46eb6 -->

**Date**: 2026-10-21
**Task**: CS2 spectator panel
**Branch**: `feat/spectator-panel`

### Summary

While dead, the bottom HUD shows the watched player (balance, ammo, kill cards) with CS2's HudSpecplayer panel: name, 伤/局, avatar in the circle, held-item label; no key hints, empty clan line. New hud.spectating event + hud-spectating feature (protocol, README, schema, fixtures); plugin SidecarHudSpectatingPublisher gated by MatchInformationPolicy.CanObservePlayer (SLGO 25910ae local main); sidecar relays it (slgo-backend d598538 local main). Debug scenes bottom-spectating / bottom-spectating-enemy. Deploy sidecar before plugin. In-game check pending.

### Git Commits

| Hash | Message |
|------|---------|
| `c8557d0` | feat(protocol): hud.spectating event and hud-spectating client feature |
| `ff93e6a` | feat(hud): CS2 spectator panel on the bottom HUD while watching a player |
| `7d706c3` | docs(spec): spectator panel boundary and replication rules |

### Status

[OK] **Completed**


## Session 36: SCP teammate purchase requests in the SLUI shop
<!-- trellis-session: v=2 fp=9cb3fc1eaa72b21c -->

**Date**: 2026-10-22
**Task**: SCP teammate purchase requests in the SLUI shop
**Branch**: `feat/shop-teammate-requests`

### Summary

SLUI adapts the plugin's SCP 请求代购: CS2 dropped-weapons area reused as the teammate-request area (geometry from the 08-25 baseline: plate 551px while shown, area 176px ending at y 1003), R / right-click toggles a request, quiet 已请求 corner label, navbar hint in CS2 BuyForTeammateLabel style. @slgo/protocol: optional shop.snapshot requestable/requested/requests, command.shop.request / command.shop.fulfill. Plugin (3209597) and slgo-backend (5908a4a) on feat/shop-teammate-requests. PR SLGO-Team/slui#50; live test pending.

### Git Commits

| Hash | Message |
|------|---------|
| `ed3dedf` | feat(shop): SCP teammate purchase requests in the CS2 dropped-weapons area |
| `e96de8c` | fix(shop): quiet 已请求 label in the card corner instead of the black ribbon |

### Status

[OK] **Completed**


## Session 37: 交互模式下移动的方案评估（结论：不做）
<!-- trellis-session: v=2 fp=24c4e2a456e1a001 -->

**Date**: 2026-10-23
**Task**: 交互模式下移动的方案评估（结论：不做）
**Branch**: `feat/overlay-move-while-interactive`

### Summary

用户希望商店/计分板交互模式下仍可走路。查明游戏只在前台时才收键盘和鼠标（无用户态状态能只给键盘）；反向 SendInput 抵消鼠标位移的 spike 写完后未进游戏即撤回（注入输入有反作弊封禁风险，规则：永不向游戏注入输入）；插件每 tick ServerOverridePosition 驱动行走可行但延迟、跳变、回拉冲突，用户判定不优雅。接受交互面板打开时不能移动，结论记入 system-boundaries spec。

### Git Commits

| Hash | Message |
|------|---------|
| `e469cd2` | docs(overlay): record why interactive panels cannot keep the player walking |

### Status

[OK] **Completed**


## Session 38: Overlay clock out of the App root
<!-- trellis-session: v=2 fp=1855a170478d4c7c -->

**Date**: 2026-10-23
**Task**: Overlay clock out of the App root
**Branch**: `perf/overlay-clock`

### Summary

App no longer ticks every 250 ms: shared overlay clock (src/shared/clock.ts, one interval while subscribed) with useClockSelector; round clock, shop countdown, scoreboard match time, win panel, message zone, killfeed and chat select their own time; App keeps live hud/shop while availability is unchanged (HUD timers moved to selectRoundHudClock). Shop/chat reducers tick only while a command is pending; debug frames built once per option change. Measuring found App still re-ran ~20/s from 15 Hz minimap.positions dispatched into every useReducer (no eager bailout): each model now exports *_EVENT_TYPES and handleEvent routes by type; event-routing-smoke parses the SlgoEvent union. Panels memoised. Mock 5 s: App renders 192 -> 12. hud and winpanel layout audits fail identically on main (pre-existing).

### Git Commits

| Hash | Message |
|------|---------|
| `f7caa0c` | perf(overlay): panels select their own time from a shared clock, App re-renders only on its own data |
| `aa4e0b0` | docs(spec): overlay clock and event routing rules |

### Status

[OK] **Completed**


## Session 39: Bundled fonts as WOFF2; branch cleanup
<!-- trellis-session: v=2 fp=4f146bdac7c82d03 -->

**Date**: 2026-10-23
**Task**: Bundled fonts as WOFF2; branch cleanup
**Branch**: `perf/woff2-fonts`

### Summary

All fonts SLUI ships (Noto Sans SC, Barlow, Chakra Petch, Barlow/Saira fallbacks) re-encoded losslessly as WOFF2, glyph order, cmap and metrics checked: files 17.87 -> 12.74 MB. Tauri already brotli-compresses embedded assets (q9), so slui.exe only shrinks ~1.3 MB; a GB2312 subset (1.55 MB/weight) would cut ~9.5 MB more but needs a YaHei fallback, which the spec rules out. build-fallback-fonts.py writes WOFF2. Deleted 19 local branches whose PRs merged; kept legacy-main, spike/backdrop-blur (unmerged commits) and an old clean worktree.

### Git Commits

| Hash | Message |
|------|---------|
| `1783dde` | perf(fonts): ship the bundled fonts as lossless WOFF2 |
| `8e26f34` | docs(spec): bundled Noto Sans SC is WOFF2 with every glyph |

### Status

[OK] **Completed**


## Session 40: Release builds without mock code
<!-- trellis-session: v=2 fp=1c598b08cc51d106 -->

**Date**: 2026-10-23
**Task**: Release builds without mock code
**Branch**: `perf/release-without-mocks`

### Summary

A production build shipped mock chat history, HUD scenes, debug-panel CSS and 0.9 MB preview backgrounds: App imported src/mocks statically and decided MOCK_BACKEND at runtime. MOCK_BACKEND is now import.meta.env.MODE === 'mock' (never built); main.tsx dynamically imports src/mocks/harness.ts only in that mode and passes it to App as the harness prop; preview art moved to src/mocks/preview. mock-boundary-check in npm test rejects other value imports from src/mocks. Production App JS 268 -> 183 KB, dist 24.29 -> 23.28 MB. Mock mode verified (debug panels, background, radar); audits unchanged vs main.

### Git Commits

| Hash | Message |
|------|---------|
| `3517aec` | perf(overlay): packages carry no mock code, debug panels or preview art |
| `1d6c626` | docs(spec): packages carry no mock code |

### Status

[OK] **Completed**


## Session 41: Size-optimised Rust release profile
<!-- trellis-session: v=2 fp=6be52cdc9118da79 -->

**Date**: 2026-10-23
**Task**: Size-optimised Rust release profile
**Branch**: `perf/rust-release-profile`

### Summary

src-tauri/Cargo.toml (workspace root) gets [profile.release]: opt-level s, fat LTO, codegen-units 1, strip symbols. Local, one commit: slui.exe 31.4 -> 26.6 MB, slui-setup.exe 10.0 -> 6.8, installer 33.2 -> 28.8 (LTO+strip alone only -1.6 MB; most from opt-level s). CI cold installer build via a temporary bench workflow (reverted before merge): 404 -> 566 s, installer 33.10 -> 28.58 MB. panic stays unwind (tokio JoinHandles in sidecar_socket). cargo test --workspace --release: 74 passed. Tuned exe not launched (installed SLUI running, single-instance): in-game test before release.

### Git Commits

| Hash | Message |
|------|---------|
| `f98927c` | perf(build): size-optimised release profile for slui.exe, the shell and the installer |
| `cac013f` | docs(build): note the release profile's build-time cost |

### Status

[OK] **Completed**


## Session 42: Drop unused library crate types
<!-- trellis-session: v=2 fp=7d54ab92a2c0fecc -->

**Date**: 2026-10-23
**Task**: Drop unused library crate types
**Branch**: `perf/drop-unused-crate-types`

### Summary

slui_lib built as rlib only (the template's staticlib/cdylib are mobile targets, unused on desktop). With the fat-LTO release profile each extra artifact ran its own LTO pass: release rebuild of slui (deps built) 291 -> 234 s; slui.exe practically identical (-1.5 KB). cargo test --workspace passes.

### Git Commits

| Hash | Message |
|------|---------|
| `96449a5` | perf(build): build slui_lib as the rlib slui.exe links only |

### Status

[OK] **Completed**


## Session 43: Cache the game-process check per window
<!-- trellis-session: v=2 fp=26dac7c202279af1 -->

**Date**: 2026-10-23
**Task**: Cache the game-process check per window
**Branch**: `perf/foreground-process-cache`

### Summary

is_game_foreground opened the foreground process and read its executable path on every call (foreground thread every 100 ms, keyboard events every key). ForegroundProcessCache keeps the verdict for the last window keyed by (HWND, process id); failed queries are retried, not cached. Unit tests for the cache; cargo test/check clean. Live check pending (installed SLUI running, single-instance).

### Git Commits

| Hash | Message |
|------|---------|
| `4f2d778` | perf(overlay): query the foreground window's process only when the window changes |

### Status

[OK] **Completed**


## Session 44: SLUI health check and dependency refresh
<!-- trellis-session: v=2 fp=b0af07518bdc3027 -->

**Date**: 2026-10-24
**Task**: SLUI health check and dependency refresh
**Branch**: `chore/deps-refresh`

### Summary

Health check (lint, 27 smokes, builds, cargo test, clippy, hakari, npm audit, GitHub state) found two high npm advisories, Tauri one minor behind and GitHub scanning off. Updated npm and Cargo deps within ranges (vite 7.3.7, source-map-js 1.2.2, Tauri 2.12, React 19.3), moved the windows crate to 0.62 with tao (IAsyncOperation::get -> join), verified with the full suite and a tauri:mock run. Enabled secret scanning, push protection and the dependency graph (via PUT vulnerability-alerts) on SLGO-Team/slui. Also fast-forwarded local main past #58 and deleted the merged perf/foreground-process-cache branch.

### Git Commits

| Hash | Message |
|------|---------|
| `c131768` | fix(deps): update Tauri 2.12, React 19.3 and vite 7.3.7 |

### Status

[OK] **Completed**


## Session 45: CI gates: clippy, npm audit, pinned Rust, Dependabot npm
<!-- trellis-session: v=2 fp=b707953ce985af2a -->

**Date**: 2026-10-24
**Task**: CI gates: clippy, npm audit, pinned Rust, Dependabot npm
**Branch**: `ci/health-gates`

### Summary

Pinned Rust 1.99 in rust-toolchain.toml (minimal + clippy) for local, CI and release; CI installs it before rust-cache, denies clippy warnings and runs npm audit --audit-level=high. Code was already clippy-clean on 1.99. Dependabot now groups npm minor/patch monthly, ignoring @tauri-apps/* and majors. Enabled Dependabot security updates on SLGO-Team/slui. cargo clean --profile dev freed 37.8 GiB.

### Git Commits

| Hash | Message |
|------|---------|
| `a390b3c` | ci: gate clippy and npm audit, pin Rust 1.99, Dependabot for npm |

### Status

[OK] **Completed**


## Session 46: Move windows-sys to 0.61
<!-- trellis-session: v=2 fp=5b242af0251cae6b -->

**Date**: 2026-10-24
**Task**: Move windows-sys to 0.61
**Branch**: `build/windows-sys-0.61`

### Summary

Moved SLUI's and the installer's direct windows-sys from 0.59 to 0.61 (Tauri 2.12's version) with no source change; workspace-hack regenerated. clippy -D warnings on 1.99, cargo test 39+37, hakari and a tauri:mock run pass. windows-sys 0.60 remains via rfd (installer's dialog plugin).

### Git Commits

| Hash | Message |
|------|---------|
| `ad9eca3` | build(deps): move windows-sys to 0.61 |

### Status

[OK] **Completed**


## Session 47: CS2 team select menu
<!-- trellis-session: v=2 fp=bb36c4295bbb634d -->

**Date**: 2026-10-25
**Task**: CS2 team select menu
**Branch**: `feat/team-select`

### Summary

CS2 team select menu driven by the plugin's team.menu session (protocol event and team commands, model, view, mock scenes), with side illustrations (NTF squad painting, the five classic SCPs' portraits grouped) and CS2's hover outline. In-game test on the local server (competitive) passed join, M toggle with music, refusal banner, auto and the mid-round not-now notice; it found two bugs fixed here: the menu taking the foreground hid itself (foreground event now carries overGame from the same sample as the overlay's visibility) and a menu left open while the overlay was disabled took no input after enabling (released like shop and chat). Skipped by the user: casual-profile spectate, the Hint menu for non-SLUI clients and late presence. Plugin and backend branches merged into their local main.

### Git Commits

| Hash | Message |
|------|---------|
| `176475e` | feat(teamselect): CS2 team select menu from the plugin's team session |
| `3eb9cf1` | fix(teamselect): mouse hover in the debug scenes and an opaque red SCP fallback avatar |
| `d25778a` | fix(teamselect): top gradients follow the captures' opacity curve instead of a linear fade |
| `f04d455` | docs(teamselect): record the review status and next steps |
| `2182b7f` | feat(teamselect): side illustrations in place of CS2's team models |
| `484082b` | fix(teamselect): keep the menu while it holds the foreground |
| `8a16fa8` | fix(teamselect): let the menu go when the overlay is disabled |

### Status

[OK] **Completed**


## Session 48: SLUI shop purchase refunds (CS2 sellback)
<!-- trellis-session: v=2 fp=626d770da00d6207 -->

**Date**: 2026-10-26
**Task**: SLUI shop purchase refunds (CS2 sellback)
**Branch**: `feat/shop-refund`

### Summary

Brought the plugin's purchase refunds into the SLUI shop. Protocol v0: item refundable, snapshot has_refundable (capability signal), command.shop.refund / command.shop.refund_all. SLUI: CS2 sellback button on refundable cards (SLUI-drawn undo icon, 退款 tooltip measured from the user's in-game capture), Backspace over the hovered card, navbar [DEL]全部退款 and Delete; card layout without refunds pixel-identical to main. Plugin (../SLGO 274682c) and slgo-backend (aabbb33) merged into their local main, not deployed. Visuals approved by the user; live test (AC1-AC6) pending.

### Git Commits

| Hash | Message |
|------|---------|
| `0cad8c1` | feat(shop): purchase refunds from the plugin (CS2 sellback) |

### Status

[OK] **Completed**


## Session 49: Home Steam tile: avatar and persona name
<!-- trellis-session: v=2 fp=0ee239888074e32a -->

**Date**: 2026-10-27
**Task**: Home Steam tile: avatar and persona name
**Branch**: `feat/home-steam-profile`

### Summary

Home Steam status tile now shows the signed-in account's avatar (HUD focus frame, blurred tint) and persona name above the SteamID. New get_steam_profile Tauri command reads loginusers.vdf PersonaName and config/avatarcache/<id>.png from the local Steam client (SteamPath registry), no network; returns a data: URL. Rust VDF lexer/parser with unit tests and an ignored local probe; TS adapter + steamAccount model in desktop-adapters smoke; ?steam=<scene> DEV previews; Steam column widened to 1.6fr so the SteamID fits at the 820 px minimum. Spec: command table, Steam tile contract, preview exception.

### Git Commits

| Hash | Message |
|------|---------|
| `2d92010` | feat(home): show the Steam avatar and persona name on the status tile |

### Status

[OK] **Completed**


## Session 50: Game exit ends the SLUI game session
<!-- trellis-session: v=2 fp=44cea23d1c8e396c -->

**Date**: 2026-10-28
**Task**: Game exit ends the SLUI game session
**Branch**: `fix/game-exit-lifecycle`

### Summary

Quitting SCP:SL left the last session behind (red 未授权 with the same-PC hint, overlay still enabled, old match in every panel, control-plane polling with no game). One SCPSL.exe run is now one game session: Rust switches the overlay off when the process probe sees the game exit; useGameRunning gates useClientSession, which while the game is closed only reads the Steam identity and reports the new status game-not-running (home: muted 未连接 / 启动游戏后自动连接, no retry, no network). endsMatch() (ended, not-in-game, game-not-running) resets every feature reducer. Protocol: SIDECAR_CLOSE_CODES.notOnServer (4004) for a player the roster no longer lists, mapped to not-in-game + poll instead of unauthorized. Home switch says 进入服务器后自动启用 while off with auto-enable on. Cross-repo: slgo-backend db90672 (hub closes departed/unlisted players with 4004, tests, decision), merged into its local main, not deployed. Live in-game test pending.

### Git Commits

| Hash | Message |
|------|---------|
| `265f7cf` | fix(session): end the game session when the player quits or leaves the server |

### Status

[OK] **Completed**


## Session 51: Overlay shows only while the session is live
<!-- trellis-session: v=2 fp=34a17963829395ee -->

**Date**: 2026-10-28
**Task**: Overlay shows only while the session is live
**Branch**: `fix/game-exit-lifecycle`

### Summary

Follow-up in PR #71 at the user's request: an enabled overlay is shown only while the overlay page's session is live (connected to the sidecar). New command set_overlay_session_live feeds SESSION_LIVE into Rust's overlay_may_show(); the page gates shop availability, scoreboard mode and overlayInteractive on the live session, so a hidden overlay never holds the foreground or the right button. Home: overlaySwitchNote() — off + auto-enable: 进入服务器后自动启用; enabled but not live: 连接服务器后显示; the note line now sits under the button (it ran into the hero art at 820 px) and is always reserved. Spec updated; lint, smokes, clippy and Rust tests pass. No separate Trellis task (same PR).

### Git Commits

| Hash | Message |
|------|---------|
| `5a7e9ea` | fix(overlay): show the overlay only while the session is live |

### Status

[OK] **Completed**


## Session 52: SLUI diagnostics log for the dead shop key reports
<!-- trellis-session: v=2 fp=c7adbb7f70419842 -->

**Date**: 2026-10-28
**Task**: SLUI diagnostics log for the dead shop key reports
**Branch**: `fix/diagnostics-log`

### Summary

Investigated field reports that B does not open the shop while SLUI runs (server logs of the 10-24 competitive match: the reporter closed SLUI during two buy phases). Ruled out clock skew and stale snapshots; remaining causes are on the client key path (elevated game, removed hook, async-state repeat, settings). Added a rotating release log (diag.rs, slui.log in app_log_dir) with game elevation, hook event counts, repeat anomalies and the page's shop key decisions, plus a tray item to reveal it. Verified start lines, second-instance and rotation with a debug build; in-game lines still need a live session.

### Git Commits

| Hash | Message |
|------|---------|
| `fffd2f8` | feat(diagnostics): write a session log players can attach to reports |

### Status

[OK] **Completed**
