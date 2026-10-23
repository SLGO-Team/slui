# Implement: overlay clock out of the App root

1. [x] `src/shared/clock.ts`: ticker store, `createClockSelection`, `useClockSelector`;
       `scripts/clock-smoke.mjs` (start/stop with subscribers, refresh on start, reuse
       equal values, fresh value for a new select); add to `npm test`.
2. [x] HUD model: drop clock fields from `RoundHudViewModel`, add
       `selectRoundHudClock` + `RoundHudClockView`; update `hud-model-smoke`.
       `HudTeamCounter` / `RoundClock` take `clockAt`.
3. [x] Scoreboard: drop `nowMs` / `elapsed` from `selectScoreboard`; `Scoreboard` takes
       `elapsedAt`; update `scoreboard-model-smoke`.
4. [x] Leaf selection: `WinPanel` (`panelAt`), `MessageZone` (`zoneAt`), `KillFeed`
       (`noticesAt`), `ChatInput` (no `nowMs`), `ShopPanel` (`countdownAt`); equality
       helpers exported next to their selectors.
5. [x] Feature hooks tick only while a command is pending; remove App's interval.
6. [x] App: `useClockSelector` for live `hud` / `shop`; debug states built once per
       option change and evaluated at build time; debug memos gated on
       `HUD_DEBUG_ENABLED`; `memo` on panels and stable props.
7. [x] Spec: replace the "Feature hooks live in App, so every tick re-renders" rule in
       `quality-guidelines.md` with the clock-store rule (section 2 of design.md).

## Validation

- `npm run lint`, `npm test`
- `npm run hud-layout-audit`, `scoreboard-layout-audit`, `winpanel-layout-audit`,
  `hudmessages-layout-audit`, `chat-layout-audit`, `bottomhud-layout-audit`
- Render count in `npm run dev:mock` (temporary counter, not committed): App idle 0
  renders / 5 s; round clock leaf 1/s; killfeed row expiry and shop / chat timeouts
  observed.

## Review gates

- After step 6: `trellis-check` over the whole diff.
- Not a visual PR (no pixel change intended) → auto-merge once CI passes.
