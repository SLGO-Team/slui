# 顶部 HUD 设计

`match.snapshot` 进入纯 reducer，selector 输出 `RoundHudViewModel`。稳定 `team-a/team-b` 负责比分和头像分组；`current_role` 负责显示 NTF/SCP 标签。计时只使用服务端 `remaining_seconds` 与 `sent_at` 推导，不能以客户端递增状态作为权威。

队友 health 允许 `number | null`，敌方模型不定义 health 字段。状态栏和玩家列表分别显示 live/stale/restarted，避免用旧比分伪装当前比赛。

## Top HUD 视觉契约

- 顶部 HUD 是固定紧凑 scoreboard，中央栏只承载阶段、计时、比分、回合和连接状态；玩家卡片按稳定 `team-a/team-b` 两侧动态排列，保持 54px 单卡宽度并分别向中央栏对齐，10v10 时不裁剪或压缩卡片。
- compact 使用细白血条并以红色底色表达损失；显式 detailed 变体把同一条扩为 14px 并额外显示数字血量，不根据缺失的 spectator/local-dead 字段自行切换。
- 敌方卡片不显示血量；服务端未提供本方血量时，客户端显示 unknown，不推导数值。
- 卡片信息层级固定为：14px 玩家标签、54px 头像裁切、授权血量、金钱、武器、投掷物、NTF 三态护甲以及可选 C4/拆弹器。护甲状态使用轻型、战斗、重型三种 SLGO 图标，仅 NTF 显示；不显示 CS2 源码中不存在的 SLGO shield/AHP 条；compact 的既有 shield 表现本轮不改。
- 视觉组件只消费 `RoundHudViewModel` 和可选的 `TopHudPlayerMeta`，不读取原始 envelope 或调用 platform adapter。
- `compact` / `detailed` 由显式 presentation variant 控制；没有权威 spectator/local-dead 字段时，组件不得自行推断切换条件。开发预览默认使用 detailed，并允许通过查询参数切回 compact。
- 带验证 mock 的开发模式提供独立 HUD debug harness；场景 snapshot 仍经现有 reducer 和 selector 生成，面板状态同步到 URL，生产构建不渲染该面板。
- 开发 mock 的 `TopHudPlayerMeta` 必须根据当前 HUD 玩家 `is_alive` / `is_online` 投影：死亡或离线玩家只保留金钱，清空 weapon、utility、C4 和拆弹器；存活在线玩家保留场景装备。该约束属于 mock 数据正确性，不得在渲染组件中通过 CSS 或状态分支掩盖错误 metadata。
- Panorama 映射：`TeamCounterBG/TeamCounter/ScoreAndTimeAndBomb/TeamLargeCT/TeamLargeT` 对应 HUD shell、中央计分栏和两侧玩家条；详细态复用 `AvatarNameHeight=14px`、`AvatarLBGWidth=54px`、`healthbar=14px`、`equipinfo height=176px`、`padding-top=86px` 以及 money/weapon/nades/special 四行结构。Panorama 的 `94%` equipment mask 还叠加在头像列底层背景之上；React 合并这两层时，可见背景必须覆盖完整 54px 列宽，不能窄于头像边框或 52px 血条。不得添加无 source-map 依据的状态徽标、渐变、阴影或尺寸。
- Panorama 对死亡玩家把 `equipinfo__bg-container` 缩到 `101px`。用户实机确认该规则的原先表现正确，因此 React 的 `.hud-player--dead .hud-player__equipment-background` 同样恢复为 101px；死亡态装备内容继续灰化，101px 以下按源码语义保持透明。
- 详细态装备区阴影按 Panorama 的面板类型分派，不按行分派：`.equipinfo-root Image` 对应 `img-shadow: 1px 1px 1px 1 #00000090`，`.equipinfo-root Label`（仅金钱）对应 `text-shadow: 1px 1px 1px 1 black`，`strength=1` 表示只绘制一遍。React 因此把 `drop-shadow(1px 1px 1px #00000090)` 挂在 `.hud-player__equipment img` 上，金钱只保留 `text-shadow`。阴影不得挂在 `.hud-player__equipment-row` 上，也不得在 defuser/C4 上重复声明——CSS 的父子 `filter` 会合成，任何一种写法都会让金钱或特殊道具得到双层阴影。

## 当前接口状态

`MatchSnapshotEvent` 现在要求 envelope 提供 `sent_at`，HUD reducer 保存 `server_id`、`instance_id`、`sequence`、发送/接收时间和 baseline 状态；selector 结合受控本地 tick 推导剩余时间，并显式输出 live、stale、disconnected、restarted、baseline-required 和 no-match 状态。

协议仍没有权威 spectator 状态以及经济、装备字段。数字血量只对 viewer team 展示；`TopHudPlayerMeta` 保持为可选 presentation metadata，护甲状态也只作为待接入权威来源前的 mock/presentation 字段，不扩展当前协议。
