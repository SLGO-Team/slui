# Overlay clock out of the App root

## Goal

The overlay's 250 ms presentation clock lives in `App` (`setNowMs` every tick), so every
tick re-renders the whole overlay, and because `selectRoundHud` rebuilds its `teams`
arrays from `nowMs`, every `useMemo` downstream of `hud` (scoreboard, bottom HUD, win
panel roster, slot colours, chat self, progress viewer) recomputes 4 times a second while
the game runs. Move the clock out of `App` so a panel re-renders only when something it
draws actually changed with time.

## Requirements

- `App` holds no clock state and its render does not run on clock ticks. It re-renders
  on clock time only when a value it reads itself changes: HUD or shop availability
  (live → stale) and nothing else.
- Per-second counters (round / generator clock, shop countdown, scoreboard match time,
  hud-message countdown text) and expiry-driven lists (killfeed, win panel, message
  zone, chat history) are selected inside the panel that draws them and re-render only
  that panel, only when their output changes.
- Command timeouts (shop purchase / request, chat send) keep the same 250 ms
  granularity, but the reducers are only ticked while a command is pending.
- The HUD panels skip re-rendering when their props did not change (`memo`), and the
  props `App` passes are stable between unrelated events.
- Debug / mock surfaces keep today's look (frozen clocks, always live debug frames)
  without a clock in `App`; debug selectors never run in a non-debug build.
- Events reach only the reducers that read them (a dispatch re-runs App even when the state is unchanged).
- No visible behaviour change: same clocks, same expiry times, same staleness rules.

## Acceptance Criteria

- [x] `App` does not render on clock ticks or on events no App reducer reads: mock, 5 s, 192 → 12
      renders, each a real `match.snapshot` change.
- [x] During a running clock only its leaf re-renders each second; the team counter body, bottom
      HUD, scoreboard and shop do not. Observed in the mock for the scoreboard match time and the
      hud-message countdown; the round clock uses the same hook but is frozen in the debug HUD, so a
      live round clock is covered by the smoke tests only.
- [x] Killfeed rows, win panel, hud messages and chat rows still disappear at the same
      times; countdown texts still tick each second.
- [x] Shop purchase and chat send still time out (`SHOP_COMMAND_TIMEOUT_MS`,
      `CHAT_COMMAND_TIMEOUT_MS`).
- [x] `npm run lint`, `npm test` pass; HUD, scoreboard, shop, hud-messages, win panel,
      killfeed and chat layout audits pass unchanged (hud and winpanel audits fail identically on main:
      bombNodeCount and win-mvp-ace avatar x, pre-existing).
- [x] New clock store / selection logic has a smoke test.

## Out of scope

- Bundle size, fonts, lazy-loading of mocks (separate optimizations).
- Animation clocks that already run per panel (bottom HUD particles, progress card,
  win panel checker, minimap, world blur).
