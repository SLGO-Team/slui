# Design: overload countdown

## 1. Wire: seconds countdown token

- New literal token `{seconds_remaining}` beside `{time_remaining}`, drawn as the remaining whole
  seconds rounded up (`40`, ... `1`, `0`), no padding. Rounding matches the plugin's
  `FormatTimeRemaining`.
- Same field: `countdown_remaining_ms` is required exactly when the text contains either token (at most
  one kind per text). Constants `HUD_SECONDS_REMAINING_TOKEN` in `@slgo/protocol` and
  `SidecarConstants`.
- Additive within protocol v0: old texts are unchanged; an old parser rejects a text with the new token
  (it has a countdown but no `{time_remaining}`), so the backend must be deployed before the plugin.

## 2. Plugin (SLGO)

- Catalog: `SLGO_Notice_Generator_Started` moves from `Low` to `High` (CS2 bomb planted is a high
  hint), keeping its 6 s lifetime (explicit duration if the high default is 3 s).
  `SLGO_Notice_Generator_Overload_Countdown` (no CS2 key), `High`,
  「离过载还剩 {seconds_remaining} 秒」（SLGO 自有文案不加句末标点）; factory `HudMessages.GeneratorOverloadCountdown(deadlineMs)`.
  `HudMessageCatalog.Format` resolves `{seconds_remaining}` from `DeadlineMs` for the plugin Hint (the
  existing once-per-second redraw already re-renders messages with a deadline).
- `HudMessageBoard`: a per-player *standing* high hint (`SetStandingHigh` / `ClearStandingHigh` /
  `ClearStandingHighForAll`). `Get(HintHigh)` returns the transient high hint when present, otherwise the
  standing one; `Changed(HintHigh)` is raised whenever the visible one changes (transient expiry reveals
  the standing hint). The standing hint never expires on its own.
- `GeneratorUI`: on activation, broadcast the started hint as today and set the standing countdown for
  every player with the overload deadline (board clock); on deactivation, overload and reset, clear it.
  Players joining mid-countdown get it too (set for all current players; late joiners on their spawn /
  next tick, whichever the board offers; decide in implementation, keep it simple).
- `SidecarHudRules`: keep `{seconds_remaining}` literal on the wire with `countdown_remaining_ms`;
  validator mirrors the parser.

## 3. Backend (slgo-backend)

- IPC v1 README event table note and fixtures: a valid publish with `{seconds_remaining}`, invalid ones
  (token without countdown, countdown without either token, both tokens). The sidecar validates through
  `@slgo/protocol`, which the backend workspace links to the sibling checkout `../slui/packages/protocol`:
  the backend picks the new rule up from slui's working tree, so a backend release must be built while
  slui is on a commit with it.

## 4. SLUI

- `packages/protocol`: parser accepts the new token; contract smoke cases.
- `selectMessageZone`: `{seconds_remaining}` -> `formatHudSeconds(ms)`; layout unchanged (the high slot,
  two lines for the started hint as captured).
- Mock: `generator-started` scene in the high slot, continuing into the countdown after 6 s; the separate
  `hint-high-two-line` layout fixture becomes redundant.

## 5. Order

slui protocol PR -> backend (consumes it) -> plugin -> slui renderer (same PR as protocol is fine) ->
deploy backend, plugin, SLUI build -> live test.
