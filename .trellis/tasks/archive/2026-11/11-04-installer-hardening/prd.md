# 安装器加固

## Goal

卸载在文件残留时也能完成用户数据清理；`SLUI-Setup.exe /S` 可用于无人值守部署；「应用和功能」显示的大小正确；
NSIS 自带的「删除应用数据」选项不再删错账户。

## Requirements

- I1：NSIS 退出码 0、但校验发现 slui.exe 或主题包有残留（如文件被占用）时，`uninstall.rs` 直接返回 VerifyFailed，跳过 `remove_user_data()`。
  此时注册表项和卸载程序都已删除，重试只会显示「未找到已安装的 SLUI」。
  改为：退出码 0 且注册表项已删除时照样清理用户数据，返回成功并附上残留路径列表（界面上提示）。
- I2：`SLUI-Setup.exe /S` 现在打开界面等人点击。检测到 `/S` 时解出安装包，提权运行并转发 `/S [/NS] [/D=…]`，
  等待结束后用它的退出码退出；文档写明用法。
- I3：「应用和功能」的 EstimatedSize 没算 slui-uninstall.exe 和主题包。在 POSTINSTALL 末尾用 `${GetSize} "$INSTDIR" "/S=0K"` 重写。
- I4：直接以界面方式运行 `uninstall.exe` 时，NSIS 模板自带的「删除应用数据」选项在提权进程里执行，会删错账户的数据。
  处理方式以实测为准：隐藏/禁用该选项，或让它只删发起卸载的用户的数据。
- I5（security-csp-urls 时发现）：安装器外壳（提权运行）的 WebView 仍是 `"csp": null`
  （`installer/src-tauri/tauri.conf.json`）。它没有构建时的秘密地址，直接用 Tauri 的 `app.security.csp`
  写静态策略：以实际用到的来源为准（同源脚本/样式/字体/图片、`ipc: http://ipc.localhost`），
  其余 `'none'`。SLUI 本体的 CSP 是 Vite 生成的 meta，见 `scripts/vite-csp.mjs`。

## Acceptance Criteria

- [ ] I1 有单元测试；实测：占用 slui.exe 后卸载，用户数据仍被清理，界面列出残留。
- [ ] I2 实测：`SLUI-Setup.exe /S` 无界面完成安装，退出码正确；README 写明。
- [ ] I3 实测：「应用和功能」的大小与安装目录一致。
- [ ] I4 实测：直接运行 uninstall.exe 不会删除其他账户的数据。
- [ ] I5 安装和卸载界面在 CSP 下正常，控制台无 CSP 报错。
- [ ] Windows CI（build-and-test）通过；本机 `node scripts/build-installer.mjs --local` 能编译。

## Notes

- 依赖 #94 已合并（同一批文件）。
