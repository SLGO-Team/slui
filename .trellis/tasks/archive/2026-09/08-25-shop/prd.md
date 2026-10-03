# SLUI 商店界面

## Goal

负责 SLGO 插件权威商店数据的展示、购买交互、错误与过期状态，视觉上手工复刻 CS2 购买菜单。

## Visual Authority

按 `.trellis/spec/frontend/cs2-visual-replication.md` 第 3 节，优先级固定为：

1. `research/buymenu-live-1920x1080.png`（T 方视角，余额 $2500，购买阶段）决定最终渲染结果。
2. `cs2ui/panorama` 的 `layout/buymenu.xml`、`styles/buymenu.css`、`styles/weaponstyles.css` 提供尺寸、色值、状态与实现证据。
3. SLGO 产品需求决定数据、文字、角色和交互。

静态源码与实机画面冲突时以实机画面为准。已知两处冲突已由实机裁定，见 `research/cs2ui-buymenu.md` 第 9.2 节。不构建 Panorama 翻译器、IR、生成器或兼容运行时。

商店的结构与尺寸证据已固化在 `research/cs2ui-buymenu.md`，契约与状态机证据固化在 `research/slgo-shop-mapping.md`；两份文档中的每个数值都标注了 `文件:行号`，实现须以其为准而非重新翻源码。

## Requirements

### 数据与权威

- 展示 SLGO 插件下发的余额、商品名称/图标/价格/可购买原因、库存与购买窗口状态。
- 不在客户端计算余额、库存、折扣或购买资格；收到新权威 snapshot 后更新 UI。按钮的可点击性只认 `ShopItem.purchasable`。
- **`purchasable` 定义为「插件综合规则与余额判断后的最终可购买性」**，余额不足属于不可购买的一种，其原因通过 `unavailable_reason` 传达。SLGO 插件尚未实现，本契约由 SLUI 定义、插件后续遵循，因此该语义写入 `protocol/v0` schema 描述，不留给实现方自行解释。
- 客户端**不做**任何 `balance < price` 派生。实机证据（`research/cs2ui-buymenu.md` §9.2）显示 CS2 中「买不起」与「规则不允许」渲染完全一致，不存在需要区分的第二种视觉，派生没有产出，只会引入越界风险。
- 购买倒计时复用 `MatchSnapshot.phase_remaining_ms` / `phase_paused` 与既有 `remainingMilliseconds()` 插值，不新增 shop 侧倒计时字段。
- 商品图标优先使用契约 `ShopItem.icon_url`；缺失时使用 `public/assets/slui-svg/` 中的 SCP:SL 图标 fallback，不使用自绘图标或 CS2 武器图标代表 SCP:SL 道具。
- 电板破坏强化是明确的交互语义例外：直接使用随客户端打包的 CS2 拆弹钳图标；其余 SCP:SL 商品仍遵循上面的 SCP:SL 图标 fallback 约束。

### 分类

- 商品按插件下发的分类分列展示。协议扩展 `ShopSnapshot.categories[]{ id, label, order }` 与 `ShopItem.category_id`。
- 分类标题仅作视觉标签，不响应鼠标点击；按列头数字键（`1-5`）选中商品列，选中后再次按卡片序号键购买对应商品；`Esc` 先取消列选择。
- 右侧商品图片与详情文字分离：鼠标悬停商品才显示该商品详情，鼠标离开后详情隐藏；图片在鼠标离开后保持。有效键盘购买只更新图片，不覆盖鼠标当前悬停的详情；余额不足或已持有商品的键盘选择取消当前列且不更新图片。
- SLGO 插件尚未开始实现，该契约由 SLUI 定义并写入 `protocol/v0` schema，插件后续遵循。因此分类**不阻塞实现**：用 mock fixture 驱动，直接构建五列栅格。
- 客户端不得按 `item_id` 前缀或名称推断分类——这是插件语义，违反 `.trellis/spec/frontend/system-boundaries.md` 的「不发明并行规则」。
- 列宽为呈现层决策：恰好 5 个分类时逐列套用实机基准 `≈138 / 138 / 180 / 198 / 140px`（950px 内的 border-box 结果）；其他列数在 950px 内等宽分配。
- 当前 SCP mock 快照的分类顺序与显示名为“装备、危险、高危、生命、护盾”，SCP-096 归入“高危”；SCP-079 快照为“装备、危险、高危、电力升级”，不下发生命和护盾分类。
- 当前 SCP 五列呈现宽度（border-box）为 `[171, 209, 228, 171, 171]`，危险与高危列互换宽度；NTF 继续使用 `[171, 171, 209, 228, 171]`。
- 分类为空或缺失时退化为单列，不报错、不隐藏商品。这是健壮性要求，不是首版目标形态。

### 视觉结构

- 视觉分区参照 `buymenu__contents` / `buymenu-left` / `buymenu-body` / `buymenu-right` / `BuyMenuNavBar`；React 组件按可维护的视觉区域拆分，不做逐节点对应。
- 商店是**矩形五列栅格**，不是径向轮盘。`buywheel-*` 是 CS:GO 时代遗留类名，`.buy-wheel`、`.buy-wheel-edges`、`.rarity-bar`、`.loadout .buywheel-*` 在 `buymenu.xml` 中无对应元素，属死规则。禁止实现圆形/扇形/径向布局。
- Panorama 的 `flow-children` 默认值是 `none`。`.button-container` 的四个子元素（快捷键、名称、图标、价格）靠 align 堆叠在 90px 卡片的四角，必须译为 `position:relative` + 绝对定位子层；直译为 flex 会排成一行。
- 保留商品详情面板、购买失败提示位、余额/倒计时和底部操作栏的层级语义。信息条为三段式（左金色余额 / 中暗标签+亮值倒计时 / 右灰色小字），底部操作栏的按键令牌与中文标签异色。
- CS2 右侧原本由 `MapPlayerPreviewPanel` 显示人物模型；SLUI 不具备人物模型与引擎渲染能力，改为显示当前选中 SCP:SL 商品的彩色原图。原图从 SCP:SL 英文官方 Wiki 下载后随客户端静态打包，运行时不得依赖外部图床；商品卡仍使用现有阵营着色剪影。
- 商品图标着色随阵营变化：SCP 侧使用 HUD 既有的阵营红色 `#d94652`、NTF 侧沿用 CT 方淡蓝 `rgb(150,200,250)`，不使用固定色。
- 全屏遮罩取值以玩家实际观感为准（约 0.7 黑），**不照抄** `buymenu.css` 声明的 `rgba(0,0,0,0.95)`——该声明在实机中被 3D 角色预览面板的 `game-background` 覆盖，而 SLUI 无法渲染游戏世界，照抄会把游戏画面糊死。
- 遮罩**不只是一层 alpha**。Source 2 在打开购买菜单时对 3D 世界跑一遍屏幕空间模糊与降饱和，该效果在引擎渲染管线里，`buymenu.css` 不会声明它。SLUI 没有引擎层，必须用 CSS `backdrop-filter` 复现模糊、饱和度、亮度与对比度，否则被遮罩的画面会显得过于锐利和平板。按视觉权威顺序，实机画面在此优先于样式表。
- 「不可购买」只有一种视觉：整卡变暗（图标深灰、名称与价格中灰、卡底更深）。不区分「买不起」与「规则不允许」。
- 已持有商品的描边为**白色**（`buymenu.css:693`），图标下方的 pip 才使用**玩家色**；两者是不同的元素，pip 的颜色通过 CSS 变量承载。
- 字体使用已有的 Stratum2 字体族，无需新增字体。`font-stretch:condensed` 改写为显式 Condensed family；两个 monodigit TTF 仅约 3KB、极可能只含数字字形，必须声明完整 fallback 链。新增 `@font-face` 须按规范声明 `ascent-override`/`descent-override`，不得用 `padding-top` 对齐。

### 购买交互

- 购买操作生成 client command id，具备 pending、成功、插件拒绝、超时、断线和重连状态；权威结果来自插件。
- `CommandResult.status === "duplicate"` 是服务端幂等回执，必须按 accepted 处理，不得报错、不得二次扣款。
- 超时由客户端计时（契约无 deadline 字段），且超时不等于失败：不清 pending 记录，迟到的 `CommandResult` 仍应被接受。
- `instance_id` 变更或连接进入 offline/unauthorized 时放弃 in-flight 命令，并在新 baseline 后恢复。
- 过期 snapshot 标记但不清空最后一个有效权威状态，仅禁用购买并显示状态标签。

### Overlay 集成

- 商店可见条件为 `window_open && shopOpen`。`window_open` 是插件权威开关，不是本地 toggle；`shopOpen` 是玩家用商店热键打开的本地状态。
- 交互模式不是玩家手动切换的开关，而是由界面派生：商店可见时 overlay 进入 interactive，商店关闭后自动回到被动点击穿透。不存在独立的交互快捷键（原 Ctrl+Shift+O 已删除）。
- 商店热键默认 `B`，可在主界面修改（字母键，Y 为聊天键除外；F1–F12；数字键留给商品选择）。热键在任何时候都能关闭商店；只有在游戏处于前台且 `window_open === true` 时才能打开商店，避免在其他程序里打字时抢走鼠标。
- **不得**因收到 `window_open === true` 而自动打开商店；打开必须来自玩家按热键。`window_open` 变为 false 时商店随之关闭，下个购买时段不会自动重开。
- 商店是本项目第一个必须消费 `createOverlayWindowController()` 的界面——该 controller 目前在 React 侧无任何引用。
- Esc 关闭商店（有已选分类时先退回分类），商店关闭即退出 interactive 模式。
- 遮罩不得默认吃点击：`window_open === false` 时不渲染遮罩；渲染时 `pointer-events:auto` 限定在实际可交互区域。
- 商店 z-index 高于 `.hud-overlay`；HUD 保持挂载不卸载，避免丢失 reducer state 与计时插值基准。

## Viewport Compatibility

- 唯一像素基准为 `1920x1080`。其他 16:9 分辨率从该基准对整个 overlay 等比缩放。
- 商店与 HUD 共用同一个缩放函数与同一个 scale 值，但各自挂独立的设计画布。
- 商店内部区域不得独立 reflow，不使用 viewport 驱动字号。超宽屏与任意宽高比延后处理。

## Dependencies

SLGO 插件侧尚未开始实现，商店契约由 SLUI 定义并写入 `protocol/v0`，插件后续遵循。因此本任务**没有等待外部团队的阻塞项**，但有两条必须先落地的自有工作：

- **书面契约缺口**：`protocol/v0/` 下缺 shop-snapshot / command / command-result 三个 schema 与 example，而 `protocol/v0/README.md` 已列出这些消息。契约目前只存在于 TS 里，需补齐并在其中写明 `purchasable` 含余额判断、`quantity` 的确切语义。
- **排除声明需解除**：`08-26-panorama-source-translation/prd.md` 与 `README.md` 都写明商店不进 composition，需在视觉门禁通过后显式解除，否则两个任务的验收互相矛盾。

视觉基准已取得（`research/buymenu-live-1920x1080.png`），原阻塞项解除。`.buymenu__contents` 的 `translateX(-50px)` 等相对偏移的最终落点，已按基准图实测确定并记入 `research/cs2ui-buymenu.md` 第 9 节。

## Acceptance Criteria

- [x] `1920x1080` 下商店与 `research/buymenu-live-1920x1080.png` 在五列栅格比例、商品卡尺寸、字体层级、颜色、余额/倒计时位置和底部操作栏上高度相似，无占位或调试视觉。
- [x] 商品卡内快捷键、名称、图标、价格按四角堆叠呈现，不退化为单行排列。
- [x] 右侧空白区显示当前选中商品的本地彩色原图；切换商品时同步更新，资源缺失时稳定退化为现有剪影，不请求外部网站。
- [x] 遮罩压暗后游戏画面仍可辨认，不呈现接近纯黑的效果；且带有与实机一致的模糊与降饱和，不是单纯的半透明黑。
- [x] 图标着色随阵营切换（SCP 红 / NTF 蓝），已持有商品的描边与 pip 使用玩家色，均不硬编码。
- [x] mock shop snapshot 可渲染全部商品与不可购买原因；`icon_url` 缺失时有可访问 fallback 且不发生布局位移。
- [x] 分类字段存在时按插件 `order` 分列；字段缺失时退化单列且不报错。客户端任何路径都不推断分类，也不做 `balance < price` 派生。
- [x] 成功购买只展示插件确认后的新余额/库存；重复 command id 不产生第二次购买；`duplicate` 按成功处理。
- [x] 超时后 pending 记录保留、迟到 result 仍被接受；插件拒绝展示 `reason`；断线与 instance 重启不清空最后一个有效权威状态。
- [x] `window_open === true` 不会自动夺取鼠标；未进入 interactive 时商店不可见且不拦截点击；Esc 只关商店。（2026-09-26 起由下一条取代）
- [ ] 商店热键（默认 B，主界面可改并持久化）在游戏前台且购买时段内打开商店并进入 interactive；热键 / Esc / 购买时段结束 / 停用覆盖层都会关闭商店并恢复点击穿透；游戏不在前台时按热键不会打开商店。
- [x] shop feature 不直接调用 Tauri/WebSocket；reducer、command 状态机与 presentation 纯函数有测试，覆盖幂等、超时、拒绝、断线重连与无 authority。
- [x] 至少覆盖可购买、不可购买、已持有、pending、失败和断线六类可重复预览状态，各有定屏截图。
- [x] 较低 16:9 分辨率保持相同构图，整体等比缩放，不发生溢出、重排或局部非等比缩放。
- [x] `npm run lint`、`npm test`、`npm run build`、`npm run tauri:check` 通过。

## Out of Scope

- 稀有度条（`.rarity-bar`，SCP:SL 道具无稀有度语义）。
- 退货 sellback（需新增 `command.shop.sellback` 与 `ShopItem.sellback_value`，属独立协议变更）。
- 推荐/促销标记（`nux`、`promoted-label`——促销是定价规则，必须插件权威）。
- 为队友购买与赠送（`in-donate`、`BuyForTeammateLabel`，SLGO 无对应语义）。
- 地面武器列表（`buymenu__ground-weapons`，依赖引擎实体查询）。
- `rebuy` / `autobuy` / `sellbackall` 控制台命令——SLGO 无权威 autobuy 接口。
- Source 2 原生控件：`MapPlayerPreviewPanel` 3D 角色预览、`CSGOHudWeaponSelection`、`CSGOMoneyPanel`、`CountdownTimer`、`TooltipPanel`。
- 通用 Panorama 翻译器、IR、生成器、运行时与逐节点等价。
- 100% 像素一致承诺、全分辨率与超宽屏首版支持。

## Open Questions

插件侧尚未开始实现，以下语义由 SLUI 在 `protocol/v0` schema 中定义，不是等待外部答复的阻塞项；但它们改变契约形状，落笔前需确认：

- `ShopItem.quantity` 现有语义未定义（可购上限 / 已拥有 / 剩余库存）。mock 中 `quantity:0` 同时 `purchasable:false` + `"Inventory limit reached"`，倾向「剩余可购数量」。**提议**：`quantity` 明确为剩余可购数量（`null` = 不限），另新增 `owned_quantity?: number | null` 驱动「已持有」描边与 pip。若首版不下发 `owned_quantity`，则已持有态不出现，其余功能不受影响。
- 购买窗口是否严格等于 `BuyPhase`。复用 `phase_remaining_ms` 的前提是二者一致；若允许 ActionPhase 开商店，倒计时需改由 shop 侧下发。
- SCP:SL 的商品分类显示名与映射已在当前 mock 快照中确定；正式插件实现时仍需通过 `categories` / `category_id` 原样下发这些服务端语义，客户端不做推断。

> 2026-09-25：用户确认商店此前已整体验收，以上验收项据此勾选并归档。
>
> 2026-09-26：用户修订交互约束——交互模式不应由玩家手动控制，而是在打开商店 / 聊天框等界面时自动进入。删除 Ctrl+Shift+O，改为可配置的商店热键，见「Overlay 集成」与新增验收项。design.md / implement.md / research 中关于 Ctrl+Shift+O 的描述是当时的实现记录，以本 PRD 为准。
