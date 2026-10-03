# 商店与 HUD 不再用服务器 sent_at 对比本机时钟

## 背景

2026-10-03 竞技服玩家汐纳反馈 SLUI 商店"点击有声音但买不了"，同局其他玩家正常、服务器无错误。
`selectShop` 的陈旧判定为 `max(now - receivedAt, now - sentAt)`，`sentAt` 来自服务器时钟（插件/sidecar），
`now` 是玩家本机时钟。玩家电脑时钟比服务器快 5 秒以上（`SHOP_STALE_AFTER_MS`），商店就永远判为
`stale`：所有商品 `unavailable`，点击只播 deny 音。HUD 的陈旧判定同理；HUD 倒计时还减去
`receivedAt - sentAt` 作为"传输时间"，时钟偏快时倒计时偏少。

## 需求

- 商店与 HUD 的陈旧判定只用本机接收时间：`now - receivedAtMs`。
- HUD 倒计时插值只减去本机自接收以来的时间，不再减跨机器的"传输时间"
  （真实传输仅几十毫秒，跨时钟差值不可信）。
- `sentAtMs` 保留为信息字段，注明是服务器时钟、不得与本机时钟比较。

## 验收

- 回归测试：本机时钟比 `sent_at` 快/慢 1 分钟时，商店仍为 live 且可购买，HUD 仍为 live，倒计时不受影响。
- 现有 smoke 测试按新语义更新；`npm run lint`、`npm test` 通过。

## 结论（2026-10-03）

玩家同步 Windows 时间后可正常购买，确认根因为时钟偏差。
