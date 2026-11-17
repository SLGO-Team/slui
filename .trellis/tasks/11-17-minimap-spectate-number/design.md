# Design: spectate selection box and observer numbers

SLUI only. No protocol, plugin or backend change: both features derive from data SLUI already has (the minimap
frame's viewer / viewpoint and the HUD `match.snapshot` team lists).

## Selection (D15)

- `RadarMarker` gains `selected: boolean`, set in `selectMinimap`'s `decorate`:
  `selected = followed && viewer is not alive && !edge`.
  - `followed` already means "live marker whose player is the viewpoint player" (interpolated pose).
  - "viewer is not alive" = `frame.payload.viewer.is_alive === false`: a dead team member following a teammate,
    a team-less spectator or a demo replay viewer following a player. A living viewer's followed marker is self,
    and CS2 never selects for a non-observer.
  - A free-camera viewpoint (v7 `player_id: null`) matches no marker, so nothing is selected.
  - Edge markers never show it (CS2's off-map mask shift), nor do dead / last-known markers (they are never
    `followed`).
- Render: `PlayerMarker` draws `<img class="minimap-marker__selected" src="/assets/minimap/selected.svg">` in a
  second rotated `minimap-marker__direction` span placed after the dot (CS2 lists `#Selected` last in
  `#PI_FirstRotated`, so it paints over the dot, and it turns with the heading). Box 42×36, centred, y −10:
  `left: -21px; top: -28px`. Not washed (`filter: none`, selector at least as specific as the wash rule).
- Asset `public/assets/minimap/selected.svg`: SLUI-drawn from the measured geometry (repository rule: CS2 Panorama
  files are reference only). In the 42×36 box: ring centre (21.2, 27.6), outer r 8.2, inner r 6.5, teardrop point at
  y 15.7; two white radial glows (stops 1 / .7 / .42 / .14 / 0) fanning forward inside the box, clipped like the
  source's diamond clip paths. Keep the source's proportions by drawing in its 79.381×66.417 viewBox.
- `data-selected` on the marker for audits.

## Numbers (D16)

- `playerObserverNumbers(teams)` in `src/features/hud/presentation.ts`, next to `playerSlotColors`:
  SCP team (CT side via `hudSideForRole`) players first, then NTF, each in snapshot order; list position `i` gets
  `String((i + 1) % 10)` while `i <= 9`, nobody after. Returns `Record<playerId, string>`.
- `App` memoises it from `hud.teams` like `playerColors` and passes `playerNumbers` through `LiveMinimapRadar` /
  `MinimapRadar` to `PlayerMarker`.
- Gate in the model so it is testable: `radarMarkerNumber(marker, observer, numbers)` (model.ts) returns the label
  only when `observer` (team-less viewer with a frame, existing `MinimapViewModel.observer`), the marker is `live`
  and not at the edge; otherwise null.
- Render: `<span class="minimap-marker__number">` after the selection span, not rotated, centred on the dot:
  `font: 500 10px/1 "Stratum2 Radar"`, `color: #000`, `text-align: center`, `transform: translate(-50%, -50%)`
  plus CS2's 1px top / 1px right margins (net +0.5px down, −0.5px left). It scales with the marker
  (`--radar-icon-scale` on `.minimap-marker`). No text shadow.

## Mock and audit

- Mock: `?minimapViewer=observer` makes the preview viewer team-less (`team_id: null`, `is_alive: false`) with
  every marker `observed` in team colours, following `positions[spectate]`; the mock HUD snapshot already has
  both rosters, so slot colours and numbers resolve. Exact player-id alignment with the mock HUD is checked during
  implementation; if they differ the mock passes matching numbers.
- Visual audit: `dead-spectate` asserts exactly one `.minimap-marker__selected` on the followed marker and none on
  others, box size 42×36 × icon scale, rotation equal to the marker yaw; alive captures assert no selection and no
  numbers; a new `observer` capture asserts numbers on every live in-range marker, text order SCP-first, computed
  font 10px / weight 500 / colour black / no rotation, centre within 1px of the dot centre.

## Compatibility / rollback

Pure client rendering; reverting the PR removes both. No stored state, no protocol change.
