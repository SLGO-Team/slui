# 设计：SLUI 主界面与设置

## 1. 窗口与所有权

| 窗口 label | 角色 | 配置 |
| --- | --- | --- |
| `home`（新增） | 主界面 | 有边框、可调大小（约 720×640，最小 560×480）、显示在任务栏、启动可见、深色背景 |
| `overlay`（由 `main` 重命名） | 游戏覆盖层 | 保留现有透明/置顶/`skipTaskbar`/`focus:false`，改为 `visible:false` 启动 |

`main` 改名为 `overlay`，Rust 端所有 `get_webview_window("main")` / `emit_to("main", …)` 与 `capabilities/default.json` 的 `windows` 同步修改。两个窗口共用 `capabilities/default.json`（`windows: ["home", "overlay"]`）：两者都只需要 `core:default`（含事件收发），窗口显示/隐藏全部由 Rust 命令完成，前端不直接操作窗口，拆分不会收窄权限。

**唯一事实来源**：覆盖层启停状态保存在 Rust 管理的 `OverlayState { enabled: bool, interactive: bool }`。前端不自行保存副本，只经命令修改、经事件得知结果。

## 2. Rust 端（`src-tauri/src/lib.rs`，按功能拆出子模块）

新增/修改命令：

| 命令 | 作用 |
| --- | --- |
| `set_overlay_enabled(enabled)` | 更新状态；启用时 `show()` 覆盖层并设为被动输入（不激活、不抢焦点）；停用时强制 `interactive=false`、恢复点击穿透、`hide()`。随后广播 `slgo-overlay-state`，并刷新托盘菜单文字。 |
| `get_overlay_state()` | 返回当前 `{enabled, interactive}`，供窗口加载时取快照。 |
| `set_overlay_interactive(interactive)` | 保留；覆盖层停用时拒绝进入交互模式。 |
| `load_settings()` / `save_settings(json)` | 读写 `app_config_dir()/settings.json`。保存时先写临时文件再重命名（原子替换）；成功后广播 `slgo-settings-changed`（负载为已保存内容）。读取失败或 JSON 损坏时，把原文件改名为 `settings.json.bad-<时间戳>`，返回 `null`。 |
| `get_game_running()` | 返回 SCPSL 进程是否存在。 |

后台线程：
- **前台跟随**：仅在 `enabled` 时对齐覆盖层；停用时跳过，避免现有 `SWP_SHOWWINDOW` 把隐藏的覆盖层重新显示出来（这是必须修的现存行为）。
- **键盘钩子**：仅在 `enabled` 时向 `overlay` 发送 `slgo-shortcut`。
- **游戏进程检测**：每 2 秒用 Toolhelp32 快照（`CreateToolhelp32Snapshot` + `Process32FirstW/NextW`）检查可执行文件名，复用现有 `is_game_executable` 的名称匹配规则；状态变化时广播 `slgo-game-running`。需要给 `windows-sys` 加 `Win32_System_Diagnostics_ToolHelp` 特性。非 Windows 平台恒为 `false`。

托盘（`tauri` 开启 `tray-icon` 特性，使用 Tauri 2 核心 `TrayIconBuilder` 与 `Menu`，不引入插件）：
- 左键单击：`home.show()` + `unminimize()` + `set_focus()`。
- 菜单：打开主界面 / 启用覆盖层（或“停用覆盖层”）/ 退出。启停项调用与命令相同的内部函数，保证两处一致。
- 退出：`app.exit(0)`。

单实例：使用官方 `tauri-plugin-single-instance`（必须作为第一个注册的插件）。回调中对 `home` 依次调用 `show()`、`unminimize()`、`set_focus()`，再调用 `request_user_attention(Some(UserAttentionType::Informational))` 闪烁任务栏按钮；第二个进程由插件在回调触发后自行退出。回调不改变覆盖层状态。

主窗口关闭：在 `on_window_event` 中对 `home` 的 `CloseRequested` 调用 `prevent_close()` 再 `hide()`。

启动顺序（`setup`）：覆盖层保持隐藏、被动；状态 `enabled=false`；建托盘；启动三个后台线程；`home` 由配置自动显示。

## 3. 前端结构

```
src/main.tsx              根据窗口 label 选择根组件（Tauri 下读 getCurrentWebviewWindow().label；浏览器下读 ?window=home）
src/App.tsx               → 保持为覆盖层根组件（仅接入设置与启停事件，其余不动）
src/app/home/HomeApp.tsx  主界面根组件
src/app/home/StatusBar.tsx
src/app/home/OverlaySwitch.tsx
src/app/home/RadarSettings.tsx
src/app/home/home.css     深色主题 token 与布局
src/platform/settings.ts  设置存储适配器（Tauri 命令 / 浏览器 localStorage 回退），纯函数解析与规范化
src/platform/desktop.ts   跨窗口总线（Tauri 事件 / 浏览器 BroadcastChannel）及覆盖层启停、游戏进程、会话状态桥接适配器
```

React 组件不直接调用 `invoke`/`listen`，全部经 `src/platform` 适配器，符合 `system-boundaries.md` 的边界要求。

### 3.1 设置文件格式

```json
{ "version": 1, "radar": { "alwaysCentered": true, "orientation": "fixed", "...": "11 项" } }
```

`parseSettings(unknown)`：非对象或 `version` 不是 1 → 视为无设置；`radar` 交给 `normalizeRadarPreferences()`，逐字段回退默认或夹到范围。未知字段丢弃。纯函数，可 smoke 测试。

### 3.2 设置数据流

1. 主界面加载：`load_settings()` → `parseSettings` → 渲染控件。
2. 用户修改：立刻更新本地状态；以 150ms 防抖调用 `save_settings`（拖动滑块时合并写入）。
3. Rust 写盘成功后广播 `slgo-settings-changed`；主界面是唯一写入方，不消费该事件（避免拖动时旧值回弹）；覆盖层收到后 `parseSettings` → 替换 `useMinimapFeature` 的 `preferences`。滑块拖动的端到端延迟约 150ms + 一帧，满足 AC4 的 0.5 秒。
4. 覆盖层启动：同样 `load_settings()` 取初值。
5. 写盘失败：主界面在设置区显示“保存失败”提示，本地值保留，下次修改重试；覆盖层维持上次成功的值。

调试构建中，若 URL 带有 `minimapPreset` 或 `minimap*` 参数，覆盖层继续使用 URL 值并忽略设置事件，保证现有 `minimap-visual-audit` 场景稳定。

### 3.3 覆盖层启停对覆盖层内部状态的影响

覆盖层监听 `slgo-overlay-state`：变为停用时重置 `overlayInteractive=false`、`shopDismissed=false`、`minimapOptions.alternateZoomActive=false`（清除按住状态）。连接会话（`useClientSession`）不随启停中断——隐藏的 webview 继续运行，主界面状态栏因此能一直显示连接状态。

### 3.4 状态栏数据来源

会话在覆盖层 webview 中运行。覆盖层把 `{ status, steamId, detail }` 通过 `emitTo("home", "slgo-session-status", …)` 发出：状态变化时发送一次，并在收到主界面的 `slgo-session-status-request` 时补发当前快照（主界面加载或重新显示时请求；两个窗口同时启动时首个请求可能早于覆盖层注册监听，因此主界面在收到快照前每 2 秒重发一次）。“重试”按钮发送 `slgo-session-retry` 给覆盖层，调用现有 `session.retry`。

浏览器开发模式下两个页面是同一浏览器的两个标签页，经 `BroadcastChannel`（启停、会话状态）和 `localStorage` 的 `storage` 事件（设置）联动；游戏进程恒为未运行。真实窗口、托盘和焦点行为只在 Windows Tauri 中验证。

### 3.5 视觉

深色桌面风格：背景 `#15171a`、卡片 `#1e2126`、分隔线 `#2c3036`、主文字 `#e6e8eb`、次文字 `#9aa1a9`、强调色 `#4c9aff`、成功 `#3fb950`、警告 `#d29922`、错误 `#f85149`。系统字体栈（`"Segoe UI", "Microsoft YaHei", sans-serif`），14px 正文。设置行左侧名称、右侧控件；数值项为滑块加两位小数数字框，步长 0.01。不引入 UI 组件库。

## 4. 兼容与风险

- **窗口改名**：所有 `"main"` 引用需一次改全；漏改会导致事件发不到覆盖层。实施时 `grep '"main"'` 作为检查项。
- **前台跟随的 `SWP_SHOWWINDOW`**：不加启停判断会让隐藏的覆盖层每 100ms 被重新显示，必须随本任务修复。
- **托盘特性**：`tauri` 需要开启 `tray-icon` 特性，Cargo.lock 会变化；Linux 上的 `cargo check` 可能因缺少 GTK 系统库无法运行，需在报告中说明。
- **背景模糊能力**：原生覆盖层 `pageBackdrop=false`，设置页如实提示（PRD R4a）。
- **单实例插件**：需要新增 `tauri-plugin-single-instance` crate（Cargo.lock 变化）；Windows 上 `set_focus` 可能被前台锁定规则拦截，因此总是附带任务栏闪烁作为可见反馈。

## 5. 回退

- 前端：`main.tsx` 的窗口分发可以直接回退为只渲染 `App`。
- Rust：启停、托盘、设置和进程检测各自是独立函数/模块，可单独撤回；撤回托盘时需同时恢复“关闭即退出”。
- 配置文件只新增，不改动已有数据；删除该文件即回到默认值。
