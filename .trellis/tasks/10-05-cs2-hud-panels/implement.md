# Implement: CS2 HUD panels (parent)

The parent owns no code. It sequences the children and runs the final
integration review.

## Order

1. `10-05-hud-data-channel` — must merge first; every renderer consumes its
   protocol types and mock fixtures.
2. `10-05-win-panel`, `10-05-hud-alerts`, `10-05-hud-progress` — independent of
   each other; any order. The later of alerts/progress adds `hud-messages` to
   `OVERLAY_CLIENT_FEATURES` (check `git log` / the other child's status
   before starting).
3. Parent integration review (below), then archive children and parent.

Each slui child is its own branch and squash-merged PR (`feat/<slug>`), per
`AGENTS.md`. Plugin and backend changes are committed on those repos' local
`main` (no remote), in their own Trellis tasks or directly as part of the
data-channel child, matching `10-02-minimap-bombsites`. The plugin working
tree currently has an unrelated uncommitted change in
`.trellis/spec/plugin/quality-guidelines.md`; leave it alone.

## Integration review (parent)

- [ ] Mock preview: every captured state renders together (win panel over the
      team counter, message zone, progress card) without overlap at 1920x1080
      and one smaller 16:9 size.
- [ ] Compare each state against the local reference captures
      (`research/cs2-reference-capture.md` lists them) and record deviations.
- [ ] Live test with the user on a real server: alerts, hints, generator
      start/shutdown card, round win/loss + MVP, match end; toggle the overlay
      off and confirm plugin hints return.
- [ ] Specs updated in all three repos (AC6).
- [ ] Delete the CS2 capture cfg (`<CS2>/game/csgo/cfg/slui_ref.cfg`) once the
      user no longer needs it (ask first).

## Validation commands

- slui: `npm run lint`, `npm test`, `npm run build:local`, `npm run tauri:check`,
  plus the new layout/visual audit scripts.
- slgo-backend: `bun run lint`, `bun test`.
- SLGO plugin: `dotnet test` (solution root).
