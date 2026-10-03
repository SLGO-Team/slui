# SLUI MVP 实施顺序

## 2. 基础链路（先行）

- 从单体 `App.tsx` 抽出 app/platform/contracts/shared 目录和 overlay shell。
- 实现 v0 envelope/route parser、sequence/instance guard、连接状态机和 mock provider。
- 接入 SteamID discovery 接口，落地未验证身份的授权闸门；为未来 pairing/ticket 留 adapter。
- 固化 command id、错误、stale、重连和日志诊断模型。

## 1. 视觉基准冻结（实现前）

- 固定只读基准目录 `../cs2ui/panorama`，记录目录快照、上游提交（若可得）和资源来源。
- 为 overlay shell、HUD、shop、chat、minimap 建立 source map：Panorama XML 节点 -> CSS 选择器/token -> React 元素 -> 状态/fixture -> 截图。
- 纳入范围的视觉资源放在仓库内，禁止组件直接引用工作区外路径。
- 为默认桌面尺寸和窄窗口保存 CS2UI 参考截图或等价 DOM/CSS 证据；缺少可渲染 Panorama runtime 的部分记录为 source evidence，不凭感觉补写。

## 3. 顶部 HUD

- 用真实 SLGO `RoundState`/`ScoreManager` 语义定义 match snapshot selector。
- 先完成 mock fixture 和 reducer/formatter 测试，再按 `hudteamcounter.xml` 与 `styles/hud/hudteamcounter.css` 重写 UI；覆盖换边、队友 health 和实例重启。

## 4. 商店与聊天

- 分别实现 authoritative state reducer、command factory、pending/result 状态和 mock fixtures；商店按 `buymenu.xml`/`buymenu.css`，聊天按 `hudchat.xml`/`chat.css` 建立对应布局、输入和状态变体。
- 复用 connection/authorization/overlay primitives；不在 feature 内复制 socket 或权限规则。

## 5. 小地图

- 锁定 generator 版本和 14.2.7 fixture，先做纯函数 seed resolver/坐标变换/回归测试。
- 实现 parser 的 visibility boundary，再按 `mapoverview.xml`/`hudradar.xml` 和对应 CSS/雷达资源做 canvas/SVG/DOM 渲染和完整帧更新。
- 加入 unknown version、越权 marker、stale 和 reconnect smoke。

## 6. 联调与验收

- 以 mock provider 串联五个 feature，验证 passive/interactive 与网络状态独立。
- 用协议 fixtures 模拟两个 `instance_id` 共用 sidecar，验证无串流和 baseline 规则。
- 运行 TypeScript/Vite build、单元/fixture 测试和 Windows Tauri smoke；用 Playwright 在默认桌面、窄窗口及 live/buy/spectator/stale 状态截图，与 source map 逐项核对；补齐后端对接所需的协议差异清单。

## 7. 质量门禁与交付物

- 每个子任务必须提交 source map、资源清单、mock 状态截图和失败/兼容性说明。
- `npm run lint`、`npm run build`、`npm test`、必要的 `npm run tauri:check` 和浏览器截图 smoke 全部通过后，才允许替换旧 feature composition。
- 视觉差异只能通过明确的 CSS/资源/布局证据修正；不得以新增渐变、占位图片或客户端猜测数据掩盖基准缺口。

## 依赖顺序

`client-foundation` 必须先于其他子任务；`minimap` 的真实 sidecar 更新频率和最终坐标契约可以在 UI mock 完成后再由后端联调确认。父任务只在所有子任务完成并通过跨功能验收后收尾。
