# 小地图实施计划

## 规划与依赖

- [x] 核对现有小地图模型、协议、mock、Tauri 键盘事件及 SLGO 计分板真实按键语义。
- [x] 记录用户确认的两区域、中文特殊房间、死亡共享视野、两种方向模式和计分板缩放要求。
- [x] 主界面与设置已独立建立 `09-07-app-home-settings`，在小地图之后实施；保持小地图 UI 与应用入口/配置界面的职责边界。
- [x] 朝向、区域/视点、队伍权限、原子完整帧、计分板实际状态、错误传播和 baseline 例外顺序已写入最终设计与研究错误矩阵。
- [x] 锁定生成器提交和模板 SHA-256；16 个 seed/holiday 组合的源模块与 browser bundle 均和上游全输出相同，两区域坐标及检查点配对规则已探测。
- [x] 建立中文特殊房间初始词表，核对 CS2 雷达源码尺寸、marker 分层及 SCP-079 资产的版本/映射限制。
- [x] 更新 `implement.jsonl` / `check.jsonl`，纳入协议与生成器研究。
- [x] 用户于 2026-09-07 明确要求“开始实现小地图任务”；已审阅现有规划并启动既有任务，不创建重复任务。

## 实施顺序

### 2026-09-12 背景模糊校准

- [x] 根据用户反馈定位现2px网页模糊太弱，明确只调背景滤镜强度，不改透明度、地图或marker。
- [x] 进一步隔离出真实合成问题：兄弟map的screen融合会重新采样未模糊场景；正式Chrome对照确认滤镜应设在共同viewport的backdrop边界。旧133headless_shell不支持本机实际背景模糊，不能用它验收此材质。
- [x] 通过两种固定预览背景和不同视口比较候选强度，选择64px作用于共同viewport，更新来源说明。
- [x] 2026-09-17最终正式Chrome验证72场景与真实条纹对比度回归全部通过，完成模型全套、类型/构建与独立检查。见 `research/radar-blur-verification.md`。

### 2026-09-11 实机效果与可配置接口（已批准实施）

- [x] 保存用户两张实机/配置参考图，确认本轮效果与接口、后续设置页面的交付边界。
- [x] 研究 CS2 配置字段/范围、独立缩放动作、动态缩放公开行为和背景采样能力限制；方案见 `research/radar-settings-plan.md`。
- [x] 用户已批准最终配置方案并要求删除地图内中文名称；保留底部当前位置提示，锁定数据/能力合同与配置默认并更新子代理上下文。
- [x] 实现偏好正常化、相机/形状/动态缩放、短暂缩放输入及开发预设接入。
- [x] 实现实机参考材质、边框/底部地点标题/marker 与各项视觉参数。
- [x] 独立检查，模型+全套构建测试及两分辨率配置组合视觉验收（72场景；2026-09-12）。
- [x] 同步规范/来源/验收记录与后续设置页合同，原生背景未验证项保持明确；见 `research/radar-settings-verification.md`。

### 2026-09-11 中文标签漂移修复

- [x] 定位逐帧屏幕偏移搜索及动态 marker 避让，并明确固定世界锚点规则；继续复用当前任务。
- [x] 实现固定房间中心/检查点中点标签，去除 marker 布局依赖，marker 层位于文字之上。
- [x] 模型回归覆盖连续相机平移、旋转、缩放以及 marker 运动；浏览器检查实际文本锚点与图像中心/检查点中点一致。
- [x] 独立检查与 `npm test`、lint、build、tauri:check、两分辨率视觉场景验收通过，截图保存在 `research/screenshots-label-anchor/`。
- [x] 同步规范、source map 与本任务验收记录。

### 2026-09-11 已获授权的 SVG 增量

- [x] 用户要求接入房间 SVG，并复用已有小地图任务；保留任务 `in_progress`，不创建重复任务。
- [x] 核验房间 SVG、房间选择规则、完整画布与坐标变换，在 `research/room-svg-audit.md` 留存依据。
- [x] 实现子代理维护房间素材、类型化映射、resolver/renderer 接入和定向测试；主会话维护任务与规范并检查截图。
- [x] 检查子代理独立检查房间覆盖、坐标旋转、全图边界和兼容回退，修复发现的问题。
- [x] 执行 `npm test`、`npm run lint`、`npm run build`、`npm run tauri:check`；运行小地图视觉验收并输出至 `research/screenshots-room-svg/`，保留旧截图用于前后对照。
- [x] 更新来源文档、规范与验收记录；真实游戏/服务端集成未验证项保持待办。

以下为首轮实现记录与基础合同，SVG 增量以本节和 design.md 的 2026-09-11 增量为准。

1. 在 `src/features/minimap/vendor/map-seed/` 保留锁定核心、声明、模板、实际 LICENSE 和 provenance。仅替换 Buffer 解码、移除磁盘入口依赖；建立不依赖工作区外目录的固定 seed/holiday 输出回归。不要引入新的地图算法或升级生成器版本。
2. 在 `protocol/v0/minimap-*.schema.json` / examples、`src/contracts/index.ts` 实现 payload v2；同步 `src/platform/connection.ts` / `index.ts` 和 `src/app/clientSession.ts` / `useClientSession.ts` 的持续状态与安全诊断。此步先完成非法帧清理、非法 baseline、旧 sequence、身份绑定和不影响 HUD/shop 的跨层测试。
3. 在 feature 内建立 typed resolver、正常化几何、显式中文词表、纯 reducer 和薄 hook。实现 source/map/round/revision 边界、异步 token、独立单调时钟；geometry 缓存不得绕过新会话 init。
4. 增加摄像机纯模型：45-unit 普通半径、固定/旋转、圆形视窗两区域轮廓拟合、无视点回退、计分板关闭后跟随最新视点、边缘 marker。接入 `RadarPreferences`，无偏好回退 fixed；此时先用 fixture 验证。
5. 在 `src/features/minimap/` 手工构建 `MinimapRadar.tsx`、CSS 和受维护资源清单；用 SVG 视窗/变换及实际房间资产渲染，中文标签保持正向并消除碰撞。没有确切匹配资产时记录简化轮廓，不套用其他特殊房间图标。
6. 通过 `src/App.tsx` 分发 event/status/diagnostic 并挂载 feature；更新 `src/mocks/provider.ts` 与开发专用 minimap fixture/control，让 15Hz 完整帧持续流动，覆盖两队身份、死亡/无视点、计分板、stale/重建。借鉴现有 debug gate，不增加正式设置入口。
7. 在 `src/platform` 与 `src-tauri/src/lib.rs` 增加窄范围游戏前台通知，识别目标游戏窗口并验证不会破坏现有键盘/窗口行为；浏览器 fake focus 只用于预览。计分板 wire 状态来自插件实际 UI，失焦后 false 帧重新武装，不能以默认按键硬编码替代。
8. 增加 `scripts/minimap-model-smoke.mjs`、定向 layout/visual audit 并纳入 package scripts；运行下方验收。按 Trellis 用实现/检查子代理完成产品代码与最终质量检查，主会话负责合同、集成和真实依赖记录。

每步可独立检查，但共享 contracts/platform/session 由同一实现责任人顺序处理；不要并行编辑这些共享文件。所有派发使用已有任务的 curated context，工作状态须先进入 in_progress。

## 验证

### 当前实施进度（2026-09-07）

- [x] 固定生成器 vendor、实际 LICENSE/修改声明、16 组仓库内完整输出回归。
- [x] Payload v2、公开 schema、持续状态/安全诊断、baseline 例外及认证 viewer 绑定。
- [x] 两区域 resolver、房间/授权校验、异步 token、完整帧和独立 stale 时钟。
- [x] 固定/旋转摄像机、同一插值视点、中文词表与碰撞处理、300/250 手工雷达。
- [x] App 挂载、15Hz mock、开发 fixture 控制、死亡与无视点共享视野。
- [x] Windows SCP:SL 前台识别接口与浏览器独立 fake source；订阅及 Rust 测试通过。
- [x] 独立检查完成 parser 类型、pending revision、摄像机插值和错误状态恢复修复。
- [x] 最终 36 场景浏览器复验与结果记录，见 `research/implementation-verification.md`。
- [x] 2026-09-25 按实机裁图校准标记、朝向、越界箭头与位置标题比例，见 `research/radar-marker-scale-verification.md`。
- [x] 真实 Windows 游戏/原生覆盖层、服务端桥接及同版本资产联调（非 mock 验收）。

### 验证要求

- 生成器 fixture：房间身份、旋转、两区域边界与连接、不同种子、holiday、未知版本、缓存与重建。
- parser/store：未知字段、非法 marker、重复身份、权限变更、生存/死亡队伍视野、完整帧移除、过期 sequence、换实例和重连。
- 摄像机/输入：两方向模式、中文标签变换、两区域全图拟合、计分板开关和游戏内改键、模态拒绝打开、失去焦点及松开事件。
- stale：位置停止而其他事件继续、撤下过期敌人、队友过期样式、重连恢复。
- 浏览器：1920x1080 与较小 16:9 的两区域、普通/全图、两方向、生存/死亡及错误状态截图；检查资源、标签遮挡、marker 移除和更新期间布局稳定性。
- Windows：游戏焦点与输入穿透、计分板按住/松开、商店/聊天交互、DPI 缩放；没有原生验证时明确报告，不能以浏览器通过替代。
- 运行 `npm test`、`npm run lint`、`npm run build`、`npm run tauri:check` 以及本任务新增的定向行为/视觉验证命令。
- 生成器研究的 Node VM/browser bundle 探测已经通过，产品内 vendor 后必须用仓库内 fixture 再验证；不能让正式 test 依赖仓库外的目录。
- 真实 sidecar 不在本仓；最终报告区分客户端/mock 已通过、Windows 实际验证结果和生产桥接未接通，不能把外部依赖记为已完成。

## 回退边界

- 地图生成失败时进入明确的不兼容/错误状态，不回退到伪造网格。
- feature 的挂载、渲染和输入订阅可独立撤回；不撤销用户已有的 HUD、商店、身份或其他工作。
- 协议字段改变需同步全部客户端边界和 fixture；主界面配置接入未交付时保留 adapter，不能据此声称正式设置入口已完成。
