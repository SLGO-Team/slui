# 商店设计

## 数据流

```text
SLGO shop.snapshot / command.result
  -> parseShopSnapshot / parseCommandResult (contracts, 已就绪)
  -> shopReducer (纯函数，保存权威 snapshot frame + pending 命令表)
  -> selectShop -> ShopViewModel
  -> ShopPanel (手工 React) -> 手工 CSS + public/assets/slui-svg/
  -> 定屏人工对照基准图
```

Shop store 只保存插件权威 snapshot 和 command 状态。UI 从 `ShopItem.purchasable` / `unavailable_reason` 读取可用性；余额、库存、折扣和购买资格不在客户端计算。每次购买使用 idempotency command id，确认事件到达前不乐观扣款。

不存在 Panorama IR、运行时解释器或生成目录。`cs2ui/panorama` 是开发参考资料，不进生产构建。

## 协议扩展

SLGO 插件尚未开始实现，商店契约由 SLUI 定义、插件后续遵循。

```typescript
type ShopCategory = { id: string; label: string; order: number };
type ShopSnapshot = { balance: number; items: ShopItem[]; window_open: boolean; categories?: ShopCategory[] };
type ShopItem = {
  /* 现有字段 */
  category_id?: string | null;
  owned_quantity?: number | null;  // 提议新增：驱动「已持有」描边与 pip
};
```

`purchasable` 在 schema 描述中明确为「插件综合规则与余额判断后的最终可购买性」，余额不足属其一种，原因由 `unavailable_reason` 传达。客户端因此不需要也不允许做 `balance < price` 派生——实机中「买不起」与「规则不允许」渲染完全一致（`research/cs2ui-buymenu.md` §9.2），派生没有产出。

`quantity` 明确为剩余可购数量（`null` = 不限），与 `owned_quantity` 区分。

新增字段全部可选，使解析器在插件实现前后保持向后兼容：`categories` 缺失或为空时视为单列，`category_id` 未命中任何 category 的商品归入末列，`owned_quantity` 缺失时不渲染已持有态。`parseShopSnapshot` 需同步校验 `order` 为整数、`id` 非空且唯一。

同时补齐 `protocol/v0/` 下 `shop-snapshot.schema.json`、`command.schema.json`、`command-result.schema.json` 及 example——否则契约只存在于 TS 里。

## 购买命令状态机

| 迁移 | 条件 |
| --- | --- |
| idle → pending | `canPurchase(snapshot, itemId)` 为真且连接为 live |
| pending → accepted | `status === "accepted"` 或 `"duplicate"` |
| pending → rejected | `status === "rejected"`，展示插件下发的 `reason` |
| pending → failed | `status === "failed"` 或 send 抛错 |
| pending → timedOut | `now - sentAt > SHOP_COMMAND_TIMEOUT_MS`（客户端常量，风格对齐 `HUD_STALE_AFTER_MS`） |
| pending → abandoned | `instance_id` 变更，或连接进入 offline/unauthorized |
| timedOut → accepted/rejected | 迟到的 result 抵达。**超时不清 pending 记录** |
| accepted → idle | 新 `shop.snapshot` 抵达（权威结算，无乐观扣款） |
| abandoned → idle | 新 baseline + 新 snapshot |

`ShopCommandState` 现有的 `idle | pending | success | failed` 需补 `timedOut`、`rejected`、`abandoned`，并真正被引用（当前定义后无人使用）。

幂等分两层：传输层 `MockSidecarConnection.send` 已用 `sentCommands` Set 静默丢弃重复 `command_id`；feature 层仍需自己的 pending Map（key = `command_id`）保证同一 id 只产生一次 UI 副作用。同一次点击只生成一次 id，重试复用同一 id 才能触发服务端 `duplicate`。

过期 snapshot 照抄 HUD 的两段式：availability 计算只改状态标记，`state.frame` 原样保留；selector 仅在无 frame 时才返回「无快照」。

## 分层

| 层 | 文件 | 约束 |
| --- | --- | --- |
| reducer + selector | `src/features/shop/model.ts` | 纯函数，无 React、无 Tauri。补 `shopReducer` / `ShopSnapshotFrame` / `selectShop` |
| 纯 presentation | `src/features/shop/presentation.ts` | 只导出设计常量与纯函数，零 React import |
| 组件 | `src/features/shop/ShopPanel.tsx` | 只消费 `ShopViewModel`，不 parse、不 invoke |
| 样式 | `src/features/shop/ShopPanel.css` | 1920x1080 设计坐标 |
| 资源 | `public/assets/slui-svg/` | 从 `slui-svg/svg/` 统一拷贝 SCP:SL 图标，商店与 HUD 共用；不保留自绘 shop 图标或 CS2 equipment 图标 |

详情预览原图单独存放在 `public/assets/shop-items/`。`presentation.ts` 维护 `item_id -> 本地原图` 映射，并在缺图时退化到已有 `shopIconSource()`；这样不会把协议 `icon_url` 从商品卡剪影偷偷改成另一种展示语义。资源取自 SCP:SL 英文官方 Wiki：枪械优先使用官方 Render，其他物品使用当前彩色物品图，并随资源保留来源与 CC BY-SA 3.0 归属说明。运行时不访问 Wiki 或 CDN。

缩放**共用函数，独立画布**：把 `hudScaleForViewport` 提升到 `src/shared/` 并改名 `overlayScaleForViewport`，抽 `useOverlayScale()` hook 替代 `HudTeamCounter.tsx` 内的局部 resize 监听。两个界面各挂自己的设计画布，但传入同一个 scale 值——各算各的比例会出现两套尺度。

## Panorama → Web 换算

完整换算表在 `research/cs2ui-buymenu.md` 第 2 节。实现时最容易翻车的四条：

- **`flow-children` 默认是 `none`**，子元素全部堆叠在 (0,0) 由 align 决定位置。`.button-container`、`.buymenu-info`、`.buymenu__category__column__header` 都属此类，必须译为 `position:relative` + 子元素绝对定位。
- **`width:100%` + `padding` 按 border-box 复刻**。`.buymenu__category__column{width:100%;padding:0 15px}` 按 content-box 会溢出 30px；按 border-box 算出的 141/179/198px 差异化按钮宽正好解释「步枪列比装备列宽」。此结论为算术自洽推断，非实测，以实机截图校正。
- **`wash-color` 用 mask 而非 filter**。装备 SVG 全部是 `fill="#FFFFFF"` 纯白，用 `mask-image` + `background-color` 着色；不要用 `filter: invert/sepia` 拼色。`hud-colorize-wash` 本身是无样式标记类，实际 wash 值来自祖先——Web 上用一个根级 CSS 变量承载。
- **`visibility:collapse` 与 `.Hidden` 语义不同**。前者不渲染且不占位（`display:none`），后者仅 `opacity:0` 仍占位可点。

`vertical-align`/`horizontal-align` 只在 flow=none 时生效；`position: X Y Z` 是布局后位移不脱离流，译为 `transform:translate()`。`overflow: squish` 与 `text-overflow: shrink` 在 Web 无等价，改用固定尺寸避免依赖。

## 布局骨架

实机基准 `research/buymenu-live-1920x1080.png` 的实测值（静态源码出处见 `research/cs2ui-buymenu.md` 第 1 节，实机校正见第 9 节）：

- `.buymenu` 全屏遮罩约 0.7 黑——**不是** CSS 声明的 `rgba(0,0,0,0.95)`，该声明在实机被 3D 预览面板的 game-background 覆盖，SLUI 无此层，照抄会糊死游戏画面。遮罩还须用 `backdrop-filter` 复现引擎的屏幕空间模糊与降饱和（样式表不声明该效果，它在渲染管线里）。面板底色 `rgba(0,0,0,0.75)`。
- 内容区 950px（x≈255→1205），顶部偏移 180px；五列实测 ≈138 / 138 / 180 / 198 / 140px；商品按钮 `100% × 90px` + `margin-bottom:10px`，节距 100px。
- 商品卡四角：快捷键左上（18px Mono，`opacity:0.4`）、名称右上（14px medium，`width:70%` 右对齐）、图标居中（`height:45%` = 40.5px）、价格右下（14px Mono bold）。
- 信息条三段式：左金色余额、中「暗标签 + 亮值」倒计时、右灰色小字最低金额。
- 详情卡 350×110px、`#000000d0`、`padding:10px`；失败提示 `height:30px`、`rgba(163,148,14,0.87)` 底 + 白字 22px Condensed。
- navbar 分隔线 `rgba(255,255,255,0.05)`，Label 24px Condensed bold uppercase；按键令牌与中文标签异色，拆两个 span。

状态视觉：**「不可购买」只有一种表现**——整卡变暗（底色 `rgba(43,43,43,0.897)`、图标 `rgb(64,64,64)`、文字 `rgb(128,128,128)`），不区分买不起与规则不允许。已持有为 1px 描边 + 图标下方 pip，二者用玩家色 CSS 变量。hover `brightness:2.2`（进场 0.2s、离场 0s）；选中列 `brightness:1.5`、未选中列 `brightness:0.3`；购买成功 `brightness 2→1` 0.5s 动画。

图标 wash 随阵营取值，用根级 CSS 变量承载：SCP 侧使用 HUD 红色 `#d94652`、NTF 侧淡蓝 `rgb(150,200,250)`，与 HUD 既有阵营映射一致。

## Overlay 集成

窗口启动即 passive，passive 带 `WS_EX_NOACTIVATE` 拿不到键盘焦点——商店内任何输入在 passive 下不可用。Ctrl+Shift+O 由 Rust 全局钩子发 `slgo-shortcut`，前端封装是 `createOverlayWindowController()`，目前 React 侧无人消费，商店负责接上。

商店可见 = `window_open && overlayInteractive`，单向：不因 `window_open` 反向请求 interactive。Esc 只关商店。商店 `<section>` z-index 高于 `.hud-overlay`，HUD 不卸载。CS2 自身也是 buymenu 与 HUD 共存。

feature state 不塞进 `App.tsx`——`hudState` 已经在 App 里，商店不再叠一层。

## 验证

- 统一 `1920x1080`、确定背景、确定 mock state 截图，覆盖可购买/不可购买/已持有/pending/失败/断线六态，逐项与 `research/buymenu-live-1920x1080.png` 比对。
- 六态通过 `?shopOpen=1&shopAvailability=...&shopState=...` 复现；`?hudDebug=0&shopDebug=0` 隐藏调试面板，便于截干净的对照图。
- 至少一个较低 16:9 分辨率证明整体等比缩放而非重排。
- 调试面板 `shopDebug.ts` + `ShopDebugPanel.tsx`，**用真 reducer 构造状态**而非手捏 view model，保证调试路径与生产路径共用同一套迁移逻辑；状态同步到 URL，生产构建不渲染。
- 视觉验收是人工对照基准图，不引入自动 audit 脚本。
- 运行 lint、contract tests、production build 和 Tauri check。

## Rollback

商店是新增界面，无被替换的旧实现。视觉门禁未通过前不解除 `README.md` 与 `08-26-panorama-source-translation` 的商店排除声明，不把 `ShopPanel` 接入 App composition；协议扩展字段设为可选，回滚只需移除 composition 挂载点，不回滚 contracts、platform 或 session 层。
