# SLUI 客户端基础链路与身份接入

## Goal

负责协议类型、控制面路由、sidecar 连接、SteamID 读取/配对接口、状态适配器与 mock 基础设施。

## Requirements

- 在 `src/contracts` 建立 envelope、route、match/shop/chat/minimap/command 的类型和解析入口，未知版本、旧 sequence、错误 instance 必须拒绝。
- 在 `src/platform` 提供 `SteamClientIdentity`、`SlgoControlPlane`、`SlgoConnection` 接口；React feature 不得直接依赖 Tauri、WebSocket 或 JSON。
- Steam adapter 首版读取本机 Steam 客户端当前 SteamID；无 Steam/读取失败/账号切换可观察且可重试。
- identity proof 保持可替换：`local-steamid` 只能 discovery/display，`device-signature`/未来 Steam proof 才能授权玩家数据；客户端不能持有 Backend secret。
- 实现中心 route -> sidecar session 的生命周期、心跳/断线/stale 状态和多实例隔离。
- 提供与生产接口一致的 mock provider 和固定 fixture，使其他子任务无需等待后端。
- 为 overlay shell 固定 CS2UI `layout/hud/hud.xml` 的层级、hit-test 和区域语义；视觉资源和公共 token 必须来自 `../cs2ui/panorama`，并提供 source map。

## Acceptance Criteria

- [x] 有效 v0 envelope 可进入 feature store；未知 schema、旧 sequence、实例切换、非法 payload 均被拒绝并暴露原因。
- [x] Steam 未运行、SteamID 变更和读取异常在 UI 状态中可见；仅 local-steamid 时 shop/chat/minimap command 被阻止。
- [x] route token 绑定 `server_id/instance_id/player`，过期或跨实例连接失败；连接重试不会重复订阅或泄漏旧状态。
- [x] 两个实例经同一 sidecar 的事件保持独立，重启后必须先接收 baseline。
- [x] mock provider 可驱动父任务的所有 feature fixture；单元测试覆盖 parser、授权边界、sequence 和 route TTL。
- [x] 新 overlay shell 在 passive/interactive、connecting/live/stale 状态下与 `hud.xml` 的结构和输入行为一致，资源来源可追溯且不依赖源码目录运行。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
