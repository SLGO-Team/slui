# Implement: alerts and hints

Branch `feat/hud-alerts` from `main` after the data channel merged.

1. [x] Shared `hudmessages` reducer/selector (or reuse if progress landed) +
       `scripts/hudmessages-model-smoke.mjs` in `npm test`.
2. [x] `MessageZone` component + CSS; mount in `App.tsx`; debug scenes.
3. [x] Layout audit script + npm script; 1920x1080 and 1600x900.
4. [x] Visual comparison with local captures.
5. [x] A8 feature declaration rule (hud-progress not merged yet: not declared here).
6. [x] Spec: `cs2-visual-replication.md` message-zone section.
7. [x] `npm run lint`, `npm test`, `npm run build:local`, `npm run tauri:check`.
