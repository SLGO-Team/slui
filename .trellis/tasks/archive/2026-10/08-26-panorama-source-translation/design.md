# CS2 高相似度手工复刻技术设计

## Architecture

```text
SLGO protocol events
  -> existing session/model selectors
  -> page-specific typed React view model
  -> hand-authored React component
  -> hand-authored CSS + selected CS2 assets
  -> fixed-viewport visual regression
```

不存在 Panorama IR、运行时解释器或生成目录。Panorama 文件是开发参考资料，不进入
生产构建流水线。

## Visual Implementation Boundary

- 一个目标界面对应一个普通 React feature 目录，组件结构按可维护的视觉区域拆分。
- CSS 使用明确的 `1920x1080` 设计坐标和一个 overlay 级缩放因子；内部组件不各自
  响应式重排。
- CS2 源码用于确认尺寸、间距、色值、状态和资源；实机截图负责校正最终结果。
- Source 2 专属属性只实现当前画面可见的效果。例如 `wash-color` 可以通过预处理资源、
  CSS filter 或伪元素实现，但不会抽象成通用 Panorama 属性系统。
- 只在多个已实现页面确实共享行为时抽取设计 token 或通用组件。

## HUD Team Counter

- 手工组件拥有双方玩家列表、中央计时/比分区域和人数/状态图标。
- 玩家项读取 Steam `avatar_url`，并通过 CT/NTF 与 T/SCP 视觉侧映射应用边框和底色。
- `is_alive`、`is_online` 和 `health` 驱动死亡、掉线、血条及透明度状态。
- 无头像使用稳定阵营默认资源；mock 数据不得引用赛事选手头像。
- 炸弹等 CS2 专属状态只有在 SLGO 契约存在对应语义时才显示，否则不保留空控件。

## Migration

1. 在旧生成 HUD 仍可回退时实现手工 HUD。
2. 手工 HUD 通过截图、状态和构建门禁后切换 App composition。
3. 删除 `tools/panorama`、`src/generated/panorama` 及只服务于运行时兼容的代码。
4. 保留确实被手工 UI 使用的精选资源，并记录其来源。
5. 之后对 overlay shell、聊天和小地图重复相同步骤。

## Verification

- 统一使用 `1920x1080`、确定的背景和确定的 mock state 截图。
- 截图检查元素位置、可见像素、字体层级、颜色、头像裁切和状态差异。
- 为满员、死亡、掉线/缺图和计时状态建立稳定 fixture。
- 额外检查至少一个较低 16:9 分辨率，确认整体等比缩放而非重排。
- 运行 lint、contract tests、production build 和 Tauri check。

## Rollback

手工 HUD 未通过视觉门禁前不删除当前生成实现。迁移失败时可暂时恢复 App composition，
不回滚协议、平台或 session 层。

