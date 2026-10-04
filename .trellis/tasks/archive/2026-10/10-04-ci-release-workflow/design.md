# Design：CI、提交合并规范与发版流程

## 1. 总览

```
功能分支 ──PR──▶ ci.yml (build-and-test) + pr-title.yml (pr-title) ──必需检查──▶ squash 合并到 main
                                                                                    │
main push ──▶ release.yml: release-please (GitHub App 令牌)                          │
                ├─ 维护发版 PR "chore(main): release X.Y.Z"（改版本号 + CHANGELOG）◀──┘
                └─ 发版 PR 合并后：创建草稿 Release + 立即打 vX.Y.Z 标签
                       └─ installer 任务（Windows，environment: release）
                            npm run installer:build（注入生产地址 secret）
                            gh release upload vX.Y.Z SLUI-Setup-X.Y.Z.exe
                       ──▶ 用户手动验证并发布草稿
```

新增和修改的文件：

| 文件 | 作用 |
|------|------|
| `.github/workflows/ci.yml` | PR 和 main push 时运行 lint、测试和构建检查 |
| `.github/workflows/pr-title.yml` | PR 标题 Conventional Commits 检查 |
| `.github/workflows/release.yml` | release-please，加上安装器构建和上传 |
| `.github/dependabot.yml` | 只管理 `github-actions`，每月一次，提交前缀为 `ci` |
| `release-please-config.json`, `.release-please-manifest.json` | release-please 配置 |
| `scripts/version-check.mjs` | 版本号一致性检查，接入 `npm test` |
| `scripts/build-installer.mjs` | 新增 `--theme-pack <dir>` |
| `src-tauri/tauri.bundle-theme-pack.conf.json`、npm 脚本 `tauri:build:with-theme-pack` | 删除，由 `--theme-pack` 取代 |
| `CONTRIBUTING.md`、`README.md`、`AGENTS.md`（Trellis 托管块之外） | 流程文档 |

## 2. PR CI

### 2.1 `ci.yml`，job `build-and-test`（windows-latest）

- 触发：`pull_request`（默认类型）、`push` 到 `main`。main push 用来生成 main 上的缓存，PR 可以读取 main 的缓存。
- `permissions: contents: read`；`concurrency` 按 ref 分组，并开启 `cancel-in-progress`。
- 不做路径过滤：必需检查如果因为过滤被跳过，会一直停在 pending，PR 就合不进去。
- 步骤：
  1. `actions/checkout@v7`
  2. `actions/setup-node@v7`，`node-version: 24`，`cache: npm`
  3. `npm ci`
  4. `npm run lint`
  5. `npm test`（包括公开内容检查和新增的版本一致性检查）
  6. `npm run build`：tsc 加生产模式的 vite build。`vite.config.ts` 在构建前就会检查地址是否存在，所以这一步
     设置 `VITE_CONTROL_PLANE_URL: https://control-plane.invalid`（`.invalid` 是保留域名，永远无法解析）。
     这样构建路径与发版完全一致，只是地址不同。
  7. `npm run installer:vite:build`：安装器外壳的前端，`installer/src-tauri` 编译时需要它。
  8. `Swatinem/rust-cache@v2`，`workspaces: src-tauri -> target`。安装器外壳通过 `.cargo/config.toml` 共用这个 target 目录。
  9. `cargo test --manifest-path src-tauri/Cargo.toml`
  10. `cargo check --manifest-path installer/src-tauri/Cargo.toml`：debug 构建不带 payload，走 `cfg(slui_setup_no_payload)`。

### 2.2 `pr-title.yml`，job `pr-title`（ubuntu-latest）

- 触发：`pull_request`，类型为 `opened, edited, synchronize, reopened`。单独放一个工作流，修改标题时不会重跑几分钟的 Windows 构建。
  加上 `synchronize` 是因为必需检查挂在 head SHA 上，推送新提交后需要重新检查。
- `amannn/action-semantic-pull-request@v6`，使用默认类型列表，scope 可选，描述中英文均可。
- `permissions: pull-requests: read`。

### 2.3 安全

- 只用 `pull_request`，不用 `pull_request_target`。fork 的 PR 拿不到 secret，`GITHUB_TOKEN` 也只有只读权限。
- 两个 PR 工作流都不需要任何 secret。

## 3. 分支保护和仓库设置

由用户授权后通过 `gh api` 配置，或者由用户手动操作。

- Ruleset `main`，目标是默认分支，状态为 active，不设 bypass actor，管理员也受约束：
  - `deletion`、`non_fast_forward`
  - `pull_request`：`required_approving_review_count: 0`，`allowed_merge_methods: ["squash"]`
  - `required_status_checks`：`build-and-test`、`pr-title`，`integration_id` 为 GitHub Actions；不开启 strict
- 仓库设置：只允许 squash；`squash_merge_commit_title: PR_TITLE`，`squash_merge_commit_message: BLANK`；
  `delete_branch_on_merge: true`。
  - 提交信息正文设为 BLANK 的原因：release-please 会解析整条提交信息，分支上的提交列表或 PR 描述里
    以 `feat:` 开头的行可能被误读成变更。破坏性变更请用 `feat!:` 这种标题写法。
- 先运行一次 CI，再创建 Ruleset，这样检查名在 GitHub 上已经存在，便于核对。

## 4. 发版

### 4.1 release-please 配置

`release-please-config.json`：

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "bootstrap-sha": "40ebdd82bba1c939ea08c459ed49a6daaeae5873",
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "slui",
      "include-component-in-tag": false,
      "draft": true,
      "force-tag-creation": true,
      "extra-files": [
        { "type": "json", "path": "src-tauri/tauri.conf.json", "jsonpath": "$.version" },
        { "type": "json", "path": "installer/src-tauri/tauri.conf.json", "jsonpath": "$.version" },
        { "type": "toml", "path": "src-tauri/Cargo.toml", "jsonpath": "$.package.version" },
        { "type": "toml", "path": "installer/src-tauri/Cargo.toml", "jsonpath": "$.package.version" },
        { "type": "toml", "path": "src-tauri/Cargo.lock", "jsonpath": "$.package[?(@.name.value==='slui')].version" },
        { "type": "toml", "path": "installer/src-tauri/Cargo.lock", "jsonpath": "$.package[?(@.name.value==='slui-setup')].version" }
      ]
    }
  }
}
```

- `.release-please-manifest.json`：`{ ".": "0.1.0" }`。
- `release-type: node` 本身会更新 `package.json` 和 `package-lock.json` 的根版本（两处）。
- 两个 Cargo.lock 的 JSONPath 过滤写的是 `@.name.value`，因为 release-please 的 TOML 解析器会把每个值
  包成 `{ value, start, end }`（见上游 `src/util/toml-edit.ts`）。这条路径实施时必须验证，第 4.3 节的检查脚本兜底。
- `draft: true` 和 `force-tag-creation: true`（release-please 17.2 起支持，action v5 内置 17.6）：
  草稿 Release 不会等到发布才打标签，下一次运行 release-please 能找到上一个版本。
- `installer/src-tauri/tauri.conf.json` 的 version 在构建时会被 `build-installer.mjs` 用 `--config` 覆盖，
  但仍然一起更新，保证仓库内所有版本号一致。
- 首次发版：0.1.0 已经有人在用，所以首个 Release 是下一个版本。这里沿用默认规则，0.x 版本中 `feat`
  提升 minor，因此本任务合并后会生成 0.2.0。这次发版就是验收所说的试验发版；草稿可以删除，不对外公开。

### 4.2 `release.yml`

- 触发：`push` 到 `main`。`permissions: {}`，每个 job 单独声明权限。
  `concurrency: release`，不开启 cancel-in-progress。
- job `release-please`（ubuntu-latest）：
  1. `actions/create-github-app-token@v3`，参数为 `client-id: ${{ vars.RELEASE_APP_CLIENT_ID }}`、
     `private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}`。
  2. `googleapis/release-please-action@v5`，传入 `token`、`config-file` 和 `manifest-file`。
  3. 输出 `release_created`、`tag_name`、`version`。
  - 必须用 App 令牌：用 `GITHUB_TOKEN` 创建的 PR 不会触发其他工作流，发版 PR 就拿不到必需检查。
- job `installer`（windows-latest）：条件为 `needs.release-please.outputs.release_created == 'true'`，
  `environment: release`，`permissions: contents: write`。
  1. checkout，`ref` 设为标签。
  2. setup-node（cache npm），然后 `npm ci`。
  3. `Swatinem/rust-cache@v2`，`key: release`。release profile 的缓存与 PR 的 debug 缓存分开。
  4. 检查 `CONTROL_PLANE_URL` 是否为空，为空就直接失败，不允许打出连不上服务器的包。
  5. `npm run installer:build`，环境变量 `VITE_CONTROL_PLANE_URL: ${{ secrets.CONTROL_PLANE_URL }}`。
  6. 核对产物文件名中的版本与标签一致，然后执行
     `gh release upload "$TAG" "src-tauri/target/release/bundle/setup/SLUI-Setup-$VERSION.exe" --clobber`（`GH_TOKEN: github.token`）。
     这里用 gh CLI 而不是 `softprops/action-gh-release`：后者按标签查找 Release 时找不到草稿，可能另建一个
     Release；gh 在 runner 上已经预装。
  - 构建失败后可以单独重跑这个 job，Release 和标签已经存在，`--clobber` 保证重跑是幂等的。
- 不上传 Actions artifact。安装器只出现在草稿 Release 中，由用户检查后发布。

### 4.3 版本一致性检查 `scripts/version-check.mjs`

- 读取 `package.json`、`package-lock.json`（`version` 和 `packages[""].version`）、两个 `tauri.conf.json`、
  两个 `Cargo.toml` 的 `[package] version`、两个 `Cargo.lock` 中 `slui` / `slui-setup` 的版本，以及
  `.release-please-manifest.json` 的 `"."`。不一致就列出每一处的值并以退出码 1 结束。
- 用正则或小型解析读取 TOML，不新增依赖。
- 接入 `npm test`，因此发版 PR 上的 CI 会拦住任何漏改的版本号，这个检查就是一致性的唯一判定。

### 4.4 生产地址

- 存为 Environment `release` 的 secret `CONTROL_PLANE_URL`。Environment 的部署分支策略只允许 `main`。
  - 不用 Actions 变量：变量值会以明文出现在步骤日志的 env 段。
  - 不用仓库级 secret：同仓库任何分支上的工作流都能读到。Environment 加分支策略后，只有 main 上的工作流能读。
- 安装器必须连到生产服务器，所以 Release 中的 exe 内含这个地址，这是不可避免的。验收里的“产物不含生产地址”
  指仓库、日志和 Actions artifact。

### 4.5 GitHub App（用户手动创建）

- 在 SLGO-Team 组织下创建私有 App，不需要 webhook。仓库权限：Contents、Pull requests、Issues 设为
  Read & write（Issues 用于 release-please 的 `autorelease:*` 标签）。只安装到 `slui`。
- 仓库变量 `RELEASE_APP_CLIENT_ID`（Client ID 不是机密）；仓库 secret `RELEASE_APP_PRIVATE_KEY`。

## 5. `build-installer.mjs --theme-pack <dir>`

- 支持 `--theme-pack <dir>` 和 `--theme-pack=<dir>` 两种写法，可以和 production 或 `--local` 组合。
  和 `--dev` 或 `--reuse-payload` 同时使用时报错，因为 payload 必须包含主题包。
- 校验：路径解析为绝对路径，必须是存在且非空的目录，否则报错。
- NSIS 构建改为直接调用 Tauri CLI（`process.execPath tauri.js`，不经过 shell，避免 Windows 下 JSON 参数的引号问题）：
  - production：`build --bundles nsis`
  - local：`build --config src-tauri/tauri.local.conf.json --bundles nsis`
  - 主题包：再追加 `--config {"bundle":{"resources":{"<abs>/":"theme-pack/"}}}`。Tauri v2 按顺序合并多个 `--config`。
  - 配置以内联 JSON 传入，不写任何文件，工作区保持干净。
- 输出：`bundle/setup/SLUI-Setup-<version>-theme-pack.exe`，不覆盖正式包。
- 收尾：
  - 把这次生成的 NSIS 中间包 `bundle/nsis/SLUI_<v>_x64-setup.exe` 改名为 `...-theme-pack.exe`。
    这样之后的 `--reuse-payload` 会明确报错“找不到”，而不是悄悄复用带主题包的 payload。
  - 如果 tauri-build 把资源复制到了 `target/release/theme-pack/`，就把它删掉，免得直接运行
    `target/release/slui.exe` 时读到残留的主题包。是否会复制，实施时实测确认。
- 文档只描述这个通用功能：参数、产物文件名、目录结构（`fonts/`、`sounds/`），不提任何具体主题包。

## 6. Trellis 与分支保护（R6）

- `add_session.py` 和 `task.py archive` 的自动提交都在**当前分支**本地提交，不推送，行为已核实。所以只要
  收尾在功能分支上、PR 合并之前完成，journal 和归档提交就会随 PR 一起 squash 进 main，不需要改脚本或配置。
- 约定写进 `AGENTS.md` 的 Trellis 托管块之外，以免 `trellis update` 覆盖；`CONTRIBUTING.md` 写同样的内容：
  1. 开始实现前，从最新的 `main` 建分支 `<type>/<slug>`。
  2. Phase 3.4 提交和 `/trellis:finish-work` 都在分支上完成。
  3. 推送分支，开 PR，标题遵循 Conventional Commits，等待 CI。
  4. CI 通过后执行 `gh pr merge --squash --delete-branch`。合并会改动公开的 main，所以 AI 合并前要先得到用户确认。
  5. 合并后执行 `git switch main && git pull --ff-only`。
- journal 里记录的是分支上的提交哈希，squash 之后这些哈希不在 main 上。可以在 `--summary` 中写上 PR 链接，便于追溯。
- 自动提交信息 `chore(task): archive ...` 和 `chore: record journal` 本身已经符合规范，而且最终只有 PR 标题会进入 main。

## 7. 兼容性与回滚

- 回滚：删除 `.github/` 和 release-please 文件，停用 Ruleset。`build-installer.mjs` 不带新参数时，行为与原来
  完全一致（直接调用 CLI 时的参数与原来 npm 脚本的等价）。
- 运维侧原来复制 `theme-pack/` 再拼装的手工步骤，由新参数取代。运维仓库的入口另行处理，本仓库删除旧的配置文件。
- 风险：
  - Cargo.lock 的 JSONPath 写法：由版本一致性检查兜底，发版 PR 上的 CI 会失败，不会产出错误的包。
  - `gh release upload` 处理草稿：在试验发版中验证；如果失败，改为按 release id 调用 API 上传。
