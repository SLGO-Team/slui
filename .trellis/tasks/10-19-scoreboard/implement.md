# Implement: CS2 scoreboard

Branches: `feat/scoreboard` in slui, slgo-backend and SLGO, each from an up-to-date `main`. The slui main checkout
is in use by another session (`feat/auto-update`), so slui work happens in a separate git worktree.

## Steps

1. Layout research (no code): measure the three user screenshots (1920x1080 game area) and Panorama
   `scoreboard.xml` / `scoreboard.css` into `research/cs2-scoreboard-layout.md`: panel box, header rows, column
   x positions and widths for both pages, row height and spacing, team block, emblem, half scores, timeline
   geometry and icons, loss-bonus pips, button row, footer hint, colours (row fills, local highlight, dead
   dim, team tints, sort highlight), fonts and sizes, hover and transition timings.
2. `@slgo/protocol` (slui `packages/protocol`): `scoreboard.snapshot` types + strict parser + `parseEvent`
   dispatch, `v0/scoreboard-snapshot.schema.json` / `.example.json`, `CLIENT_FEATURE_SCOREBOARD`; contract smoke
   cases. Separate PR (non-visual, auto-merge) so the backend can build against it.
3. slgo-backend: event sets, replay ageing of `elapsed_ms`, IPC v1 schema enum, example, invalid fixtures,
   README, dev client line; `bun test`. Commit, PR.
4. SLGO plugin: new per-side stats (headshot kills, MVPs, utility damage, enemies flashed, rounds played), round
   history in `ScoreManager`, ping source, loss bonus mapping, `SidecarScoreboardRules` (build, signature,
   validate) + publisher, hint-board suppression for `scoreboard` presence; unit tests (stat counting rules,
   reason mapping, build/validate parity with backend fixtures, signature ignores `elapsed_ms`); specs
   `sidecar-ipc.md` and the stats spec. Commit.
5. SLUI input spike, then full input: scoreboard hotkey in `platform/hotkeys.ts` + settings + Rust validation;
   key-up tracking; `WH_MOUSE_LL` right-click capture; `set_scoreboard_capture` command; overlay wiring to
   interactive + keyboard focus; home `HotkeySettings` row and `KeyHints`. Spike first: a debug build that
   captures right-click while CapsLock is held, tried in SCP:SL to confirm the game does not aim. Rust unit
   tests for key mapping and validation.
6. SLUI model + presentation: `src/features/scoreboard/model.ts`, `presentation.ts` (join, derived stats, sort
   chain, half scores, side fallback), `scripts/scoreboard-model-smoke.mjs` added to `npm test`.
7. SLUI assets: draw the SVGs listed in design section 6 under `public/assets/scoreboard/`.
8. SLUI component `Scoreboard.tsx` / `.css` from step 1; declare `scoreboard` in `OVERLAY_CLIENT_FEATURES`.
9. Mock scenes `scoreboard-competitive` and `scoreboard-casual` with held / cursor / page / side toggles.
10. `scripts/scoreboard-layout-audit.mjs` (`npm run scoreboard-layout-audit`, CDP 9223) at 1920x1080, 16:10 and
    4:3; side-by-side comparison with the screenshots for page 1 passive, page 1 cursor and page 2 passive.
11. Specs: `cs2-visual-replication.md` section "Scoreboard"; `system-boundaries.md` `scoreboard.snapshot`,
    the scoreboard hotkey and the mouse hook.
12. Live test on a server (plugin + backend deployed): hold / release, right-click does not aim, cursor, header
    sort, page switch persists across reopen, side view in the second half, casual mode, shop/chat interplay;
    then the slui PR (visual: no auto-merge, hand over mock preview URLs and wait for review).

## Validation

- slui: `npm test`, `npm run lint`, `npm run build:local`, `npm run tauri:check`, `npm run scoreboard-layout-audit`.
- slgo-backend: `bun test`.
- SLGO: `dotnet build` + `dotnet test`.

## Review gates / rollback points

- After step 1: measurements written before any CSS.
- After step 4: contract parity across the three repos (fixtures parse in all of them).
- After the step 5 spike: right-click capture works in game; if not, stop and decide with the user.
- After step 10: visual review by the user (mock preview), then live test.
- Rollback: remove `scoreboard` from `OVERLAY_CLIENT_FEATURES` (plugin reverts to its hint board).
