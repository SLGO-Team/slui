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
