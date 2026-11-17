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

## Selected and PlayerNumber (2026-11-17, child 11-17-minimap-spectate-number)

Same build. Two more local helper scripts (not in the repository): a linear disassembler that skips undecodable
bytes, and a pointer-table dumper.

- Per-icon visibility: `0x180ebe320` (per player icon, icon scale) tail-calls `0x180ec2150`, which builds the bit mask
  over the name table at `0x182236620` and hands it to `0x180ec0ef0` (applies `mask & 0x1fffffff` to the child panels).
  Icon state: `+0x16c` icon type (= table index: 9 CT, 13 T, 17 Enemy, 21 Hostage; +1 OffMap, +2 Death, +3 Ghost),
  `+0x17c` / `+0x17d` flag bytes.
- **Selected (bit 27)**: in the live on-map branch the mask gets bit 27 when flag `+0x17c & 0x08` is set; the death,
  ghost and off-map branches never set it. The player loop `0x180eb88f0` sets that flag on exactly one player:
  the one whose pawn equals `0x180c71d70()`, and only while the local pawn's `IsObserver()` (vtable `+0xac0`; the
  same call precedes `GetObserverMode` / `GetObserverTarget` at `0x18084f0c0` / `0x18084f160` elsewhere) is true.
  `0x180c71d70` is "local or in-eye player": the local pawn while alive, else the observer target when the observer
  mode is 2 (in-eye) or 3 (chase) and the target is a living player; free roam returns null.
  So the box marks the player an observer is following (first or third person); a living player never has one and
  a free camera selects nobody.
- `#Selected` is inside `#PI_FirstRotated`, so it turns with the player's heading; 42x36 at y -10px, centred. Source
  `map_view_selected.vsvg` (79.381x66.417): a white teardrop ring (centre 40.13, 50.90; outer r 15.52, inner r 12.37,
  tip at y 29.68) plus two white radial glows fanning forward (up). The ring centre lands on the dot
  (y -10 + (50.90/66.417 - 0.5) * 36 = -0.4 px). No wash class: it stays white.
- **PlayerNumber (bit 0)**: same live branch, when the icon mode `+0x178` is not 6, either
  (a) the local pawn's controller (handle at pawn `+0x14bc`) passes `0x180898260`: its team byte (`+0x3e7`) is 1
  (Spectator) with a further flag check, or a second flag pair with a global counter <= 0 (looks like the HLTV / full
  view path), or (b) the engine interface `0x18254f4c0` vtable `+0x2b0` returns true (engine-side HLTV / demo check).
  Otherwise the icon may get PlayerLetter (bit 1) instead. So numbers are drawn only for a viewer on the Spectator
  team, GOTV or demo playback, never for a playing (alive or dead) competitive player.
- The label text is set elsewhere (not traced); CS2 shares the PlayerNumber concept with the team counter avatars
  (`hudteamcounter.xml` `#PlayerNumber`), i.e. the spectator slot keys 1-9, 0.
- `.PI_Text`: Stratum2 medium 10px, `#000000FF`, centred (`center_nopixelsnap`), margin-top 1px / margin-right 1px,
  in `#PI_NonRotated` (never rotates), scaled with the rest of `PlayerIcons`.
- The user's local CS2 recordings (10-05 to 10-07) are offline bot sessions played as a
  team member: no numbers on any dot (as expected from the condition above) and no segment spent following a
  teammate, so they neither confirm nor contradict the Selected box.
- **Number assignment** (the user asked to confirm teams larger than five): `0x180eae320` (player -> number, used by
  the name prefix `0x180e7de30` on the `CCSGO_HudTeamCounter` object) and its inverse `0x180eb02a0` (number ->
  player, the spec_player key path) walk one ordered list: the counter's CT array (`+0x160c`, count `+0x1288`, filled
  for team 3 at `0x180ec97b5`) followed by its T array (`+0x128c`, count `+0x1284`, team 2); a non-team mode
  (`+0x127c == 1`) uses one sorted list instead. A player at list position `i` gets `(i + 1) % 10` while `i <= 9`,
  else no number. So numbering is contiguous across the two teams, CT first: 5v5 gives CT 1-5 and T 6-9, 0; with
  six CTs the sixth CT is 6 and T starts at 7; the eleventh player and later have none. Each team list holds at
  most 16 entries. The radar label's own SetText was not located; that it shows this same number is inferred from
  the shared PlayerNumber concept (team counter avatars, spec_player keys).
- Off-map quirk: the live branch builds the extras (number, speaking, selected) and, for an off-map icon, doubles the
  whole mask (`add ebx, ebx` at `0x180ec24f4`), which turns OnMap into OffMap but also moves PlayerNumber to
  PlayerLetter and Selected to ViewFrustrum. Neither the number nor the selection box is drawn on an edge arrow.

## Dot colours and the number label (2026-11-17, follow-up to the PR review)

- `0x180ecd9b0` (called per player from the radar player loop) decides both. It first tests "number mode": the local
  controller passes `0x180898260` (Spectator team / full view) or the engine's HLTV-demo check. In number mode it
  writes the `#PlayerNumber` text = team-counter position + 1 (position 9 -> 0, via `0x180eae260`) and hides the
  label when the server's player limit (`0x180758180`, max clients capped at 24) is above 10; it never touches the
  dot colour.
- Otherwise, every 0.5 s, for a CT icon (team 3) or T icon (team 2) it asks `0x18089fd20(localTeam, playerTeam)`:
  `cl_teammate_colors_show != 0` (help: "In competitive, 1 = show teammates as separate colors in the radar,
  scoreboard, etc., 2 = show colors and letters"), the player on team 2/3, player limit <= 10, (same team, or local
  Spectator, or `cl_show_enemy_avatar_colors`), and `0x180764600` = game type classic with a competitive-family mode
  (casual and deathmatch excluded). If it holds and the player's `m_iCompTeammateColor` index is valid, the colour is
  written to the CT OnMap / OffMap / Death panels only when the local effective team (`0x180885100`: the coached team
  for a coach) is CT, and to the T ones only when it is T (the T path also requires the icon not fading). So only
  teammates of a playing member get slot colours.
- Everything else keeps the Panorama washes: `.PI_Color_CT` `#1ed2ff`, `.PI_Color_T` `#ffdd23`, `.PI_Color_Enemy`
  `#ff1919`. Opponents use the Enemy icon unless the viewer sees everything (observer), who gets CT/T icons in side
  colours with black numbers.
- `cl_teammate_colors_show == 2` (`0x18089fd10`) shows PlayerLetter text (B/G/Y/O/P by colour index) instead.

## CS2 teammate colour rule: every consumer (2026-11-17) (task 11-17-minimap-team-colour-mode)

Same client.dll build as `archive/2026-11/11-17-minimap-cs2-slui/research/cs2-radar-client-re.md` (disassembly
approved by the user; addresses are a trail for re-checking, not a contract). Panorama from `../cs2ui/panorama`
(extracted 2026-11-16). Appended here from the task's research file (parent PRD rule).

### The predicates

- `0x18089fd20(localTeam, playerTeam)` ("show this player's teammate colour"): `cl_teammate_colors_show != 0`
  (`0x18251c668`, default 1; help "In competitive, 1 = show teammates as separate colors in the radar, scoreboard,
  etc., 2 = show colors and letters"), player team 2 or 3, player limit `0x180758180() <= 10`, (same team, or local
  team 1 = Spectator, or `cl_show_enemy_avatar_colors` `0x18251c678`), and `0x180764600()`.
- `0x180764600` (competitive family): `game_type == 0` (classic) and `game_mode` in {1, 2, 3, 4, 6}. Casual
  (`game_mode` 0) and every other game type (deathmatch, arms race, ...) fail. Hard-coded: there is no server
  setting for teammate colours besides the mode.
- `0x180758180` (player limit): 0 while the engine reports HLTV / demo, else `min(maxClients, 24)` (the server's
  slot count; official competitive servers have 10).
- `0x180885500` (a controller's `m_iCompTeammateColor`, +0x858): returns -1 unless `0x180764600()`. The index
  itself is assigned by the server (server.dll, not traced).
- `0x180885450(index)`: index -> colour from `cl_teammate_color_1..5`; -1 / invalid -> grey.

### Consumers (callers of 0x18089fd20 and 0x180885450)

| CS2 place | function | rule | when the rule fails |
| --- | --- | --- | --- |
| Radar player icons | `0x180ecd9b0` | fd20 + valid index, written only to the panels of the local effective team (CT panels when local is CT, T when T; T also requires not fading) | no override: `.PI_Color_CT` `#1ed2ff`, `.PI_Color_T` `#ffdd23`, `.PI_Color_Enemy` `#ff1919` |
| Radar icon type | `0x180ebfba0` | CT player -> CT icon (9), T player -> T icon (13), unless an enemy (17) | - (a teammate is never drawn with the other side's icon; there is no "teammates always blue" rule) |
| Radar bomb package | `0x180ec16b0` | default `#ff9b25`; local CT -> red; else fd20 -> carrier's slot colour (white on the ground); defused -> green | stays orange `#ff9b25` |
| Team counter avatars | `0x180ec66e0` | fd20 -> slot colour (index % 5) on the `colorize-teammate-color` panels, and `#PlayerColor` (3px white border) parented to `#Visible` | `#PlayerColor` parented to `#Invisible` (hidden); the avatar keeps its `bordertype` class: 2px `color-CT` `#b5d4ee` / `color-T` `#ead18a`, 2.5px white for the alive local player (see below) |
| Team counter player count | `0x180ec9120` | fd20 (with `PlayerCountInsteadOfAvatars`) | - |
| Chat | `0x180ea3620` | fd20 + valid index -> coloured `#CSGO_Competitive_Dot` (+ letter for `== 2`) before the name | no dot, plain name |
| Scoreboard / Panorama `GetPlayerColor` | `0x180faac50` | fd20 + valid index -> `#RRGGBB` | `""`: scoreboard.js hides `player-color` |
| Buy menu teammate pips | `0x180db3790` | **no fd20**: `0x180885500` index >= 0 -> slot colour | wash `0xff787878` (grey `#787878`) over the white `.player-pip.has-item` |

So in casual, on a server for more than 10 players, or for any game type other than classic, CS2 shows no slot
colour anywhere; the radar falls back to the side washes. The buy menu pips only check the mode (the server-assigned
index), not the player limit.

#### Team counter avatar fallback (verified 2026-11-17)

- `0x180eb20b0` (avatar entry init, entry = `[counter + 0xf0] + i * 0xe0`): `#Visible` -> entry `+0x18`, `#Invisible` ->
  `+0x20`, `#PlayerColor` -> `+0x70`, `#AvatarL__ImageBG` -> `+0x88`, and `FindChildrenWithClassTraverse
  ("colorize-teammate-color")` -> the list at `+0xc8` / `+0xd0`. In `hudteamcounter.xml` that class is on exactly two
  avatar panels: `.AvatarL_BG` (opacity 0 unless `Avatar__SpectateTarget`) and `#PlayerColor` (`.avatar-team-color`,
  `border: 3px solid white`).
- `0x180ec66e0`: rule passes -> wash both with the slot colour and set `applied`; rule fails -> wash both with
  `#6f9ce6` / `#eabe54` (bit 0 of the entry flags). Then `0x180ebded0(entry, #PlayerColor, applied)` re-parents
  `#PlayerColor` to `#Visible` when applied, else to `#Invisible` (`visibility: collapse`). So the side wash lands on a
  hidden border and on the spectate-target background only; **no slot or side-coloured 3px border is drawn**.
- What stays visible is `#AvatarL__ImageBG`'s `bordertype` class (set every update, independent of the rule):
  `Avatar__PlayerBorder--CT` / `--T` (`border: 2px solid color-CT` `#b5d4ee` / `color-T` `#ead18a`, both pale) unless
  the player is alive and flag bit 1 (the entry whose side is cached as the local side) or bit 6 is set, which gives
  `Avatar__PlayerOutline--White` (2.5px white). Dead players get `.dead .Avatar__PlayerBorder--*` 2px black (SLUI
  already has this). This matches the user's memory of near-white casual avatars. Bit 6 was not identified.

Not decided by RE: the default of `cl_show_enemy_avatar_colors` (its registration at `0x1800add29` sets flag bytes
but the value slot was not decoded). SLUI keeps colouring both teams on the counter and scoreboard, as today.

### SLGO mapping (user decisions 2026-11-17)

- Competitive family = profile id, the scoreboard's existing split (`SidecarScoreboardRules.ModeIcon`): `casual` is
  casual, `competitive` and custom profiles are the competitive family.
- Player limit = 2 x `max_players_per_team` (competitive 10, casual 20). The literal SL `max_players` is not used:
  local competitive servers run 20 slots for spectators, which would turn slot colours off everywhere.
- Side colour = SLGO role colours (the HUD already re-skins CS2's CT / T palettes as SCP / NTF).
