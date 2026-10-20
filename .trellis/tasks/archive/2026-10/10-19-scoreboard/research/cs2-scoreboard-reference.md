# CS2 scoreboard reference (Panorama + user screenshots)

Visual authority: the user's three CS2 competitive screenshots (2026-10-19, 1920x1080 game area under a window
title bar): page 1 passive, page 1 cursor mode, page 2 passive. Panorama sources in `../cs2ui/panorama` give
structure and measurements only.

## Files

- `layout/scoreboard.xml`: snippets `snippet_sb-meta` (header), `snippet_scoreboard__classic-teams--CT` /
  `--TERRORIST`, `snippet_scoreboard-classic__half-time-scores`, timeline segment snippets,
  `snippet_scoreboard-classic__round-loss-bonus-money`, `snippet_sb-footer`, `stat--*` cells.
- `scripts/scoreboard.js`: sort tables (~L415-504), `_SortPlayer` (L696), label sets and header click
  (~L1240-1320), `_CycleStats` (L2166), mouse hint (`cl_scoreboard_mouse_enable_binding`, ~L1573).
- `styles/scoreboard.css`: row transition `position, opacity` 0.25 s ease-in-out (L561-565), opacity 0.1 s
  (L576-578), `brightness, wash-color` 0.25 s ease-out (L607-609), `anim-pulse` 1 s (L1014-1039).

## Behaviour notes

- Header (`snippet_sb-meta`): mode image + `id-sb-meta__labels__mode-map`, `CSGOGameTimeLabel time-type="map-elapsed"`
  on the right. Second row: server name (`mouse-active-hidden`) and the button panel (`mouse-active-visible`):
  cycle stats (`id-sb-meta__cycle`, `icons/ui/stats.vsvg`), mute voice, block UGC.
- Footer `id-sb-mouse-instructions` is `mouse-active-hidden` ("[MOUSE2] 启用光标").
- Competitive sort (`sortOrder_tmm`): `dc`, `damage`, `kills`, `risc`, `mvps`, `assists`, `deaths` (ascending),
  `leader`, `teacher`, `friendly`, `rank`, `idx` (ascending), ... Header click: clicked stat first, then the
  mode chain; no direction toggle; `sortstat` class on the active label. Hovering a player row pauses sorting.
- Stat cells `money`, `mvps` (star image + count label), `hsp`, `kdr`, `adr`, `utilitydamage`, `enemiesflashed`
  carry `spectator-hidden`.
- Loss bonus: 4 `dash-bold` images per team around the 战败补偿 label.
- Timeline: segments per phase, a divider between halves, per-round top/bottom result images; casualty tooltip
  and loss-bonus tooltip on hover (out of scope).

## SLGO mapping decided in planning

- CT on top -> SCP on top (SLUI `hudSideForRole`: SCP defends = CT, NTF attacks with the keycard = T; corrected
  during implementation from an earlier "NTF on top").
- Round reasons: elimination (skull), generator activated (NTF objective, the bomb analogue), generator
  deactivated (SCP objective, the defuse analogue), time expired.
- Header shows the mode only (no map, no server line), elapsed time kept.
