# 设计：更新器加固

- S5 地址：`updater_start` 不再接收地址。Vite 构建把校验过的 `VITE_CONTROL_PLANE_URL` 写成
  `dist/slui-build.json`（`scripts/vite-build-info.mjs`，只在 build 时），随前端一起嵌进 slui.exe；
  Rust 用 `app.asset_resolver()` 读嵌入的这份，套 backend.ts 的规则（https；http 只限 loopback）。
  没用 PRD 写的 `option_env!`：`tauri:build:local` 的地址来自 `.env.development`，不在 cargo 的环境变量里，
  build.rs 要复刻 Vite 的 env 文件规则；读构建产物则与前端 fetch 的地址天然一致，所有构建入口不用改。
  `tauri dev` 不嵌入前端，Tauri 的 asset resolver 回退读 `dist/`（上次 vite build 的）；没有就 unavailable。
- S5 下载上限：插件把整个包读进内存再验签。`download` 的 on_chunk 里累计字节（或 Content-Length）超过
  150 MB 就 notify，外层 `tokio::select!` 丢弃下载 future（请求随之中断），记为 `failed { signature }`。
- U1：`update_found` 不再无条件清掉已验证安装包，只有公布的版本不比它新（撤回）时才丢；
  `check_failed` 在非 Ready 时若有已验证安装包回到 Ready。`install_failed` 仍显示 Failed{launch}
  （否则玩家看不到启动失败），重试检查会回到 Ready。
- U2：启动失败写 diag、状态变 `failed { unavailable }`（前端新增该原因，文案「无法检查更新」）；
  未启动时 `updater_check_now` 返回 Err 并写 diag。
- U3：`plugins.updater.requireSignedVersion: true`；release.yml 用 `tauri signer sign --app-version`。
  兼容性：旧客户端（≤0.11.0）只看 trusted comment 的 `file:`，多一个 `version:` 字段不影响；
  slgo-deploy 的 `slui.sh` / `slui-update.ts` 按 tab 分隔匹配 `file:`，同样兼容。
  1.0 起的客户端拒绝没有 `version:` 的签名，所以此后每个发布都必须带它（release.yml 已改）。
