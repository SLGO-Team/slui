# CI、提交合并规范与发版流程

## Goal

slui 在公开仓库 `SLGO-Team/slui` 中开发。需要一套轻量但自动把关的流程：

- `main` 不会被弄坏，也不会混入不该公开的内容；
- 发版有固定步骤，版本号保持一致；
- 安装器构建可以选择打入一个本地主题包目录（可选功能，主题包不属于本仓库）。

原则：优先采用现成工具，不重复造轮子；规模按单人开发 + AI 会话设计，关卡越少越好，但关键检查必须自动化。

## Confirmed Decisions（2026-10-04）

- 正式包由 CI 在发版时构建，并发布到 GitHub Release。
- 不做代码签名和 Tauri 自动更新。
- `main` 开启保护：禁止直接推送和强推，必须经 PR 合并，CI 通过后才能合并，只允许 squash 合并，
  不要求 review。AI 会话也一律推分支、开 PR，等 CI 通过后再合并。
- 提交规范采用 Conventional Commits `type(scope): 描述`，中英文均可。因为是 squash 合并，只检查 PR 标题。
- 主题包内容永远不进仓库、CI 或任何公开产物（公开仓库的 Actions artifacts 所有人都能下载）。
  带主题包的构建只在本机进行。
- 候选的现成工具（实施前核对当前版本和用法）：
  - release-please（`googleapis/release-please-action`）：维护发版 PR 和 CHANGELOG，打标签并创建 Release；
  - `softprops/action-gh-release`：上传 `SLUI-Setup-<version>.exe`；
  - `amannn/action-semantic-pull-request`：检查 PR 标题；
  - GitHub Rulesets：分支保护；
  - `Swatinem/rust-cache` 加 `actions/setup-node` 的 npm 缓存；
  - Dependabot：可选。
  - 不用 `tauri-action`：分发的产物是自有的安装器外壳（`scripts/build-installer.mjs`），不是 Tauri 标准包。

## Background / Confirmed Facts

- 目前没有 `.github/`，也没有任何 CI。
- 版本号散在 4 处，都是 `0.1.0`：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、
  `installer/src-tauri/Cargo.toml`，外加对应的 `Cargo.lock`。`packages/protocol/package.json` 是 `0.0.0`，
  与客户端版本无关。
- 正式包需要在构建时通过环境变量 `VITE_CONTROL_PLANE_URL` 提供生产控制平面地址，然后运行
  `npm run installer:build`。地址刻意不写进仓库，CI 中应使用 Actions 仓库变量，也不得写入文件。
- 产物路径为 `src-tauri/target/release/bundle/setup/SLUI-Setup-<version>.exe`；`--reuse-payload`
  会复用 `bundle/nsis/` 中已有的 NSIS 包。
- 已有现成的拼装方式：`src-tauri/tauri.bundle-theme-pack.conf.json` 会把仓库根目录的 `theme-pack/`
  （已被 gitignore）作为资源打包，再用 `build-installer.mjs --reuse-payload` 套外壳。
  但它和正式包输出到同一路径，会覆盖正式包。
- `npm test` 已经包含 `scripts/public-content-check.mjs`。
- Trellis 的 journal 和任务归档提交（`.trellis/config.yaml` 中 `session_commit_message`）目前直接提交到 `main`。
  开启分支保护后，要改成在功能分支内提交、随 PR 一起合并。`add_session.py` 里有 worktree 相关的处理，
  需要核实具体行为。

## Requirements

- R1 PR CI（Windows runner）：`npm ci`、`npm run lint`、`npm test`、
  `cargo test --manifest-path src-tauri/Cargo.toml`、构建检查（不需要生产地址），以及 PR 标题检查。
- R2 按上述决定配置 `main` 的分支保护，CI 检查项设为必需检查。
- R3 发版：合入 `main` 的提交驱动版本号和 CHANGELOG；合并发版 PR 后自动打 `vX.Y.Z` 标签，
  4 处版本号（包括 Cargo.lock）保持一致。Release 先创建为草稿，构建并上传 `SLUI-Setup-<version>.exe`
  后，由用户手动发布。
- R4 `scripts/build-installer.mjs` 增加一个选项，可以打入指定的本地主题包目录，输出到不覆盖正式包的
  路径或文件名，构建结束后工作区保持干净。仓库内只描述这个功能，不描述任何具体的主题包。
  运维侧入口在运维仓库另行处理。
- R5 简短的 `CONTRIBUTING.md`：分支、PR 和提交规范，发版步骤，公开内容规则。README 保持精简，只放链接。
- R6 Trellis 收尾流程（journal、归档）在分支保护下可以正常使用。

## Acceptance Criteria

- [ ] 一个试验 PR：CI 全部通过；PR 标题不合规时检查失败；直接推送 `main` 被拒绝。
- [ ] 一次试验发版（可以用预发布版本号）：4 处版本号一致，自动生成标签和草稿 Release，
  Release 中有可以安装的 `SLUI-Setup`，并且连接生产服务器。
- [ ] 用 R4 的选项打入一个本地测试目录：产物里包含该目录，正式包产物没有被覆盖，工作区干净。
- [ ] 仓库、CI 日志和产物中都没有生产地址，也没有任何主题包内容。
- [ ] `CONTRIBUTING.md` 已就位；Trellis 收尾能在 PR 分支上跑通。

## Out of Scope

- 代码签名、自动更新、多平台构建。
- slgo-backend 和插件仓库的 CI（可以另开任务）。

## Notes

- 这是复杂任务：`task.py start` 之前要先补齐 `design.md` 和 `implement.md`。
- GitHub 仓库设置（Rulesets、Actions 变量）需要用户授权或手动操作。
- slui 是公开仓库：本任务的文档、提交信息和 PR 描述只写通用的技术内容，不写分发渠道和运维内部细节。
