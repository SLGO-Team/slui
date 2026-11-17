# 小地图 CS2 对齐：说话提示

父任务：`11-17-minimap-cs2-parity`（D13）。在 `11-17-minimap-cs2-slui` 合入后再开始规划。

## Goal

队友说话时，雷达上像 CS2 一样显示绿色喇叭：在雷达范围内显示 `SpeakingOnMap`（18×18，`#78ff00`），
被推到边缘时显示 `SpeakingOffMap`（26×24，y −3px，`#78ff00`）。

## CS2 依据（client.dll 逆向，2026-11-17）

详见 `archive/2026-11/11-17-minimap-cs2-slui/research/cs2-radar-client-re.md` 的 "Speaking icons" 一节。

- 显示条件：本机正在播放该玩家的语音（最后一个语音包在 0.2 s 内）、服务器语音掩码 `m_AudiblePlayers` 允许本机听到他、
  本地玩家在 T/CT（活着或已死）且和他同队（`mp_teammates_are_enemies` 为 0）。没有模式或人数上限判断。
- 只有活着的图标会显示喇叭，死亡 X 和幽灵标记不会。自己的图标不会显示，观察者队、GOTV 和回放也都不会显示。
- 在雷达边缘时，SpeakingOnMap 和 OnMap 一起左移一位，变成 SpeakingOffMap。
- 布局：两者都在 `#PI_FirstRotated` 中，紧跟 `#ViewFrustrum`、位于所有点和箭头之前：会随朝向旋转、被点或边缘箭头盖住，
  也受图标缩放影响。`map_speaking_onmap/offmap.vsvg` 的几何还没从 `pak01` 读出。

## 用户决定（2026-11-17）

SL 侧分析见 `research/sl-voice-speaking.md`。

| 问题 | 决定 |
| --- | --- |
| 「在说话」的判定 | 按观看者逐个判断是否真的收到：SL 原生 `VoiceTransceiver.OnVoiceMessageReceiving` 把该玩家的语音包发给这个观看者后 0.2 s 内算说话（已经过 SLGO 队伍路由、观察者静音和热身桥接）。 |
| 谁能看到谁 | 照搬 CS2：已分配阵营的玩家（含死后观战）能看到本队活着的队友说话；自己、敌人都不显示；无阵营观察者、Overwatch 和 demo 回放都不显示；竞技和休闲模式规则相同。 |
| 计入的频道 | 近距离、对讲机、SCP 频道、079 摄像头广播、Intercom 广播都算；SCP-939 模仿（Mimicry）不算；观察者频道和 SCP-1576 的发送者已死亡，自然不显示。 |
| 协议 | 新的 minimap schema 版本，每个标记一个说话标志；说话状态不进 `visibility_revision` 签名。 |

## Open

- 协议形态、旧客户端回落、插件收听记录：已在 `design.md` 定下（v8；sidecar 为旧客户端降级成 v6；部署顺序 backend → 插件）。
- 喇叭颜色：源图 `#68ac4b` 乘 wash `#78ff00`（约 `#31ac00`），还是纯 `#78ff00`？视觉评审时定（design §4.2）。

## Acceptance（初稿）

- [ ] 观看者真实收到队友语音时，在 ≤1 帧位置更新的延迟内出现喇叭，停止说话 0.2 s 后消失；在范围内用 SpeakingOnMap，
      在边缘用 SpeakingOffMap。
- [ ] 敌人、自己、死亡或幽灵标记都不显示；无阵营观察者和回放都不显示；Mimicry 不显示。
- [ ] 说话状态变化不让 `visibility_revision` 增加。
- [ ] 协议、插件、backend 和 SLUI 的契约测试都覆盖新字段；旧版本插件不会让 SLUI 出错。
