# 执行计划

1. I1：`verify` 改返回残留列表；`UninstallOutcome::Ok.leftovers`；前端 model / mock（`state=locked`）/ Done；smoke 夹具。
2. I2：`silent_install_args` + `install_silently`；README。
3. I3 / I4：`src-tauri/windows/installer-hooks.nsh`。
4. I5：安装器 `tauri.conf.json` 的 `csp` / `devCsp`。
5. spec：quality-guidelines 的安装器契约补静默安装、残留、EstimatedSize、复选框接管、CSP。

## 验证

```bash
cargo clippy --workspace --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --workspace --manifest-path src-tauri/Cargo.toml
npm run lint && npm test
node scripts/build-installer.mjs --local
```

真机（UAC 在开发机上自动通过；测前备份已安装的版本，测后还原）：
- `/S /NS /SLUI-STARTMENU` 覆盖安装：退出码 0、无界面、装回原目录；EstimatedSize 与目录大小一致。
- 锁住主题包内文件，品牌卸载勾选删除主题包与用户数据：完成页列出残留，用户数据被删，注册项被删。
- 直接运行 uninstall.exe 勾选「删除应用数据」：给 `%APPDATA%\com.slui.desktop` 目录打 High 完整性标签，
  卸载后目录仍在（未提权删不掉）而其中文件被删，证明删除以未提权身份执行。
- 安装/卸载界面经 CDP 读控制台无 CSP 报错；`fetch` 外部地址被 CSP 拦截。
