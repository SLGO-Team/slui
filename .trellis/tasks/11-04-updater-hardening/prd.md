# 更新器加固

## Goal

更新器的检查地址不受前端控制，下载有上限，已验证的安装包不会被一次失败的新检查弄丢，启动失败看得见，签名绑定版本。

## Requirements

- S5 地址：`updater_start` 现在用前端传入的地址，接受任意 `http://` 主机，第一个调用者锁定本次运行的地址。
  改为编译时固定（`option_env!("VITE_CONTROL_PLANE_URL")`），至少套用 `backend.ts` 的规则（只允许 https，http 只限 localhost）。
- S5 下载上限：签名校验前整个文件在内存里，没有大小上限。超过约 150 MB 就中止。
- U1：服务器公布更新的版本时会先 `self.verified = None`，新版本下载/校验失败后就没有可装的了。
  - 场景：0.7.0 要求 min 0.8.0，0.8.0 已下载好；服务器公布 0.9.0 但下载失败（或 .sig 不匹配），玩家就连不上服务器。
  - 新文件验证通过前保留旧的已验证安装包；check_failed / install_failed 时若还有已验证安装包，回到 Ready。
- U2：`updater_start` 失败时没写 diag 日志；没启动时 `updater_check_now` 只 notify 一个没人等的 Notify，按钮点了没反应。
  写 diag 日志；未启动时 check_now 返回 Err；启动失败在界面上显示为 Failed（或隐藏按钮）。
- U3：签名带上版本号，`plugins.updater.requireSignedVersion: true`（若 Tauri 版本支持；不支持则用 trusted comment 里的版本校验）。
  要与 slgo-deploy 的签名/发布流程一致，确认不会让现有版本升级失败。

## Acceptance Criteria

- [ ] 前端传入的地址不再决定检查地址；不合规地址被拒绝。
- [ ] 超限下载中止并报错，不占满内存。
- [ ] U1 场景有单元测试：新版本失败后仍能安装旧的已验证安装包。
- [ ] U2：未启动时点「检查更新」有明确结果，diag 日志有启动失败原因。
- [ ] U3 的签名/校验方式与发布流程兼容（旧客户端升级到新版本不受影响）。
- [ ] cargo clippy `-D warnings`、workspace 测试、`npm test` 通过。
