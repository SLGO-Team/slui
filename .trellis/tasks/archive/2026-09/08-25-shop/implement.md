# 商店实施计划

## 前置输入

- [x] 0a. `1920x1080` CS2 购买菜单实机截图已存盘为 `research/buymenu-live-1920x1080.png`（T 方视角、余额 $2500、购买阶段）；实机校正结论已写入 `research/cs2ui-buymenu.md` 第 9 节。
- [x] 0b. SLGO 插件侧尚未开始实现，商店契约由 SLUI 定义、插件后续遵循。`purchasable` 含余额判断、`quantity` 为剩余可购数量、新增 `owned_quantity` —— 三项在第 1 步写入 schema 描述。

无外部阻塞项，第 1 步起即可执行。

## 执行顺序

1. [x] 补齐 `protocol/v0/` 下 `shop-snapshot.schema.json`、`command.schema.json`、`command-result.schema.json` 及 example，与已有 TS 契约对齐；加入可选 `categories` / `category_id` / `owned_quantity`，并在描述中写明 `purchasable` 含余额判断、`quantity` 为剩余可购数量。
2. [x] 扩展 `src/contracts/index.ts`：`ShopCategory` 类型、`ShopSnapshot.categories?`、`ShopItem.category_id?` 与 `owned_quantity?`，并在 `parseShopSnapshot` 中校验（`order` 整数、`id` 非空唯一、未命中 category 的商品不报错）。新增字段全部可选以保持向后兼容。
3. [x] 把 `hudScaleForViewport` 提升为 `src/shared/` 的 `overlayScaleForViewport`，抽 `useOverlayScale()` hook，替换 `HudTeamCounter.tsx` 内的局部 resize 监听。**回滚点**：此步改动 HUD，需先确认 HUD audit 仍通过。
4. [x] 实现 `src/features/shop/model.ts`：`ShopSnapshotFrame`、`shopReducer`、pending 命令表、`SHOP_COMMAND_TIMEOUT_MS`、补全 `ShopCommandState`（加 `timedOut`/`rejected`/`abandoned`）、`selectShop` 与 `ShopViewModel`。过期 snapshot 走两段式：只改状态标记，保留 frame。
5. [x] 实现 `src/features/shop/presentation.ts`：内容宽度常量、列宽分配函数（5 列套实测比例，其他列数等宽）、阵营 wash 取值、图标 fallback 映射。纯 CSS 关心的量（卡片高度、间距、遮罩不透明度、面板底色）只留在 `ShopPanel.css`，不在两处各存一份。**不实现任何 `balance < price` 派生。**
6. [x] 扩展 mock fixture 覆盖六态（可购买/不可购买/已持有/pending/失败/断线），含分类与无分类两组数据；实现 `shopDebug.ts` + `ShopDebugPanel.tsx`，用真 reducer 构造状态并同步 URL。
7. [x] 手工实现 `ShopPanel.tsx` + `ShopPanel.css`：五列栅格、商品卡四角绝对定位布局、三段式信息条、详情面板、失败提示位、底部操作栏（按键令牌与标签异色）。按 `research/cs2ui-buymenu.md` 取值，逐项对照基准图校正。**禁止径向布局；禁止把商品卡译成 flex 单行；遮罩不得照抄 0.95。**
8. [x] 使用 `slui-svg/svg` 中的 SCP:SL 图标，统一拷贝到 `public/assets/slui-svg/`，并移除商店自绘图标与 HUD 的 CS2 图标；声明所需 `@font-face`，`font-stretch:condensed` 改写为显式 Condensed family，monodigit 补 fallback 链，按规范加 `ascent-override`/`descent-override`。
9. [x] 接入 `createOverlayWindowController()`：消费 Ctrl+Shift+O 的 `interaction` 快捷键，商店可见 = `window_open && overlayInteractive`，Esc 只关商店，不因 `window_open` 反向请求 interactive；遮罩在 `window_open === false` 时不渲染。
10. [x] ~~新增 `scripts/shop-layout-audit.mjs` 与 `scripts/shop-visual-audit.mjs`~~ **已撤销**：按用户决定不引入商店 audit 脚本，视觉验收改为人工对照基准图。两个脚本与 `package.json` 中对应的 scripts 条目已删除；`hud-*-audit` 属既有 HUD 任务，未动。
11. [x] 补测试：`contract-smoke.mjs` 追加 shop 段或新增 `scripts/shop-model-smoke.mjs`，覆盖重复 command id、`duplicate` 按成功处理、超时不清 pending、迟到 result、插件拒绝、instance 切换与断线重连 baseline、无 authority、分类缺失退化。
12. [x] 复审实现与基准图/源码的偏差并修复：信息条与列头内部高度、navbar 屏幕居中、图标按高度定比（`mask-size: auto 41px`）、遮罩去 blur、面板底色 0.75、详情卡 `#000000d0`、已持有描边改回白色、补齐 Mono/medium/monodigit 字面、移除硬编码 `$4,400` 与编造的 F3/F4/DEL 标签、卡片快捷键改为列内序号、清理死常量与死 class。`.shop-content{top:220px}` 为防遮挡顶部 HUD 的刻意取值，保留。
13. [x] `ShopPanel` 挂入 App composition。默认不可见（需 `overlayInteractive && window_open && hasSnapshot`），且视觉 audit 必须在组件挂载后才能执行，故此步为第 14 步的前置而非其结果。
14. [x] 对基准图逐像素实测并修正。新增 `?shopOpen=1` 让商店可见状态可从 URL 复现、`?shopDebug=0` 隐藏调试面板，便于截干净的对照图。实测修正：`.shop-left` 补 `margin-left:16px`（整体右移 8px，body 落在 x=252..1202）、信息条 36→42px、余额缩进 28px、商品名与价格改用阵营 wash 色（`buymenu.xml:28-30` 三个元素都带 `hud-colorize-wash`）、卡片子元素纵向缩进 8→4px（`padding:4px 10px`）、`.shop-right` 改从 contents 原点起算（`margin-top:180px` 只在 `.buymenu-left` 上），详情卡 670→708px、失败条改为 `bottom:120px`。信息条 220 / body 266 / 详情卡 748，相对基准图的 180 / 226 / 708 整体 +40，内部比例一致。
15. [x] 恢复遮罩的引擎效果。此前误以「`buymenu.css` 未声明」为由删除 `backdrop-filter`，属判断错误：Source 2 的屏幕空间模糊与降饱和在渲染管线中，样式表不会声明，而视觉权威顺序中实机画面优先于样式表。已恢复 `blur(2px) saturate(.72) brightness(.86) contrast(.94)` 与边缘加重的径向渐变，并在 CSS 与 `research/cs2ui-buymenu.md` §9.2 写明不得再简化为纯 alpha。
16. [x] 解除 `README.md` 与 `08-26-panorama-source-translation/prd.md`/`implement.md` 的商店排除声明（2026-09-25 用户确认）。
17. [x] ~~较低 16:9 分辨率等比缩放验证 + 六态定屏截图归档；`npm run tauri:check` 未在本轮执行。~~ 2026-09-25 用户确认商店此前已验收，本项不再执行。
18. [x] 更新 `.trellis/spec/frontend/`：把 Panorama `flow-children:none` → 绝对定位、border-box、`wash-color` → mask 这三条换算规则和商店的资源约定写进规范。
19. [x] 从 SCP:SL 英文官方 Wiki 下载当前商店商品的彩色原图到 `public/assets/shop-items/`，记录来源/许可，并在右侧详情区显示选中商品原图；商品卡剪影与协议保持不变。
20. [x] 分类标题改为非交互展示；实现数字键列选择、选中列内数字键购买和 `Esc` 取消列选择，并降低选中列亮度。
21. [x] 拆分悬停详情与商品图片状态：详情仅由鼠标悬停驱动，图片可由鼠标或有效键盘购买更新并在离开后保持；非法键盘商品取消列选择且不更新图片。
22. [x] 任务修复：将电板破坏强化放入最左侧装备分类并改用本地 CS2 拆弹钳图标，重画生命强化图标；调试面板增加普通 SCP / SCP-079 场景选择，并让 079 快照显示装备、危险、高危与电力升级分类且隐藏生命/护盾分类。
23. [x] 任务修复：移除生命/护盾分类标题中的“强化”，将低级/中级改为“危险/高危”，把 SCP-096 并入高危分类，并收窄生命图标、分离加号与心形。
24. [x] 任务修复：将五列布局中的危险列与生命列宽度互换，生命图标改为对称的标准心形轮廓。
25. [x] 任务修复：恢复 NTF 五列原始宽度，仅在 SCP 商店交换危险与高危列宽度。
26. [x] 任务修复：将 SCP 商店图标 wash 色切换为 HUD 阵营红色，并把生命强化图标改为标准心形字形，保持加号独立显示。

## 审查门禁

- 第 3 步后：HUD audit 必须仍通过，否则回滚缩放重构。
- 第 7 步后：肉眼对照基准图，确认五列比例、商品卡四角布局与遮罩压暗程度无结构偏差，再继续。
- 第 17 步后：六态截图齐备且可追溯到 `research/` 中的源码出处，方可进入第 16 步。
- 第 16 步是不可逆的对外声明变更，需用户确认后执行。
- 视觉验收为人工对照，不引入商店 audit 脚本。

## Risk Controls

- 不以 CSS 覆盖率、DOM 相似度或 bounding box 一致代替可见像素验收。
- 协议扩展字段保持可选，插件侧未就绪不阻塞其余实现。
- 视觉基准或产品映射变化时先更新 PRD，再改实现。
- 不重新引入生成式 Panorama 路线。
