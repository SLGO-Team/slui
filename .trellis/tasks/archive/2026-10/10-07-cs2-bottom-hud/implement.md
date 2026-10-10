# Implement: CS2-style bottom HUD

Branches: `feat/bottom-hud` in slui, slgo-backend and SLGO (each from an up-to-date `main`).

## Steps

1. Motion research (no code): step through the three recordings frame by frame (ffmpeg crops of the bottom
   band at 60 fps) and add to `research/cs2-bottom-hud-motion.md`: kill burst timeline (card drop, beam,
   emblem white, stroke glow, number flash; first card vs. fan cards vs. counter card), fan geometry per
   count, shot pop (scale, brightness, duration), clip bar, low-ammo red values, reload icon motion, odometer
   roll (direction, duration, per-digit stagger), all colours and 1080p geometry. Delete frame dumps afterwards.
2. `@slgo/protocol` (slui `packages/protocol`): `hud.status` types + strict parser + `parseEvent` dispatch,
   `v0/hud-status.schema.json` / `.example.json`, `CLIENT_FEATURE_HUD_STATUS`, `CLIENT_FEATURE_HUD_MONEY`;
   contract smoke cases in `scripts/contract-smoke.mjs`.
3. slgo-backend: publish/snapshot/single-recipient sets, IPC v1 schema enum, examples, invalid fixtures,
   README; `bun test`. Commit, PR (non-visual, auto-merge).
4. SLGO plugin: round kill kinds in `PlayerStatsManager`; `SidecarHudStatusRules` + publisher (presence gated,
   diff per frame, handshake resync); unit tests (build/validate parity with backend fixtures, kind mapping,
   icon mapping, null ammo cases, signature-only publishing); specs `sidecar-ipc.md` +
   `hud-semantic-model.md`. Commit, PR.
5. SLUI model: `src/features/bottomhud/model.ts` + presentation helpers, reducer wiring in `App.tsx`,
   `scripts/bottomhud-model-smoke.mjs` added to `npm test`.
6. SLUI assets: draw the SVGs listed in design section 5 under `public/assets/bottomhud/`; compare against the
   game look side by side locally.
7. SLUI component `BottomHud.tsx` / `.css` + motion from step 1; declare `hud-status` and `hud-money` in
   `OVERLAY_CLIENT_FEATURES`.
8. Mock provider scenes: `bottom-kills` (kills 1..14 over time, mixed kinds), `bottom-fire` (magazine emptied,
   reload), `bottom-balance` (balance steps), `bottom-scp` (SCP side, no ammo), `bottom-dead` (hidden);
   `hudSceneAt` pins work.
9. `scripts/bottomhud-layout-audit.mjs` (`npm run bottomhud-layout-audit`, CDP 9223) at 1920x1080 and a
   smaller 16:9 size; capture stills of each state and compare with the recordings.
10. Specs: `cs2-visual-replication.md` new section "Bottom HUD"; `system-boundaries.md` `hud.status` contract.
11. Live test with the user on a server (plugin + backend deployed), then slui PR (visual: no auto-merge, hand
    over mock preview URLs and wait for review).

## Validation

- slui: `npm test`, `npm run lint`, `npm run build:local`, `npm run tauri:check`, `npm run bottomhud-layout-audit`.
- slgo-backend: `bun test`.
- SLGO: `dotnet build` + `dotnet test`.

## Review gates / rollback points

- After step 1: motion numbers written before any CSS.
- After step 4: contract parity across the three repos (fixtures parse in all of them).
- After step 9: visual review by the user (mock preview), then live test.
- Rollback: remove `hud-status` / `hud-money` from `OVERLAY_CLIENT_FEATURES` (plugin reverts to its own hint).
