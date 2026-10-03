# CS2 高相似度手工 React 复刻

## Goal

为 SLGO 手工实现一套在视觉上高度接近 CS2 实机的 React UI。开发者阅读
Panorama XML/CSS、选择性复用游戏资源，并以实机截图作为最终视觉标准；不构建
Panorama 翻译器、兼容运行时或逐行等价实现。

## Background

- 早期自由设计的 CS2 风格 UI 因缺少严格视觉基准而不符合预期。
- 随后的机械翻译路线能追踪源码，却因 Source 2 原生控件、字体、布局和材质语义
  产生了远超产品需要的复杂度。
- 用户真正需要的是一眼可识别的 CS2 视觉和可靠的 SLGO 工作流，不要求 100%
  引擎级复刻。

## Visual Authority

优先级固定为：

1. CS2 实机截图决定最终渲染结果。
2. Panorama XML/CSS 用于确认结构、尺寸、颜色和状态。
3. SLGO 产品需求决定数据、文字、角色和交互。

当静态源码与实机画面不一致时，以实机画面为准。实现不需要与源文件逐行对应。

## Requirements

- 使用清晰、手工维护的 React 组件和 CSS，不生成 React DOM 或 CSS。
- 首个垂直切片只重建顶部 `hudteamcounter`；通过视觉门禁后才开始 overlay shell、
  聊天和小地图。
- 保留 `src/contracts`、`src/platform`、session 状态机、Tauri/Vite 配置和协议测试。
- React 组件直接消费 typed SLGO view model，不引入 Panorama IR 或通用控件系统。
- 顶部 HUD 使用玩家 Steam 头像；头像框、阵营色、裁切、存活、死亡和掉线表现参考
  CS2 实机。头像缺失时使用阵营默认图，不使用赛事选手照片。
- 视觉实现必须服务于 SLGO 的可读性和状态表达，禁止添加无依据的营销式布局或装饰。
- 商店 UI 由 `08-25-shop` 按同一方法交付，不再排除在外。

## Viewport Compatibility

- 首版唯一像素基准为 `1920x1080`。
- 其他 16:9 分辨率从该基准对整个 overlay 等比缩放。
- 超宽屏、任意宽高比和用户可调安全区延后处理。

## Acceptance Criteria

- [x] `1920x1080` 下顶部 HUD 与指定 CS2 实机基准图在位置、比例、字体层级、颜色、
  头像框、比分、计时器和状态表达上高度相似，无明显占位或调试视觉。
- [x] 至少覆盖双方满员、玩家死亡、玩家掉线/头像缺失和回合计时四类可重复预览状态。
- [x] Steam 头像来自 typed SLGO 数据；缺失时显示稳定的阵营默认图。
- [x] 16:9 非基准分辨率保持相同构图，不发生溢出、重排或局部非等比缩放。
- [x] 顶部 HUD 有固定视口截图，并进行肉眼检查和自动截图回归。
- [x] 手工 HUD 通过视觉门禁后，旧生成组件、翻译器和仅服务于兼容运行时的代码被删除。
- [x] overlay shell、聊天和小地图按同一方法逐页实现；商店由 `08-25-shop` 交付并挂入 composition。
- [x] `npm run lint`、`npm test`、`npm run build` 和 `npm run tauri:check` 通过。

## Out of Scope

- 通用 Panorama XML/CSS 翻译器、IR、生成器和运行时。
- Panorama 属性覆盖率、逐节点或逐声明等价。
- Source 2 原生 C++ 控件和完整材质渲染器复刻。
- 100% 像素一致承诺、所有分辨率以及超宽屏首版支持。

## Technical Notes

- 当前生成式 HUD 只作为迁移期间的源码与失败案例参考，不是目标架构。
- Valve 资源的分发权和 Source 2 Viewer 署名要求需要在发布前确认。
