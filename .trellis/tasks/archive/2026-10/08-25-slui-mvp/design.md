# SLUI MVP 技术设计

## 分层

```text
src/app                 生命周期、overlay 模式、feature composition
src/contracts            版本化 wire types、parser、command/result types
src/platform             Steam、control plane、sidecar、Tauri 和 mock adapters
src/features/hud         match snapshot reducer/selectors/top HUD
src/features/shop       authoritative shop state and commands
src/features/chat       authoritative chat history and commands
src/features/minimap    seed resolver、坐标变换、可见 marker store/render
src/shared               UI primitives、time、diagnostics
src-tauri                窗口、快捷键、click-through、Windows secure storage
```

## CS2UI 到 React 的映射

CS2UI 位于 `../cs2ui/panorama`，作为只读上游视觉基准；不把 Panorama XML 当作运行时模板，也不把整棵 CS2 主菜单资源树复制进 SLUI。每个 MVP feature 维护一份 source map，记录 XML 节点、CSS 选择器、资源路径、状态变体和 React 实现。

| SLUI feature | Panorama layout | 主要样式/资源 | React 边界 |
| --- | --- | --- | --- |
| overlay shell | `layout/hud/hud.xml` | `styles/csgostyles.css`、HUD 区域 token | `src/app/OverlayShell.tsx` |
| round HUD | `layout/hud/hudteamcounter.xml` | `styles/hud/hudteamcounter.css`、`images/hud/teamcounter/*` | `src/features/hud/TopHud.tsx` + presentational subcomponents |
| shop | `layout/buymenu.xml` | `styles/buymenu.css`、`styles/weaponstyles.css`、`images/icons/equipment/*` | `src/features/shop/BuyMenu.tsx` |
| chat | `layout/hud/hudchat.xml`, `layout/chat.xml` | `styles/hud/hudchat.css`、`styles/chat.css` | `src/features/chat/ChatPanel.tsx` |
| minimap | `layout/mapoverview.xml`, `layout/hud/hudradar.xml` | `styles/mapoverview.css`、`styles/hud/hudradar.css`、`images/hud/radar/*` | `src/features/minimap/MapOverview.tsx` |

### 视觉转换规则

- Panorama 的 `Panel`/`Frame`/`Label`/`Image`/`Button`/`TextEntry` 映射为语义化 HTML/React 元素；`id` 和 class 名保留为 source-map 注释或稳定 data 属性，便于逐项比对。
- `hittest`/`hittestchildren` 映射为 overlay 的 pointer-events 策略；不得因 React 状态或连接状态改变 passive/interactive 行为。
- Panorama 的百分比布局、固定宽高、层级 z-index、裁切和 transform 先按源码建立 CSS token，再由响应式约束处理窄窗口；不得使用当前 POC 的渐变/尺寸作为默认值。
- 运行时只引用仓库内的视觉资源，不读取参考源码目录；每次资源引入记录来源和许可证。
- Panorama 脚本事件不能直接移植。交互由 typed feature command 驱动，视觉状态由 provider 事件和 reducer 产生；无法由现有协议表达的状态必须显示为明确的 deferred/unsupported，而不是伪造数据。

### 数据流与兼容性

协议、parser、route/instance guard、authorization gate 和 mock provider 保持不变。组件只消费 feature view model；CS2UI 的样式重写不得把 raw envelope、Tauri、WebSocket 或未过滤 minimap 数据带入 React。

每个 feature 同时保留 source fixture（布局状态/资源清单）和 product fixture（SLGO typed payload），以便分离“视觉映射错误”和“后端数据契约错误”。

### 迁移与回滚

按 `client-foundation -> round-hud -> shop/chat -> minimap -> integration` 顺序迁移。每个子任务先在 mock provider 下替换一个 feature，保留旧组件直到新组件通过 build、单测和浏览器截图检查；失败时回退 feature composition，不回退 contracts/platform 改动。

## 连接与状态

1. app 启动 Steam identity adapter，得到当前 SteamID 或 `steam-offline`。
2. control adapter 用 identity/proof 请求 route；中心只返回短期、实例绑定的 sidecar endpoint/token。
3. sidecar adapter 建立 WSS，先接收 `baseline`，再按 `sequence` 分发事件；旧实例状态在新 baseline 前全部标记 stale。
4. feature stores 只接受解析后的 typed events。shop/chat command 经过 command factory 生成 id 后发送到 sidecar，由 SLGO 插件回传权威结果。
5. overlay shell 统一管理 passive/interactive；任何数据状态变化不得修改 click-through 行为。

## 数据契约

- `server_id + instance_id + round_id + sequence` 是状态隔离和排序主键。
- 比分使用稳定 `team-a/team-b`；`current_role` 只用于当前回合展示。
- HUD 的队友 health 可为 number/null，敌方 marker 只有服务端允许的 visibility 及位置，不包含敌方 health。
- minimap init 固定 game/template/generator/schema/coordinate 版本；positions 是按玩家视野过滤后的完整帧。
- 未知版本、跨实例 token、越权 marker 在 contracts/platform 边界拒绝，feature 不承担安全判断。

## 身份边界

首版实现 `local-steamid` discovery 和可替换 proof 接口。若没有可验证 ticket 或一次性游戏内 pairing，允许显示 Steam 账号和“等待验证”，不授权 player-scoped stream/commands。设备私钥由 Tauri Windows secure store 保存，React 不接触密钥。

## 可观测性与失败

每个 adapter 暴露 connection state、last accepted sequence、instance id、last error 和 data freshness。UI 必须区分 signed-out、route-not-found、connecting、live、stale、incompatible、command-failed；不得用空数据掩盖失败。

## 依赖与实现选择

- 保留当前 Tauri 2 + React 19 + TypeScript/Vite，不引入全局状态框架，先用 feature-local reducer/store 和 typed adapter。
- 地图生成器固定使用 MIT `@scpsl-tools/map-seed@1.0.0`，并把 generator/template 版本写入 fixture 与协议。
- 后端未就绪期间所有 feature 通过 mock provider 验证；真实 sidecar 替换 adapter，不改组件。
