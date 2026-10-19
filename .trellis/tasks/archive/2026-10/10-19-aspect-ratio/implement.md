# Implementation plan

1. `src/shared/overlay.ts`: scale = `height / 1080`; document the Panorama layout space.
2. Canvas rules (`width` / `margin-left` from `100vw / scale`, clamped to 1920):
   `BottomHud.css`, `HudTeamCounter.css`, `MessageZone.css`, `ProgressCard.css`, `KillFeed.css`,
   `MinimapRadar.css`, `WinPanel.css`, `ShopPanel.css` (width only).
3. Centre anchors: `.bhud`, `.hudmsg`, `.hudprogress` -> `calc(50% - half width)`.
4. Update comments that say "1920x1080 overlay canvas" where they now mislead.
5. Spec: `.trellis/spec/frontend/cs2-visual-replication.md` viewport contract + matrix rows.
6. Validation:
   - `npm run lint`, `npm test`.
   - Mock preview (`slui-mock`) at 1920x1080, 1280x720 (unchanged), 1920x1200, 1680x1050, 1440x1080,
     1024x768: screenshots of in-round HUD, buy menu, win panel, alerts / progress scenes.
   - Check bottom HUD bottom edge = viewport bottom - 16 * scale; killfeed right edge = viewport right -
     10 * scale; radar left = 12 * scale.
7. Review gate: UI PR, waits for the user's visual review before merge.
