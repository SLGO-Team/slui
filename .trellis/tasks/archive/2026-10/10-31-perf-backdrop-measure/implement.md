# Implement: backdrop measure skipping

## Checklist

1. Baseline (before any edit): `research/build-mock-profile.mjs` build + `OVERLAY_URL` A/B of main-thread Script
   (done during planning: 44–49 ms/s running, 33–35 ms/s with measurement skipped).
2. `src/platform/backdrop.ts`:
   - `measureAll()` (the current `send()` body without the sink call) and `send(now)` using it; cache each element's box.
   - Lazy `MutationObserver` over every registered element's ancestor-or-self chain, rebuilt on register/unregister.
   - `relevantAnimation()` over `document.getAnimations()`.
   - `tick(now)` with the decision in `design.md`; `SAFETY_MEASURE_MS = 500`.
   - Mock-only `__SLUI_BACKDROP_DEBUG__` counters and `check` self-test (`declare global` on `Window`).
3. `research/backdrop-check.cjs`: drive the mock preview with `check: true` through shop open/close, killfeed and
   message traffic, scoreboard, window resize, radar blur toggle; print measured/skipped/stale.
4. Verify: `npm run lint`, `npm test`, `npm run build:local`; `backdrop-check.cjs` stale = 0; A/B Script time on the
   production-React mock build; `minimap-visual-audit` (blur pixel checks) passes.
5. Spec (Phase 3): `cs2-visual-replication.md` / `system-boundaries.md` world-blur notes mention when regions are measured.

## Validation commands

```bash
npm run lint && npm test && npm run build:local
npm run dev:mock -- --port 1420 --strictPort &
node .trellis/tasks/10-31-overlay-perf/research/backdrop-check.cjs
```

## Rollback point

Single commit on `src/platform/backdrop.ts` (plus the research script); revert restores per-frame measurement.
