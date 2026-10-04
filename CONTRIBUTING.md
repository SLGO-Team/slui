# 参与开发

## 分支、PR 与提交

`main` 受保护：不能直接推送或强推，所有改动都通过 PR 合并。PR 必须通过 `build-and-test` 和 `pr-title`
两项检查，只能 squash 合并，不要求 review。

1. 从最新的 `main` 建分支，命名为 `<type>/<简短描述>`，例如 `fix/chat-scroll`。
2. 分支内的提交信息不做要求。推送后开 PR。
3. PR 标题遵循 [Conventional Commits](https://www.conventionalcommits.org/)：`type(scope): 描述`，scope 可选，
   中英文均可，例如 `feat(shop): 支持右键返还`。squash 合并时 PR 标题就是 `main` 上的提交信息，
   发版的版本号和 CHANGELOG 由它决定：
   - `feat` 提升 minor 版本，`fix`、`perf` 提升 patch 版本，并写入 CHANGELOG；
   - `docs`、`chore`、`ci`、`refactor`、`test`、`build`、`style` 不触发发版；
   - 破坏性变更在 type 后加 `!`，例如 `feat!: ...`。合并时只使用标题，PR 描述不会进入提交信息。
4. CI 通过后 squash 合并，合并后分支自动删除。

CI 在 Windows 上运行 `npm ci`、`npm run lint`、`npm test`、生产模式构建，以及两个 Rust crate 的编译和测试。

## 发版

版本号由 [release-please](https://github.com/googleapis/release-please) 维护，以下文件中的版本号始终一致，
由 `npm test` 中的 `scripts/version-check.mjs` 检查：

`package.json`、`package-lock.json`、`.release-please-manifest.json`、`src-tauri/tauri.conf.json`、
`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（含 `slui` 和 `slui-setup` 两项）、
`installer/src-tauri/tauri.conf.json`、`installer/src-tauri/Cargo.toml`。

不要手动改版本号。流程如下：

1. 每当有 PR 合并到 `main`，release-please 会创建或更新发版 PR `chore(main): release X.Y.Z`，
   其中包含版本号变更和 `CHANGELOG.md`。
2. 准备发版时合并这个 PR。随后自动创建标签 `vX.Y.Z` 和**草稿** Release，并构建
   `SLUI-Setup-X.Y.Z.exe` 上传到草稿。
3. 下载草稿中的安装器，安装并检查无误后，在 GitHub 上手动发布这个 Release。

构建失败时，修好问题后重跑 release 工作流中的 `installer` job 即可，上传会覆盖旧文件。如果要放弃这次发版，
删除草稿 Release 和标签，再把发版 PR 的标签改回 `autorelease: pending`。

维护者需要的仓库配置：

- 仓库变量 `RELEASE_APP_CLIENT_ID` 和 secret `RELEASE_APP_PRIVATE_KEY`：一个只安装在本仓库的 GitHub App，
  需要 Contents、Pull requests、Issues 的读写权限。用 App 令牌是为了让发版 PR 也能触发 CI。
- Environment `release`，只允许 `main` 使用，其中有 secret `CONTROL_PLANE_URL`，即正式安装器连接的控制平面地址。

## 本地构建安装器

```bash
npm run installer:build:local                                  # 连接 .env.development 中的后端
npm run installer:build                                        # 正式安装器，需要设置 VITE_CONTROL_PLANE_URL
node scripts/build-installer.mjs --theme-pack <dir>            # 打入本地主题包目录（可加 --local）
```

`--theme-pack` 把指定目录（包含 `fonts/` 和 `sounds/`）作为应用的 `theme-pack/` 资源打包，输出
`SLUI-Setup-<version>-theme-pack.exe`，不覆盖正式安装器，也不在仓库中写入任何文件。

## 公开内容规则

这是公开仓库，所有提交的内容（包括 `.trellis/`、提交信息和 PR）都会公开。`npm test` 中的
`scripts/public-content-check.mjs` 会检查以下几条：

- 不提交本机绝对路径。引用相邻仓库时写 `../<repo>`。
- SteamID 只使用占位值 `76561198000000000` 到 `76561198000000999`。
- 不提交游戏中提取的资源，也不在 `.trellis/` 下放图片、音频、字体等媒体文件。
- 主题包内容和生产服务器地址不进入仓库、CI 日志或 Actions artifact。
