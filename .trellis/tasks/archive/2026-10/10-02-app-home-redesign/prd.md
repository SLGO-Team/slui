# SLUI 主界面视觉重构

## Goal

把主窗口（Tauri `home` 窗口）从"通用深色卡片纵向堆叠"重做为 SLGO 品牌下的游戏启动器风格界面，并为 SLUI 设计专属应用图标。功能行为保持 `09-07-app-home-settings`（已归档，Windows 实机 smoke 全部通过）交付的状态，本任务只改观感、信息组织与窗口外框。

## Background

- SLUI 是 SLGO 旗下的产品：产品名保持 SLUI，品牌视觉沿用 SLGO。
- 现状：`src/app/home/`（`HomeApp.tsx`、`StatusBar.tsx`、`OverlaySwitch.tsx`、`RadarSettings.tsx`、`HotkeySettings.tsx`、`AudioSettings.tsx`、`home.css`，约 490 行），GitHub 暗色系配色 + Segoe UI，状态三格 + 覆盖层卡 + 雷达 11 项 + 快捷键 1 项 + 声音 1 项，需要纵向滚动。
- 窗口：`src-tauri/tauri.conf.json` home 760×680，最小 560×480，系统标题栏；关闭由 `src-tauri/src/lib.rs:796` 的 `CloseRequested` 拦截为隐藏到托盘。
- 图标：`src-tauri/icons/*` 为 Tauri 默认图标；托盘取 `default_window_icon()`（`src-tauri/src/lib.rs:575`），exe/任务栏/托盘共用一套。
- 品牌素材（已整理到 `../SLGO-assets/brand/`）：`logo/slgo-logo.svg`、`slgo-logo-transparent.svg`、`slgo-logo-icon.svg` 及预览 png；`animation/` 为 logo 片头动画 html/webm/mov 与帧导出脚本。角色渲染图在 `SLGO-assets/image/`。
- 浏览器预览：`npm run dev:mock` 后打开 `/?window=home`（`.claude/launch.json` 的 `slui-mock`）。

## Decisions

- D1 视觉方向：游戏启动器风格（左侧导航 + 主区域，类 Steam / 战网客户端）。
- D2 导航分页：「首页」= 连接状态（Steam / 游戏 / 服务器 + 重试）与覆盖层主开关；「设置」= 雷达 / 快捷键 / 声音三组。
- D3 自绘标题栏：去掉系统装饰，提供拖动、最小化、关闭（关闭仍隐藏到托盘）；接受失去 Win11 最大化按钮悬停的 Snap Layouts 菜单。
- D4 品牌视觉取自 `slgo-logo.svg`：
  - 底色深蓝 `#203042 → #131c28 → #090e15`；强调橙 `#f7941d`（渐变 `#ffb84e → #ee7d11`）；前景白 `#ecf2f8`；线条 `#33475c` / `#2a3a4c`。
  - 图形母题：HUD 四角括号、准星 / 收容环、斜切电竞字标。
  - 字体（只用可自由分发的授权；**禁止 Stratum2 与 DIN Next**，二者为商业授权，存在法律风险）：展示字（字标、页面标题、大状态）用 Chakra Petch（SIL OFL）；英文标签与数字用 Barlow（SIL OFL）；中文标题用 Noto Sans SC（SIL OFL）；中文正文用系统字体 Microsoft YaHei UI（不随应用分发）。
- D5 品牌命名：产品名 SLUI。左上角品牌区为「SLGO 准星图标 + SLUI 字标」；窗口标题保持 "SLUI"。
- D7 用户可见文案把"游戏覆盖层 / 覆盖层"统一改为"UI"（主界面、导航摘要、设置说明、托盘菜单"启用 UI / 停用 UI"），首页主视觉不再显示说明小字，也不列举功能模块（避免"报菜名"、新增功能无需改首页）；面板由品牌美术撑起：放大的收容图形 + SLGO 准星刻度 + 渐隐 HUD 网格，UI 启用时整体点亮为橙色。代码与 spec 中的 overlay 术语不变。
- D6 应用图标：本任务新设计 SLUI 专属图标（沿用 SLGO 配色与母题），替换 Tauri 默认图标，用于 exe、任务栏、托盘与主界面品牌区。

## Requirements

- R1 只改视觉、布局与窗口外框。设置项集合、控件语义、取值范围、默认值、存储格式，以及覆盖层 / 托盘 / 单实例 / 快捷键行为全部不变。
- R2 左侧导航在首页与设置间切换，当前页高亮；切换不丢失未保存的输入状态（设置仍为即时保存）。
- R3 首页展示三项连接状态（含现有的未检测 / 未连接 / 过期 / 未授权等文案与"重试"）和覆盖层主开关（启用 / 停用、忙碌、错误提示），覆盖层状态是首页最醒目的元素。首页另附"游戏内按键"提示（商店键取自设置，Y / U 为固定聊天键），只展示、不可编辑。
- R4 设置页分雷达、快捷键、声音三组；每组保留"恢复默认"，保留保存失败提示、快捷键捕获与拒绝提示、"模糊背景"等说明文字。
- R5 自绘标题栏：可拖动移动窗口、双击不触发最大化、最小化按钮、关闭按钮（等同系统关闭：隐藏到托盘）。窗口不可最大化。
- R6 统一品牌视觉（D4/D5），控件（开关、滑条、数值框、下拉、按钮、键位按钮）按新风格重绘，保留键盘可达与 focus-visible 样式。
- R7 SLUI 图标：交付 SVG 源文件（入库），并生成 Tauri 全套图标替换 `src-tauri/icons/`。
- R8 在 home 窗口的默认尺寸与最小尺寸下布局不溢出、不出现横向滚动；设置页内容可纵向滚动，标题栏与导航固定。

## Acceptance Criteria

- [x] AC1 浏览器预览 `/?window=home` 下首页与设置页呈现启动器风格（左导航、品牌区、自绘标题栏），配色与字体符合 D4；用户对视觉稿确认通过。
- [x] AC2 首页覆盖 Steam 未登录 / 已登录、游戏运行 / 未运行、服务器各连接状态（含重试）与覆盖层启用 / 停用 / 忙碌 / 错误，文案与现状一致。
- [x] AC3 设置页 11 项雷达设置、商店快捷键、商店音效音量的控件类型、范围、默认值与原实现一致；修改即时保存并在覆盖层生效；三组"恢复默认"可用。
- [x] AC4 默认尺寸与最小尺寸下截图无溢出、无横向滚动、标题栏与导航不随内容滚动。
- [x] AC5 Windows 实机：拖动标题栏移动窗口；最小化 / 从任务栏还原正常；关闭按钮隐藏到托盘、托盘左键重新打开；窗口无法最大化。
- [x] AC6 exe、任务栏、托盘、主界面品牌区显示新 SLUI 图标；SVG 源文件在仓库可追溯。
- [x] AC7 回归：`09-07-app-home-settings/research/windows-smoke-checklist.md` 全部项在 Windows 实机复测通过。
- [x] AC8 `npm run lint`、`npm test`、`npm run build`、`npm run tauri:check` 通过。

## Out of Scope

- 新增 / 删除设置项、改变设置语义或存储。
- overlay（游戏内 HUD / 雷达 / 商店 / 聊天）视觉。
- logo 片头动画、启动闪屏、角色渲染大图背景。
- 浅色主题、多语言、窗口最大化与自由缩放布局适配之外的响应式设计。
- 重命名仓库、包名、Tauri `identifier` 或安装包名称。
