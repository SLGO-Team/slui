# CS2 radar: client.dll findings (2026-11-17)

Source: the user's installed CS2 `game/csgo/bin/win64/client.dll` (disassembly approved by the user),
panorama `layout/hud/hudradar.xml` + `styles/hud/hudradar.css` extracted 2026-11-16.
Addresses are for that build only; they are a trail for re-checking, not a contract.

## Convar defaults (registration block around 0x1800ed500)

| convar | default | range / note |
| --- | --- | --- |
| cl_radar_rotate | 1 | heading-up by default |
| cl_radar_always_centered | 1 | |
| cl_radar_scale | 0.7 | 0.25-1 |
| cl_radar_scale_alternate | 1 | 0.25-1 |
| cl_radar_scale_dynamic | 0 | "scales dynamically to encompass all the detected elements" (settings: 雷达正在动态缩放) |
| cl_radar_icon_scale_min | 0.6 | 0.4-1.25, not in the settings UI |
| cl_radar_square_with_scoreboard | 1 | |
| cl_radar_square_always | 0 | |
| cl_radar_square_when_spectating | 1 | not in the settings UI (out of scope 11-17) |
| cl_radar_show_all_players_when_spectating | 1 | not in the settings UI (out of scope 11-17) |

## Dynamic zoom (function 0x180ecf480)

- Selected scale = alternate scale while the alternate-zoom key is active, else cl_radar_scale.
- With cl_radar_scale_dynamic on: target distance = max 2D (x, y) distance from the radar centre position to
  every radar element that is present and drawn (player icons with non-zero alpha, hostages and other item
  arrays, the bomb when it is on the ground and known, one more tracked item position). No level filter.
- Smoothed distance `D` (per radar): first frame D = target. Afterwards with frame time ft:
  - target >= D: D = target immediately (zooming out is instant) and the shrink timer is cleared;
  - target < D: on the first such frame a timer is set to now + 4.0 s; until it expires D holds; then
    D moves toward the target at most 520 world units/s (260 x 2).
- Scale = clamp(halfSize x 0.95 / (D x worldToPixel), 0.25, selected scale): the farthest element sits at
  95 % of the radar radius.
- With dynamic zoom off: scale = selected scale, D and the timer reset.

## Icon scale (function 0x180ebe320, per player icon)

`iconScale = icon_scale_min + (1.25 - icon_scale_min) * clamp(currentRadarScale, 0, 1)` (currentRadarScale =
the dynamic scale when dynamic zoom runs). Default min 0.6: scale 0.25 -> 0.7625, 0.7 -> 1.055, 1 -> 1.25.
The whole PlayerIcons panel is scaled (dot, heading, view frustum, death, ghost, off-map arrow). The ~0.73
marker scale SLUI calibrated from the user's mapScale 0.25 crop is this formula at 0.25 (0.7625).

## Map levels (function 0x180ec8bc0)

On a level change the new level panel gets `Map__Level--Animate-FadeIn` (0 -> 1, 0.25 s) and the old one
`Map__Level--Animate-FadeOut` (1 -> 0, 0.5 s); only the current level stays visible.

## Bomb package (function 0x180ec16b0)

- Child visibility bitmask over [BombPlantedIcon, Medium, Fast, PlantedBomb, DroppedBomb, BombAbove,
  BombBelow, CreateBombPack, DefuserDropped, DefuserPackage]: CreateBombPack always; on the ground also
  DroppedBomb, plus PlantedBomb when planted (so a planted bomb shows both rings); BombAbove / BombBelow
  when the bomb is more than 94 units above / below the local player.
- BombPlantedIcon / Medium / Fast are never set: the 24 px blinking planted icon is unused in CS2.
- CreateBombPack wash: CT (the side without the bomb) always red #ff0000; T: the carrier's slot colour while
  carried, white #ffffff on the ground; a viewer on neither side keeps the default orange #ff9b25; defused
  -> green #00c800.
- Planted and not defused: CreateBombPack gets `PlantedBombAnimateRed` (red img-shadow pulse, 0.65 s), and
  Radar__Round--Border is made visible and gets `RadarBombPlantPulse` (border red, opacity
  0.1/0.6/0.8/0.6/0.1, 0.65 s, infinite); both classes are removed otherwise.

## Unused in CS2

- `#DirectionArrow` is hidden at radar init and never shown again.

## Player icon bits (name table, bit = index)

0 PlayerNumber, 1 PlayerLetter, 2 SpeakingOnMap, 3 SpeakingOffMap, 4 PlayerPing, 5 PlayerPingOffMap,
6 AbovePlayer, 7 BelowPlayer, 8 HostageTransitOnMap, 9-12 CT OnMap/OffMap/Death/Ghost, 13-16 T ..., 17-20
Enemy ..., 21-24 Hostage ..., 25 DirectionalIndicator, 26 Defuser, 27 Selected, 28 ViewFrustrum, 29 Sound.
Which conditions set PlayerNumber / Selected / Speaking is not traced yet (children 11-17-minimap-speaking
and 11-17-minimap-spectate-number).

## Follow-up 2026-11-17 (implementation step 1)

- The bomb package / bombsite position helper (`0x180e9ddc0`) maps world -> radar and clamps to the edge, then
  sets a pure translation (no scale) on the package panel. Only `PlayerIcons` panels get the icon scale. So the
  keycard (CreateBombPack 16x12), the DroppedBomb (110 px) / PlantedBomb (70 px) rings and the BombZone letters
  render at their native Panorama sizes; SLUI's earlier ~0.73 shrink of the pack and rings was an assumption, not CS2.
- Recording `Counter-strike 2 2026.10.05 - 22.45.00.03.mp4` (local only), radar sampled every 3 s from 132 s:
  carried pack in the carrier's slot colour; after the plant the round border turns red and pulses and the pack shows
  red; after the defuse the pack is green and the border returns to the HUD colour; the scoreboard full map is
  square with no border. Rings are too small to read at that sampling.
