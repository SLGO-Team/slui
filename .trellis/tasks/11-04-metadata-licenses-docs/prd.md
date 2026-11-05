# 元数据、许可证与文档

## Goal

安装包和代码元数据写明发布者 SLGO Team；随安装包分发依赖的许可证文本；协议包有入口说明。

## Requirements

- publisher / copyright：两个 `tauri.conf.json` 的 bundle 设 `publisher: "SLGO Team"` 和 copyright；
  Cargo `authors`、`packages/protocol/LICENSE` 版权方统一为 SLGO Team。
  - 改 publisher 会改 NSIS 的 `Software\<publisher>\<product>` 注册表键：必须在 Windows 上实测旧版本（publisher 默认 slui）覆盖升级、
    卸载、安装目录沿用都正常，旧键不残留或残留无害。
- Cargo 元数据：`src-tauri/Cargo.toml` 的 description 更新；两个 Cargo.toml 加 `repository`（以及 homepage）。
- 依赖许可证：用 cargo-about（Rust，Windows 目标的正式依赖）+ license-checker（npm，打进 dist 的依赖）生成
  `THIRD_PARTY_LICENSES.txt`，随安装包分发；生成命令写成 npm 脚本，文档说明何时重新生成。
  不允许的许可证（如 GPL 不兼容的）要能在生成时报错。
- D1：README 协议链接后补「协议说明见 packages/protocol/v0/README.md」（或给 packages/protocol 加 README）。
- D2：package.json 补 description / homepage / repository / bugs。

## Acceptance Criteria

- [x] 「应用和功能」里发布者显示 SLGO Team；从 0.x（旧 publisher）覆盖升级、卸载实测正常。
- [x] 安装目录里有 THIRD_PARTY_LICENSES.txt，覆盖 exe 里实际打包的 Rust 和 npm 依赖。
- [x] 元数据字段齐全；`npm test`（含 public-content-check）、cargo clippy/test 通过。

## Notes

- 依赖 `11-04-map-seed-decouple` 先完成，THIRD_PARTY 里不再需要 map-seed。

## 设计与调研（2026-11-05）

- publisher：Tauri NSIS 模板用它写 `Uninstall\SLUI` 的 `Publisher` 和 `HKLM\Software\<publisher>\SLUI`（默认值 = 安装目录）。
  旧版 publisher 缺省为 `slui`（identifier 中段）。品牌安装器和更新都以 `/S /D=<目录>` 静默运行，跳过重装页，
  不读这个键找旧目录；卸载入口 `Uninstall\SLUI` 键名不变，品牌安装器的检测（detect.rs）不受影响。
  旧键 `Software\slui\SLUI` 会残留，POSTINSTALL 钩子在 publisher 不是 slui 时删掉它。
- 许可证：cargo-about 0.9.3（CI 用 taiki-e/install-action 固定同版本）覆盖 Windows 目标的 normal 依赖，
  与 `cargo tree -e normal --target x86_64-pc-windows-msvc` 的 272 个 crate 一致；自有 crate 设 `publish = false` 并忽略。
  npm 侧没有用 license-checker：它的维护分支依赖 @npmcli/arborist，lockfile 多约 2000 行，只为 5 个运行时包；
  改用 npm 自带的 `npm ls --omit=dev --all --json --long`。npm 条目不写版本，Dependabot 升级不会让文件过期。
  两侧共用 `scripts/licenses/about.toml` 的 accepted 列表，不在列表里的许可证生成时报错（已实测两侧）。
  生成文件提交到仓库，CI `npm run licenses -- --check` 检查新鲜度；`bundle.resources` 装进安装目录。

## 实测（2026-11-05，本机，测前完整备份到 D:/Temp/slui-md-backup，测后还原并逐项比对一致）

- 第一次覆盖安装（`SLUI-Setup.exe /S /NS ...`，不带 `/D=`）装到了 `C:\Program Files\SLUI`：NSIS 找旧目录读
  `Software\<publisher>\SLUI`，publisher 一改就找不到。修复：品牌安装器静默路径没给 `/D=` 时补上卸载入口的
  `InstallLocation`（`silent_install_command`，有单测）。GUI 安装和自动更新本来就显式传 `/D=`，不受影响。
- 修复后从官方 0.11.0（publisher slui，D:）静默覆盖：退出码 0，装回 D:，`Publisher = SLGO Team`，
  `Software\SLGO Team\SLUI` 写入、`Software\slui` 删除，主题包保留，`THIRD_PARTY_LICENSES.txt` 在安装目录，
  slui.exe / slui-uninstall.exe 版本信息的公司与版权为 SLGO Team。
- `uninstall.exe /S`：卸载入口、程序文件、快捷方式删除；主题包和用户数据保留；`Software\SLGO Team\SLUI` 保留
  （模板一贯行为，只在勾「删除应用数据」时删，旧版的 `Software\slui\SLUI` 同样如此）。
- 官方 0.11.0 安装器没有 `/S`（#100 才加），还原时从其叠加数据取出 NSIS 包静默安装到原目录。
- 许可证生成改为从各包 package.json 读 license / repository：`npm ls --long` 对去重条目时有时无，导致两次输出不同。
