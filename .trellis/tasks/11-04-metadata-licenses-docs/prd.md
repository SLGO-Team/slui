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

- [ ] 「应用和功能」里发布者显示 SLGO Team；从 0.x（旧 publisher）覆盖升级、卸载实测正常。
- [ ] 安装目录里有 THIRD_PARTY_LICENSES.txt，覆盖 exe 里实际打包的 Rust 和 npm 依赖。
- [ ] 元数据字段齐全；`npm test`（含 public-content-check）、cargo clippy/test 通过。

## Notes

- 依赖 `11-04-map-seed-decouple` 先完成，THIRD_PARTY 里不再需要 map-seed。
