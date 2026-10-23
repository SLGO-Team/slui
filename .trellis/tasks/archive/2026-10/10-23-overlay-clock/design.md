# Design: overlay clock out of the App root

## 1. Shared clock store — `src/shared/clock.ts`

One module-level 250 ms ticker (`OVERLAY_CLOCK_INTERVAL_MS`), started by the first
subscriber and stopped with the last, like the minimap's external store.

```ts
subscribeClock(listener: (nowMs: number) => void): () => void
clockNow(): number          // time of the last tick; refreshed when the ticker starts
useClockSelector<T>(select: (nowMs: number) => T, isEqual?: (a: T, b: T) => boolean): T
```

`useClockSelector` = `useSyncExternalStore(subscribeClock, getSnapshot)` with a
with-selector cache: across ticks of the **same** `select`, a result `isEqual` to the
previous one returns the previous value, so the component does not re-render. A new
`select` (its inputs changed, the component is rendering anyway) always takes the fresh
value. The cache logic is a pure `createClockSelection` so `clock-smoke` can test it
without React.

Starting the ticker sets `clockNow()` to `Date.now()`; `useSyncExternalStore` re-reads
the snapshot after subscribing, so a component mounted after an idle period re-renders
with the current time rather than a stale one.

## 2. Where each time-derived value is selected

Rule: a value only one panel draws is selected **in that panel** from a `(nowMs) => T`
prop (memoised in `App` with `useCallback` on its state); a value `App` reads itself is
selected in `App` with `useClockSelector` and an **exact** equality, one that compares
every field the selector derives from `nowMs`.

| Value | Today | After | Equality (same inputs, two ticks) |
|---|---|---|---|
| `hud` (live) | `selectRoundHud(state, nowMs)` in App | App `useClockSelector` | `availability` (the only `nowMs` field once the clock fields move out) |
| round / generator clock | `hud.clockSeconds`, `generatorPulse` | `selectRoundHudClock(state, nowMs)` in `RoundClock` via `clockAt` prop | field-wise |
| shop countdown | `hud.phaseClockSeconds` | `countdownAt` prop, selected in `ShopPanel` | `Object.is` |
| `shop` | `selectShop(state, nowMs)` in App | App `useClockSelector` | `availability` |
| win panel | App `useMemo` | `panelAt` prop in `WinPanel` | both null / same `resultId` |
| message zone | App `useMemo` | `zoneAt` prop in `MessageZone` | per slot: both null / same `id` + `text` |
| killfeed | App `useMemo` | `noticesAt` prop in `KillFeed` | same id sequence |
| scoreboard match time | `view.elapsed` | `elapsedAt` prop in `Scoreboard`; `selectScoreboard` loses `nowMs` | `Object.is` (string) |
| chat history | `nowMs` prop | `ChatInput` selects `visibleChatLines` itself | same line references |

Model changes:

- `RoundHudViewModel` drops `clockSeconds`, `generatorPulse`, `phaseClockSeconds`
  (keeps `clockMode`, which is time-free). New `selectRoundHudClock(state, nowMs):
  RoundHudClockView | null`. `selectRoundHud`'s doc states `nowMs` only decides
  availability — the invariant the App equality relies on.
- `selectScoreboard` drops `nowMs` and `elapsed`; `scoreboardElapsedMs` +
  `formatScoreboardElapsed` already exist and are what the leaf calls.
- `selectShop`, `selectWinPanel`, `selectMessageZone`, `selectKillfeed`,
  `visibleChatLines`: unchanged signatures; their equalities are exported next to them
  (`sameShopTime`, …) so the invariant lives with the selector.

## 3. Command timeouts

`useShopFeature` / `useChatFeature` own their ticks: an effect subscribes to the clock
only while a command is pending (`hasPendingShopCommand(state)` /
`state.pending !== null`) and dispatches `tick`. `App` loses its interval.

## 4. Debug surfaces

`createHudDebugState` / `createShopDebugState` take `nowMs` only as receive / send
time, and today they are rebuilt every tick so the frames never go stale and clocks
stay frozen. After: build them once per debug option change, record the build time,
and evaluate their selectors at that time (`selectRoundHud(debug, builtAt)`, `clockAt =
() => selectRoundHudClock(debug, builtAt)`). Same pixels, no ticks. All debug
`useMemo`s return `null` unless `HUD_DEBUG_ENABLED`.

## 5. Memoised panels

`memo` on `HudTeamCounter`, `WinPanel`, `BottomHud`, `ProgressCard`, `MessageZone`,
`KillFeed`, `Scoreboard`, `ShopPanel`, `ChatInput`. Props made stable: minimap
`controls` object memoised; `bottomHud` (debug-scene branch) memoised.

## 6. Events reach only the reducers that read them (found while measuring)

With the clock gone, App still rendered ~20 times a second in the mock: `handleEvent` dispatched every
event, including 15 Hz `minimap.positions`, into all six reducers. A reducer returning the same state
does not help: `useReducer` has no eager bailout, so each dispatch re-runs App (children bail out).
Each model now exports the event types its reducer reads (`HUD_EVENT_TYPES`, …, `SHOP_EVENT_TYPES`);
`handleEvent` and `useShopFeature` dispatch only matching events. `event-routing-smoke` parses the
`SlgoEvent` union from the protocol source and checks every reducer returns the same state for every
type outside its list, so the lists cannot drift from the reducers.

## Measured (mock, 5 s, StrictMode dev renders)

| | main | branch |
|---|---|---|
| App renders | 192 | 12 (each a real `match.snapshot` change) |

## Compatibility / rollback

Frontend only; no protocol, Rust or settings change. Rollback = revert the PR.
Smoke tests that read `hud.clockSeconds` / `phaseClockSeconds` / `view.elapsed` move to
the new selectors.
