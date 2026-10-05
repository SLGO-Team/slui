# Implement: win panel

Branch `feat/win-panel` from up-to-date `main` after the data channel merged.

1. [ ] Model + selector + `scripts/winpanel-model-smoke.mjs` (wired into `npm test`).
2. [ ] Presentation (colours, avatar lookup) + tests in the same smoke.
3. [ ] Component + CSS; mount in `App.tsx`; debug-panel scene picker.
4. [ ] `scripts/winpanel-layout-audit.mjs` (CDP, like `hud-layout-audit`) +
       npm script; run at 1920x1080 and 1600x900.
5. [ ] Visual comparison against local captures; note deviations in the
       parent research file.
6. [ ] Add `CLIENT_FEATURE_WIN_PANEL` to `OVERLAY_CLIENT_FEATURES`.
7. [ ] Spec: `cs2-visual-replication.md` win-panel section.
8. [ ] `npm run lint`, `npm test`, `npm run build:local`, `npm run tauri:check`.
