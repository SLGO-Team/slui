# 设计：CSP 与服务器下发 URL 校验

## S1 CSP：由 Vite 构建生成 `<meta http-equiv="Content-Security-Policy">`

PRD 草案是 `tauri.conf.json` 的 `app.security.csp` + 构建时 `tauri build --config` 合并控制平面 origin。
没有这样做，原因：

- 构建 slui 的入口不止一个：`build-installer.mjs`（release.yml、slgo-deploy `Slui.psm1`）、
  `npm run tauri:build:local`，以及 slgo-deploy `local/test/slui-update-client.ps1` 直接 `tauri build`。
  每个入口（含另一个仓库）都得各自算 origin 并传 `--config`；漏一个就是连不上控制平面的包。
- 控制平面地址本来就是 Vite 构建输入 `VITE_CONTROL_PLANE_URL`，前端 `fetch` 用的也是它。
  让同一次 Vite 构建从同一个值生成 CSP，fetch 目标和 CSP 永远一致，所有入口零改动。
- Tauri 2.12 桌面端 dev 直接加载 devUrl（`PROXY_DEV_SERVER` 只在移动端），`devCsp` 不会生效；
  Tauri 的 CSP 头只加在正式构建 `tauri://` 协议返回的 HTML 上。meta 在 dev server 里也能生效。

`tauri.conf.json` 的 `csp` 保持 `null`：若同时配置，头和 meta 取交集，头里没有控制平面就会把它拦掉。

### 实现

- `vite.config.ts` 用 `readBackendConfig`（`src/platform/backend.ts`）读控制平面地址，取代原来只查
  「有没有值」的 `checkBackend`：构建时就拒绝非 https（loopback 除外）的地址，与运行时同一套规则。
- `scripts/vite-csp.mjs`：纯函数 `buildContentSecurityPolicy` + Vite 插件。插件在
  `transformIndexHtml`（`order: "post"`，看到其他插件注入后的最终 HTML）里：
  - 对 HTML 里的内联 `<script>` / `<style>` 算 sha256 加进 script-src / style-src
    （正式构建没有内联脚本；dev 有 plugin-react 的 refresh preamble）；
  - 把 meta 插到 `<head>` 最前面，早于任何脚本和样式。
- 正式（`vite build`，含 `build:local`）策略：

  ```
  default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:;
  font-src 'self' theme: http://theme.localhost; media-src 'self' theme: http://theme.localhost;
  connect-src 'self' ipc: http://ipc.localhost <控制平面 origin>; object-src 'none'; base-uri 'none';
  form-action 'none'; frame-src 'none'; worker-src 'none'
  ```

  来源核对：Vite 产物只有外链脚本和样式表；CSS / JS 里有 `data:image/svg+xml`（小图内联、
  雷达洗色图 `roomWash.ts`）；Steam 头像是 `data:image/png|jpeg`；服务器头像和商店图标是 https；
  主题包字体（`FontFace`）和音效（`new Audio`）走 `theme` 协议；雷达美术 `fetch` 同源；
  sidecar WebSocket 在 Tauri 里走 Rust，不经过 connect-src。
- dev server（`npm run dev` / `dev:mock` / `tauri dev`）：style-src 加 `'unsafe-inline'`（Vite 用
  `<style>` 注入 CSS），connect-src 加 `ws: wss:`（HMR，以及浏览器预览里 webview 自己连 sidecar）。

## S2 sidecar_endpoint

- 前端：`parseRoute` 从 `startsWith("wss://")` 改为按 URL 解析，要求 `wss:`、无 userinfo。
  本地构建的 `ws://` 只来自开发覆盖 `VITE_DEV_SIDECAR_ENDPOINT`（`readBackendConfig` 已限定
  DEV 构建 + loopback），路由本身永远要求 wss。
- Rust：新增 cargo feature `local-backend`，由 `tauri.local.conf.json` 的 `build.features` 打开
  （`tauri:build:local` 和 `build-installer --local` 都合并这个文件）。
  `ws://` 只在 `debug_assertions`（`tauri dev`、测试）或 `local-backend` 下接受，且仍限 loopback；
  正式构建只接受 `wss://`。`parse_target` 带 `allow_plain_ws` 参数，测试覆盖两种构建。

## S3 avatar_url / icon_url

- protocol 新增 `toAssetUrl(value)`：字符串、≤ 512 字符、`new URL` 可解析、协议 `https:`、
  无 userinfo，返回规范化后的 `href`（`"`、空白、换行已被 URL 序列化编码或去掉，可安全放进
  CSS `url("…")`）；否则 `null`。
- `parseMatchSnapshot`（player `avatar_url`）、`parseShopSnapshot`（item `icon_url`）、
  `parseShopRequests`（request `icon_url`）：字段存在时换成 `toAssetUrl` 的结果，不再因类型错误
  拒绝整个负载。返回新对象，不改调用方传入的对象。
- 展示层已有回退（默认头像、`SHOP_FALLBACK_ICONS`），`null` 直接走回退。

## 兼容性

- 插件：头像来自 Steam（https），`icon_url` 目前恒为 `null`，不受影响。
- 本地后端：`build:local` 的控制平面 `http://127.0.0.1:7800` 进 connect-src；dev sidecar `ws://`
  由 `local-backend` feature 放行。
