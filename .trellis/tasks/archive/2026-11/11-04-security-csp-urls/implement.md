# 实施清单

1. `scripts/vite-csp.mjs`（策略 + 插件），`vite.config.ts` 接入并改用 `readBackendConfig`。
2. `scripts/csp-smoke.mjs`：策略内容、meta 位置、内联脚本哈希、缺失/非法控制平面地址；加进 `npm test`。
3. Rust `sidecar_socket.rs`：`allow_plain_ws` + `local-backend` feature；`tauri.local.conf.json` 加 `build.features`。
4. protocol：`parseRoute` URL 校验；`toAssetUrl` 用于 avatar_url / icon_url；contract-smoke 用例。
5. 文档：protocol v0 README、spec system-boundaries / quality-guidelines。
6. 验证：
   - `npm run lint`、`npm test`、`npm run build`（`VITE_CONTROL_PLANE_URL=https://control-plane.invalid`）、
     `cargo test --workspace`、`cargo clippy --workspace --all-targets -- -D warnings`。
   - 浏览器 `dev:mock`：HUD / 商店 / 记分板 / 胜利面板 / 主页，控制台无 CSP 报错。
   - `tauri build --no-bundle`（local 配置 + 独立 identifier）+ CDP：IPC、主题包字体和音效、
     控制平面 fetch、https 图片均不触发 `securitypolicyviolation`，外部 origin 的 fetch 被拦。
