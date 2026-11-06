# SLUI

SCP: Secret Laboratory 的 Windows 游戏覆盖层客户端，配合 SLGO 服务器使用，提供 HUD、商店、聊天、计分板、击杀信息、选边界面和小地图。基于 Tauri、React 和 TypeScript。

## 游戏内按键

默认与 CS2 一致：B 打开 / 关闭商店，按住 Caps Lock 显示计分板，Y 全体聊天，U 队伍聊天。四个按键都可以在“设置 → 快捷键”中修改，可用 R 以外的字母键和 F1–F12（计分板另可用 Caps Lock），不带修饰键；数字键和 R 留给打开的商店选购和请求队友购买。

## 开发

```bash
npm install
npm run dev:mock     # 浏览器预览，使用内置 mock 数据
npm run tauri:mock   # 桌面应用，使用内置 mock 数据
npm run tauri dev    # 桌面应用，连接 .env.development 中配置的后端
npm test
```

| 命令 | 用途 |
| --- | --- |
| `npm run tauri:build:local` | 连接本地后端的测试安装包 |
| `npm run installer:build` | 正式安装器 `SLUI-Setup-<version>.exe`，需要设置 `VITE_CONTROL_PLANE_URL` |
| `npm run licenses` | 重新生成随安装包分发的 `THIRD_PARTY_LICENSES.txt`；改了 `Cargo.lock` 或增删 npm 运行时依赖后运行，CI 用 `npm run licenses:check` 检查。需要 `cargo install cargo-about --version 0.9.3 --locked --features cli` |

安装器同时安装卸载程序 `slui-uninstall.exe`，“应用和功能”中的卸载会打开它。卸载默认保留主题包和用户设置，可分别勾选“同时删除主题包”和“删除用户设置和数据”；静默卸载使用安装目录中的 NSIS 卸载程序 `uninstall.exe /S`。

无人值守安装（部署工具）：`SLUI-Setup-<version>.exe /S`，不显示界面，以安装器的退出码退出（0 成功，1 取消，2 失败；未提权时仍会弹出一次 UAC）。可加 NSIS 参数：`/NS` 不创建快捷方式（再加 `/SLUI-STARTMENU`、`/SLUI-DESKTOP` 单独创建），`/D=<目录>` 指定安装目录，必须放在最后且不加引号；不加 `/D=` 时，已安装则装回原目录。例如在 PowerShell 中：`Start-Process .\SLUI-Setup-<version>.exe '/S /NS /SLUI-STARTMENU' -Wait -PassThru`。

SLUI 会在后台检查并下载新版本（启动时及每 6 小时），校验签名后在首页“版本”卡片和托盘菜单提供“更新并重启”，点击后经一次 UAC 授权自动安装并重新打开。正式发布的安装器附带供更新校验的 `SLUI-Setup-<version>.exe.sig`；本地构建的安装器未签名，不能作为更新分发。

首页左侧的“生涯”页显示你在 SLGO 服务器上计入生涯的比赛统计：分模式与 NTF / SCP 阵营的概览、近期比赛和单场计分板。其中“每回合 Swing”是你为本方回合胜率带来的平均变化，人数优势不算到任何人头上，所以在人数不对称的休闲局里也可比较。

SLUI 需要与游戏运行在同一台电脑、同一网络连接上，服务器才会接受连接。

反馈问题时请附上诊断日志：托盘菜单或“设置 → 关于”中的“打开日志文件夹”会选中 `slui.log`（`%LOCALAPPDATA%\com.slui.desktop\logs`），`slui.1.log`、`slui.2.log` 是前两次运行的日志。日志只记录 SLUI 自身的状态和快捷键，不记录输入的文字或其他按键。

分支、PR、提交规范和发版流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 主题包

字体和音效可以用可选的主题包按文件替换：在应用目录（开发时为仓库根目录）放置包含 `fonts/` 和 `sounds/` 的 `theme-pack/` 目录，缺少的文件回退到内置资源。`node scripts/build-installer.mjs --local --theme-pack <目录>` 生成自带主题包的安装器（直接调 node：PowerShell 的 npm 会吞掉 `npm run ... -- --theme-pack` 里的 `--`，脚本会报错而不是打出不带主题包的安装器）。本仓库不包含任何主题包内容。

## 许可证

[GPL-3.0-or-later](LICENSE)；协议包 [`packages/protocol`](packages/protocol) 为 [MIT](packages/protocol/LICENSE)，协议说明见 [`packages/protocol/v0/README.md`](packages/protocol/v0/README.md)。第三方资源见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)，依赖的许可证全文见 [`THIRD_PARTY_LICENSES.txt`](THIRD_PARTY_LICENSES.txt)（随安装包分发）。
