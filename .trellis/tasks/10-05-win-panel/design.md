# Design: win panel

- Folder `src/features/winpanel/`: `model.ts` (reducer for `round.result`
  frames with `receivedAtMs`, selector `selectWinPanel(state, nowMs, roster)`
  returning a view model or null), `presentation.ts` (colour resolution per
  outcome/winner, avatar fallback reused from `features/hud/presentation.ts`),
  `WinPanel.tsx` + `WinPanel.css`.
- View model: `{ resultId, outcome, winnerRole, title, subtitle, accent,
  fill, mvp: { avatarUrl, name, reason, musicKit } | null, exitAtMs }`.
  Colours are CSS variables set on the root (`--winpanel-accent`,
  `--winpanel-fill`); no per-element colour props.
- Geometry and transitions from `styles/hud/hudwinpanel.css` and
  `layout/hud/hudwinpanel.xml` (`winPanelPosY` 190, width 400, top section
  margin-bottom 16, 0.3 s position/opacity transitions), checked against the
  captures; the capture wins on conflict.
- Checker background: SLUI-drawn SVG/CSS pattern masked with the accent colour
  (the shop's `wash-color` mask approach), animated with a CSS keyframe whose
  timing is fixed at mount.
- Fonts via `src/shared/fonts.ts` (Stratum2 from the theme pack, bundled
  fallback otherwise).
- The win panel sits above the team counter in z-order and does not shift it.
