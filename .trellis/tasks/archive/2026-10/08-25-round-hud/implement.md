# 顶部 HUD 实施计划

1. 将 SLGO `RoundState`、`ScoreManager`、`PlayerMatchStats` 映射为 v0 match fixture。
2. 实现 reducer、计时 formatter、team/player selectors 和七阶段状态文案。
3. 重构顶部 UI，按 CS2UI teamcounter XML/CSS 和资源加入动态玩家卡片（保留 54px 单卡并支持 10v10）、双方人数、服务端授权的血量条/数字，以及 presentation-only 的经济、武器、投掷物、NTF 三态护甲、C4 和拆弹器摘要；详细态逐项采用 Panorama 的字体、14px/176px/86px 几何、mask 与展开层级，不引入无源码依据的 HUD 状态徽标或装饰。带验证 mock 的开发模式加入 URL 同步调试面板，覆盖视角、七阶段、20 人阵容和 availability。
4. 添加换边、死亡/离线、旧 sequence、实例重启和无比赛测试。
