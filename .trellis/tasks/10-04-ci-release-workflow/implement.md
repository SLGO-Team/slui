# Implement：CI、提交合并规范与发版流程

分支：`ci/release-workflow`，从 `main`（40ebdd8）创建。本任务自己的 PR 就是验收里的试验 PR。

Node 命令前先执行 `export PATH="<fnm node 24 安装目录>:$PATH"`（Agent 的 shell 里 node 不在 PATH 上）。

## A. 本地实现（在分支上）

- [x] A1 `git switch -c ci/release-workflow`
- [x] A2 `scripts/version-check.mjs` 并接入 `npm test`（design 4.3）；`npm test` 通过
- [x] A3 `scripts/build-installer.mjs --theme-pack`（design 5）；删除 `src-tauri/tauri.bundle-theme-pack.conf.json`
      和 `tauri:build:with-theme-pack` 脚本；`npm run lint && npm test`
- [x] A4 R4 实测（要先让 Agent shell 能找到 cargo 和 node）：
  - `node scripts/build-installer.mjs --local`：正式包作为基准，记下 mtime 和大小
  - 建一个临时测试目录（放在仓库外，里面只放 `fonts/` 和 `sounds/` 下的几个占位文件），然后执行
    `node scripts/build-installer.mjs --local --theme-pack <dir>`
  - 核对：生成 `SLUI-Setup-<v>-theme-pack.exe`；正式包的 mtime 没变；NSIS 中间包已改名；
    确认 `target/release/theme-pack/` 是否存在，存在就处理；`git status` 干净
  - 核对产物里确实有这个目录：用 7z 列出 NSIS 中间包内容，看到 `theme-pack/`；或者安装到临时目录后检查
  - 再执行 `--reuse-payload`，应当报错“找不到”
- [x] A5 `release-please-config.json` 和 `.release-please-manifest.json`（design 4.1）
- [x] A6 `.github/workflows/ci.yml`、`pr-title.yml`、`release.yml`，以及 `.github/dependabot.yml`
      （design 2、4.2）。用 `npx --yes actionlint` 或 `rhysd/actionlint` 的发布二进制做语法检查（这是一次下载，
      在计划审查时一并批准）
- [x] A7 `CONTRIBUTING.md`；`README.md` 加链接；`AGENTS.md` 在托管块之外加分支和 PR 约定（design 6）
- [x] A8 trellis-check 全量检查，再执行 `npm run lint && npm test`；公开内容自查：
      grep 生产域名、主题包具体内容、分发渠道等词，确认文档措辞中立

## B. GitHub 侧（需要用户授权或手动操作）

- [x] B1 用户手动：创建 GitHub App 并安装到 slui（design 4.5），把 Client ID 和私钥交给下一步
- [x] B2 经用户确认后用 gh 配置：变量 `RELEASE_APP_CLIENT_ID`；secret `RELEASE_APP_PRIVATE_KEY`
      （私钥文件通过管道传给 `gh secret set`，不在会话中显示）；Environment `release`，部署分支策略只允许 main；
      Environment secret `CONTROL_PLANE_URL`（由用户自己设置，或者经授权后从运维配置拼出地址，用管道传入，
      不回显）
- [x] B3 经用户确认后：仓库合并设置（只允许 squash，标题用 PR_TITLE，正文 BLANK，合并后删除分支）

## C. 试验 PR（验收 1）

- [ ] C1 3.4 工作提交，然后 `/trellis:finish-work`（在分支上归档并写 journal，同时验证 R6）
- [x] C2 推送分支，开 PR，标题 `feat: add CI, release workflow and installer --theme-pack option`（必须是 `feat`：
      `ci` 类型的提交不触发发版，D 阶段的试验发版就不会发生）
- [x] C3 CI 两项都通过；把标题临时改成不合规，确认 `pr-title` 失败，再改回来
- [x] C4 经用户确认后创建 Ruleset（design 3）
- [x] C5 在 main 上建一个空提交，尝试直接推送，应当被拒绝；然后删除这个本地提交
- [ ] C6 经用户确认后 squash 合并 PR，然后 `git switch main && git pull --ff-only`

## D. 试验发版（验收 2）

- [ ] D1 合并后 release.yml 运行，生成发版 PR `chore(main): release 0.2.0`，而且在这个 PR 上 CI 被触发
      （这一步验证 App 令牌）
- [ ] D2 检查发版 PR 的 diff：所有版本位置都变了，CHANGELOG 合理；版本一致性检查通过
- [ ] D3 经用户确认后合并发版 PR，然后确认：
  - `v0.2.0` 标签已经存在
  - 草稿 Release 已创建
  - `installer` job 成功，Release 中有 `SLUI-Setup-0.2.0.exe`
  - 日志中没有地址明文
- [ ] D4 用户安装草稿 Release 中的安装器，确认能连上生产服务器，然后自己决定是否发布草稿

## 回滚点

- A 阶段：在分支上 `git reset` 或丢弃分支即可。
- B 和 C4：删除 Ruleset、Environment、secret 和 App；仓库设置恢复成允许全部合并方式。
- D：删除草稿 Release 和 `v0.2.0` 标签。发版 PR 的标签恢复为 `autorelease: pending` 后，可以重新运行 release.yml。

## 验证命令

```bash
npm run lint
npm test
node scripts/version-check.mjs
node scripts/build-installer.mjs --local --theme-pack <dir>
git status --porcelain
gh pr checks <pr>
gh run view <run-id> --log | grep -c <生产域名>   # 应当为 0；只在本机执行，不写入任何文件
```
