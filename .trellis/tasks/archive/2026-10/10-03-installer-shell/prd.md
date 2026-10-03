# 安装器外壳

## Goal

给 SLUI 提供品牌化的安装器 `SLUI-Setup-x.y.z.exe`：界面沿用 SLUI 主页视觉语言（深蓝面板、橙色强调、
HUD 角括号、全中文），替代 NSIS 经典 Win32 向导的首装与升级体验。落盘、注册表、快捷方式、卸载项仍由
现有 NSIS 包负责，外壳只负责界面与调度。

## Background

- 打包现状：Tauri 2 NSIS，`installMode: "perMachine"`（提交 `5422bd5`），需要 UAC，默认
  `C:\Program Files\SLUI`；`tauri:build:local` 只出 NSIS。NSIS 开关、注册表位置、退出码、体积见
  `research/nsis-payload-facts.md`。
- NSIS 包约 102 MB（前端 `dist/` 嵌入主程序），静默安装不报告进度百分比。
- 主程序运行时配置写在 `app_config_dir`，不依赖安装目录可写。
- 视觉规范在 `src/app/home/home.css`；字体只允许 SIL OFL（Chakra Petch / Barlow / Noto Sans SC）。
- 项目没有 Tauri updater，没有 CI / Release 流程，没有代码签名证书。

## Requirements

- R1 范围：安装 + 升级识别。按已安装状态分流（读 HKLM 卸载项，版本按 semver 比较）：
  - 未安装：欢迎（一键安装到默认目录）→ [可选] 自定义位置 → 进度 → 完成
  - 已安装且较旧：显示"已安装 a → b"，主按钮"更新"，沿用原目录、不显示安装选项
  - 同版本：提供"启动"与"重新安装"
  - 卸载 / 修复不在外壳内提供
- R2 分发：对外只发外壳单文件，NSIS 包内嵌，运行时解压到临时目录后调用；NSIS 包仅作内部产物。
- R3 WebView2 兜底：外壳在创建窗口前检测 WebView2；缺失时以交互模式运行内嵌 NSIS（经典向导，由其安装
  WebView2）后退出。
- R4 降级：已安装版本高于安装包时阻止安装，只提供"启动"。
- R5 界面：约 640×440 无边框窗口，没有标题栏：最小化 / 关闭悬浮在右上角，空白处可拖动窗口，全中文。每页单列居中：标志 → 标题 → 内容 →
  居中的单一主按钮。首装欢迎页直接内嵌安装选项（路径输入、浏览、所需 / 可用空间、"创建开始菜单快捷方式"、
  "创建桌面快捷方式"，两个开关独立、默认开），没有单独的位置页；同版本点"重新安装…"在原页展开同一组选项。
  完成页"启动 SLUI" / "关闭"。失败页显示摘要与 NSIS 退出码，"重试" / "关闭"。
- R6 提权时机：外壳以普通权限运行，点击"安装 / 更新 / 重新安装"时才触发 UAC；从完成页启动的 SLUI 为
  普通权限。
- R7 进度：不确定式进度条 + 阶段文字（准备安装文件 / 等待授权 / 正在安装）；安装中禁用关闭。
- R8 SLUI 正在运行时，在将要安装的欢迎页提示"安装时会关闭正在运行的 SLUI"（NSIS 静默模式会直接结束它）。
- R9 不留垃圾：外壳自身的 WebView2 数据与解压的安装包放在临时目录，退出后清理，不在
  `%LOCALAPPDATA%` 留目录。

## Change Request (2026-10-03, after E2E) — R5 界面重做（已并入 R5）

用户反馈：
- 视觉没有中心导向，内容分散在四周；安装器应有明确的视觉中心与单一主操作。
- 修改路径与快捷方式要进二级页面不合理：应在主界面直接可见、可改。
- 快捷方式需要两个独立选项：开始菜单、桌面（对应已实现的 `/SLUI-STARTMENU` / `/SLUI-DESKTOP`）。

## Acceptance Criteria

- [x] AC1（R1/R2）全新机器状态运行 `SLUI-Setup-x.y.z.exe` 一键安装，结果与直接运行 NSIS 包一致：
      HKLM 卸载项版本正确、开始菜单快捷方式存在、"应用和功能"可卸载。
- [x] AC2（R1/R5）自定义安装到 `D:\Program Files\SLUI` 成功；关闭"桌面快捷方式"时不创建桌面快捷方式。
- [x] AC2b（R5）首装页直接可改路径与两个快捷方式开关；开始菜单、桌面各自按开关创建（`/SLUI-STARTMENU` /
      `/SLUI-DESKTOP` 分别传入）。浏览器 mock、`cargo test` 与真机均已验证。
- [x] AC3（R1）已装旧版时显示"更新"、不显示安装选项，更新后装在原目录、版本为新版本。
- [x] AC4（R1）同版本时出现"启动"与"重新安装"，两者都可用。
- [x] AC5（R4）已装新版时只出现"启动"，后端命令同样拒绝安装。
- [x] AC6（R3）WebView2 缺失（或用测试开关模拟）时出现经典 NSIS 向导，外壳退出。
- [x] AC7（R6）UAC 在点击安装时出现；拒绝 UAC 回到上一页并提示，未安装任何内容。
- [x] AC8（R5/R7）安装失败时显示失败页和退出码；成功判定以注册表版本 + `slui.exe` 存在为准，不只看退出码。
      （失败页仅在浏览器 mock `?state=fail` 中验证；真机未构造 NSIS 失败）
- [x] AC9（R5）可用空间不足或路径无效时安装按钮禁用并说明原因。
- [x] AC10（R8）SLUI 运行中时出现关闭提示，安装后旧进程已结束、新版可启动。
- [x] AC11（R9）关闭外壳后不存在 `%LOCALAPPDATA%\com.slui.setup`，临时目录已清理。
- [x] AC12 主页视觉在令牌抽取前后不变；`npm run lint`、`npm test`、外壳 `cargo test` 通过；
      `npm run tauri …` 在仓库根目录仍解析到主程序。
- [x] AC13 README 与 directory-structure spec 说明 `installer/`、构建命令与产物位置。

## Out of Scope

- 替换 NSIS 作为安装引擎；MSI / WiX 界面
- 外壳内卸载、修复；真实进度百分比（需自定义 NSIS 模板）
- 代码签名、CI 发布流程、Tauri updater 接入
- 识别旧版 currentUser（HKCU）安装
