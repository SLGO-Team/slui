# 设计：安装器加固

## I1 卸载有残留时照样完成（`installer/src-tauri/src/uninstall.rs`）

- `verify` 只把「退出码非 0」和「卸载注册项还在」当失败。退出码 0 且注册项已删时，SLUI 已无法再卸载（重试只会
  「未找到已安装的 SLUI」），于是照常删除用户数据，返回 `Ok`，附 `leftovers`（`slui.exe`、要求删除的主题包中还在的）。
- 完成页用错误色提示列出残留。`theme_pack_kept` 只在没要求删除主题包时为真。
- 实测：模板卸载前用 Restart Manager 强制关闭占用 `slui.exe` 的进程，`slui.exe` 基本不会残留；
  主题包中被占用的文件（Restart Manager 不管）是实际会出现的情况。

## I2 `SLUI-Setup.exe /S`（`lib.rs`、`install.rs`、`main.rs`）

- `/D=` 之前出现 `/S` 即静默安装：解出 NSIS 包，提权（RunAs）运行，参数原样转发，等待并以其退出码退出
  （UAC 拒绝 1，解包/启动失败 2）。不创建窗口，不走 WebView2。`--update` 更新路径不变。
- 未提权的调用者仍会看到一次 UAC；部署工具通常已提权。README 写明用法。

## I3 EstimatedSize（`installer-hooks.nsh` POSTINSTALL）

- 模板先按自身文件 + uninstall.exe 写 EstimatedSize，再调用钩子；钩子在写完主题包和 slui-uninstall.exe 后用
  `${GetSize} "$INSTDIR" "/S=0K"` 重写。

## I4 模板的「删除应用数据」（`installer-hooks.nsh` PRE/POSTUNINSTALL）

- 模板无法隐藏该复选框（页面函数由模板定义）。PREUNINSTALL 把勾选状态转存到 `$SluiDeleteUserData` 并清零，
  模板不再在提权进程里删；POSTUNINSTALL 做模板原有的注册表清理，并用 `nsis_tauri_utils::RunAsUser`
  经桌面 shell 以未提权的用户身份运行 `cmd /c rd`，`%APPDATA%` 即发起卸载的用户的。
- 代价：勾选时会闪一下命令行窗口。只在直接运行 uninstall.exe 并勾选时出现；品牌卸载程序不走这里。

## I5 安装器外壳 CSP（`installer/src-tauri/tauri.conf.json`）

- 静态 `csp`：同源脚本/样式/字体，`img-src 'self' data:`，`connect-src 'self' ipc: http://ipc.localhost`，其余 `'none'`；
  `devCsp` 放开 inline 与 `ws:` 供 Vite 开发服务器。

## 回滚

- revert 本 PR。安装器与 SLUI 包一起发布，旧版卸载程序不受影响。
