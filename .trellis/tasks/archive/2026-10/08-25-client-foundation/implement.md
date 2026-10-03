# 基础链路实施计划

1. 建立 contracts 目录，复用 `protocol/v0` schema，补齐 shop/chat command/result 类型。
2. 抽出 platform adapter 接口和 connection state store，先接 mock provider。
3. 实现 SteamID discovery、授权闸门、route TTL、sequence/instance guard 和诊断状态。
4. 把现有 overlay shell 改为消费 provider，按 CS2UI `layout/hud/hud.xml` 建立区域层级、公共 token 和 source map，不改变 passive/interactive 行为。
5. 添加 parser、route、权限、多实例和重连测试，提供给后续 feature 子任务。

后续子任务只能依赖 typed provider，不得绕过本层访问 raw event。
