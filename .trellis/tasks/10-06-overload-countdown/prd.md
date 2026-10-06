# Generator overload countdown in the low hint slot

## Goal

While a generator is active, players see how long is left until it overloads, in the CS2 high-hint
position (bottom centre, red bars, y 802) together with 「发电机已被启动。离过载还剩 40 秒。」, both in
SLUI and in the plugin's own Hint UI. Source: user request 2026-10-06 after the CS2 HUD panels live test.

## Background (verified)

- The plugin shows 「发电机已被启动。\n离过载还剩 {s1} 秒。」 (`SLGO_Notice_Generator_Started`, CS2
  `Cstrike_TitlesTXT_Bomb_Planted`) in `HintLow` for 6 s with a fixed number, then nothing in that slot.
- The overload countdown today is only 「发电机激活中 Ns」 in the plugin's top timer Hint
  (`GeneratorUI.ShowCountdownToAll`). SLUI's `top-hud` takeover hides it and SLUI's timer, like CS2,
  shows only the blinking generator glyph, so SLUI players have no number at all.
- `HudMessageBoard` holds one message per hint slot: any later low hint (pick-up, drop, ...) replaces
  the previous one.
- The wire countdown token `{time_remaining}` is drawn as `m:ss` only (`@slgo/protocol`, plugin
  `HudMessageCatalog.FormatTimeRemaining`, SLUI `formatHudCountdown`).

## Requirements (user decisions 2026-10-06)

- R0 The started hint moves to the high-hint slot, as in CS2 (user 2026-10-06). Its text and 6 s
  lifetime stay.
- R1 When the started hint ends, the same high-hint slot shows a separate countdown 「离过载还剩 N 秒」
  that counts down every second until the generator overloads or is shut down (or the round resets).
- R2 The number is plain seconds (「N 秒」), not `m:ss`; this needs a seconds countdown token on the wire.
- R3 Other high hints (e.g. 「你需要手持指挥官钥匙卡才能启动发电机」, buy-menu refusals) still show
  when they happen; they cover the countdown for their own lifetime and the countdown returns when they
  end. Low hints (pick-up, drop) use their own slot and never touch it.
- R4 The top timer stays as it is (SLUI glyph; the plugin's 「发电机激活中 Ns」 timer Hint unchanged).
- R5 Everyone sees it (the started hint is broadcast to all players today).
- R6 Compatibility: deploy order backend (protocol) -> plugin -> SLUI, as for the HUD panels. A plugin
  without the countdown changes nothing for SLUI; SLUI without the token support must not receive it
  (the sidecar validates; deploy order handles it).

## Acceptance Criteria

- [ ] AC1 After a generator starts: 6 s started hint, then 「离过载还剩 N 秒」 ticking down each second in
      the high-hint slot until overload / shutdown / round reset; same in plugin Hint UI and SLUI.
- [ ] AC2 Another high hint during the countdown replaces it for its lifetime; afterwards the countdown is
      back with the correct number. Low hints show at the same time in their own slot.
- [ ] AC3 Shutdown: 「发电机已被成功关闭。」 shows and the countdown is gone; it does not come back.
- [ ] AC4 Protocol, IPC schema/fixtures, plugin self-check and SLUI parser agree on the seconds token;
      contract tests cover valid and invalid examples in all three repos.
- [ ] AC5 Lint / tests / builds pass in all three repos; specs updated; live test with the user.

## Out of Scope

- Changing the CS2-style top timer, the started hint text, or any other countdown's format.
