# 实施计划：SLUI 主界面与设置

按顺序执行，每步完成后运行该步的检查再进入下一步。

## 步骤

1. [x] **设置解析（纯函数）**：新增 `src/platform/settings.ts` 的 `parseSettings` / `serializeSettings`，复用 `normalizeRadarPreferences`。新增 `scripts/settings-smoke.mjs`：缺失、非对象、错误版本、越界、非有限数、未知字段、正常往返。加入 `npm test`。
   - 检查：`npm test`、`npm run lint`。
2. [x] **Rust：窗口改名与启停状态**：`main` → `overlay`（`tauri.conf.json`、`lib.rs`、capabilities）；新增 `home` 窗口；`OverlayState` 与 `set_overlay_enabled` / `get_overlay_state`；前台跟随和键盘钩子按 `enabled` 过滤；覆盖层以隐藏状态启动；`home` 关闭时隐藏。
   - 检查：`grep -rn '"main"' src-tauri src` 无残留；`npm run tauri:check`（若 Linux 缺系统库，记录错误原因）。
3. [x] **Rust：设置存储**：`load_settings` / `save_settings`（原子写、损坏备份、广播 `slgo-settings-changed`）。
   - 检查：`cargo test`（纯文件逻辑放在不依赖 Windows 的函数里，用临时目录测试）。
4. [x] **Rust：游戏进程检测**：Toolhelp32 轮询、`get_game_running`、`slgo-game-running` 事件；`windows-sys` 加 `Win32_System_Diagnostics_ToolHelp`；复用 `is_game_executable`。
   - 检查：`npm run tauri:check`；Windows 上 `cargo test`。
5. [x] **Rust：托盘**：开启 `tray-icon` 特性；左键显示主窗口；菜单三项；启停项文字随状态刷新；退出。
   - 检查：`npm run tauri:check`。
5a. [x] **Rust：单实例**：加入 `tauri-plugin-single-instance` 并作为第一个插件注册；回调显示/还原/聚焦 `home` 并 `request_user_attention` 闪烁任务栏。
   - 检查：`npm run tauri:check`；Windows smoke 覆盖 AC9 三种窗口状态。
6. [x] **前端适配器**：`src/platform/overlayState.ts`、`gameProcess.ts`、设置存储适配器（Tauri 命令 / 浏览器 `localStorage` 回退 / mock）。新增 `scripts/home-adapters-smoke.mjs` 覆盖事件与快照合并、重复事件、订阅清理。
   - 检查：`npm test`、`npm run lint`。
7. [x] **窗口分发**：`src/main.tsx` 按窗口 label（浏览器用 `?window=home`）渲染 `HomeApp` 或 `App`。
8. [x] **覆盖层接入**：`App.tsx` 从设置适配器读取初值并监听变更，替换正式构建的 `defaultMinimapPreviewOptions`（调试 URL 仍优先）；监听启停事件重置交互/商店/切换缩放；发送会话状态并响应请求与重试。
   - 检查：`npm run build`；运行 `minimap-visual-audit`（同本任务前的方式）确认 72 个场景不变。
9. [x] **主界面 UI**：`HomeApp`、`StatusBar`、`OverlaySwitch`、`RadarSettings`、`home.css`；11 项控件由 `RADAR_NUMERIC_RANGES` / `DEFAULT_RADAR_PREFERENCES` 生成；恢复默认；保存失败提示；背景模糊能力说明。
   - 检查：浏览器 `?window=home` 截图 1280×800 与 800×600 两种尺寸，确认无溢出、文字清楚。
10. [x] **规范与文档**：更新 `.trellis/spec/frontend/system-boundaries.md`（新增窗口、事件、命令列表）、`README.md`（启动流程和托盘说明）。
11. [x] **最终检查**：`npm run lint`、`npm test`、`npm run build`、`npm run tauri:check`；整理 Windows 实机 smoke 清单（AC1–AC7、AC9）交给用户执行，并在报告中写明容器内未验证的部分。

## 实施结果（2026-09-25）

- 步骤 2–5a 合并为一次提交（`db8cd2b`），前端 6–9 一次提交（`0001152`）；原计划的 `overlayState.ts`/`gameProcess.ts` 合并为 `src/platform/desktop.ts`，两个窗口共用一个 capability（原因见 design.md）。
- 自查后修复：`apply_overlay_input_mode` 仅在启用时带 `SWP_SHOWWINDOW`（避免启动/停用时闪现 HUD）；前台跟随去掉 `SWP_SHOWWINDOW`（避免与停用竞争后重新显示）；主界面在收到会话快照前每 2 秒重发请求。
- 验证：`npm run lint`、`npm test`（含新增 settings / desktop-adapters smoke）、`npm run build` 通过；`cargo check --target x86_64-pc-windows-msvc --all-targets` 无错误无警告；`settings.rs` 4 个单元测试在独立 crate 中通过；浏览器双标签验证设置同步、刷新后保留、恢复默认、启停状态、会话状态桥接，1280/800/560 宽度无横向溢出；`minimap-visual-audit` 72 场景通过（模糊阈值同前放宽，原因见小地图任务记录）。
- 未能验证：`npm run tauri:check`（Linux 缺 webkit2gtk/GTK 系统库，基线同样失败）；托盘、窗口、焦点、单实例和游戏进程检测需按 `research/windows-smoke-checklist.md` 在 Windows 实机验证。

## 高风险文件 / 回退点

- `src-tauri/src/lib.rs`：窗口改名与后台线程过滤。步骤 2 单独提交，出问题可整体回退。
- `src-tauri/Cargo.toml` / `Cargo.lock`：新增特性和单实例插件。步骤 4、5、5a 各自提交。
- `src/App.tsx`：只加接入代码，不改 HUD/商店/雷达已有逻辑。

## 开始前检查

- `implement.jsonl` / `check.jsonl` 已填入真实规范条目。
- 用户已确认最终规划总结。
