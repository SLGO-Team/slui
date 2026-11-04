# 安全：CSP 与服务器下发 URL 校验

## Goal

正式版 WebView 有 CSP；服务器下发、会被客户端用来发起请求的 URL 都先校验。

## Requirements

- S1 CSP：`tauri.conf.json` 现在是 `"csp": null`。
  - 正式版 CSP 草案：`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:;
    font-src 'self' theme: http://theme.localhost; media-src 'self' theme: http://theme.localhost;
    connect-src 'self' ipc: http://ipc.localhost <控制平面 origin>; object-src 'none'; base-uri 'none';
    form-action 'none'; frame-src 'none'; worker-src 'none'`，以实际代码用到的来源为准逐项核对。
  - 控制平面 origin 是构建时注入的 secret，不写进仓库；构建时用 `tauri build --config` 合并。
  - devCsp：connect-src 加 Vite HMR 的 `ws://localhost:1420`，style-src 加 `'unsafe-inline'`。
  - 主题包字体和音效：Windows 是 `http://theme.localhost/`，其他系统是 `theme://localhost/`。
  - `npm run tauri:build:local`（连本地后端的测试包）要能用。
- S2 `route.sidecar_endpoint`：正式版只接受 `wss://`；`ws://` 只在本地测试构建里、且只限 localhost。
  - 现状：`src-tauri/src/sidecar_socket.rs` 正式版也接受 `ws://localhost`；protocol `parseRoute` 对 endpoint 不校验。
  - 风险：服务器下发的地址能让客户端连本机任意端口并带上 session_token。
- S3 `avatar_url` / `icon_url`：只接受 `https:`、长度 ≤ 512；不合格置为 `null`（不拒绝整个负载）。
  - 用到的地方：hud/presentation → HudTeamCounter、Scoreboard、WinPanel；shop/presentation → ShopPanel 的 CSS `url()`。

## Acceptance Criteria

- [x] 正式构建的 CSP 生效，mock 预览和 `tauri:build:local` 下 HUD、商店、主题包字体/音效、头像都正常，控制台无 CSP 报错。
- [x] `parseRoute` 对非 wss（正式版）或非本机 ws（本地构建）的 sidecar_endpoint 报错；Rust 侧同样拒绝。
- [x] avatar_url / icon_url 的 http、data、javascript、超长值都变成 null，有 smoke 用例。
- [x] `npm run lint`、`npm test`、`npm run build`、cargo clippy/test 通过。

## 实现说明

- CSP 改由 Vite 构建写进 `index.html` 的 meta（理由见 design.md）；`tauri.conf.json` 的 `csp` 保持 null，`devCsp` 不用。
- 验证（2026-11-04）：`dev:mock` 浏览器预览（HUD、商店含主题包字体和音效、主页 data: 头像）无 CSP 报错；
  `tauri build --no-bundle`（local 配置、独立 identifier）+ CDP：home 和 overlay 两个窗口 IPC、全部字体、
  主题包字体和音效、https 图片都正常，无违规；外部 origin 的 fetch 被拦（对照）；本地构建 Rust 接受
  loopback `ws://`、拒绝非本机 `ws://`，正式版拒绝 `ws://` 由单元测试覆盖。
- 顺带发现：安装器外壳 WebView 也是 `csp: null`，已记到 `11-04-installer-hardening`（I5）。
