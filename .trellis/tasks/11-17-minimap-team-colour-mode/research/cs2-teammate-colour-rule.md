# CS2 teammate colour rule: every consumer (2026-11-17)

Same client.dll build as `archive/2026-11/11-17-minimap-cs2-slui/research/cs2-radar-client-re.md` (disassembly
approved by the user; addresses are a trail for re-checking, not a contract). Panorama from `../cs2ui/panorama`
(extracted 2026-11-16). After PR #117 merges, this section is appended to that shared file (parent PRD rule).

## The predicates

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

## Consumers (callers of 0x18089fd20 and 0x180885450)

| CS2 place | function | rule | when the rule fails |
| --- | --- | --- | --- |
| Radar player icons | `0x180ecd9b0` | fd20 + valid index, written only to the panels of the local effective team (CT panels when local is CT, T when T; T also requires not fading) | no override: `.PI_Color_CT` `#1ed2ff`, `.PI_Color_T` `#ffdd23`, `.PI_Color_Enemy` `#ff1919` |
| Radar icon type | `0x180ebfba0` | CT player -> CT icon (9), T player -> T icon (13), unless an enemy (17) | - (a teammate is never drawn with the other side's icon; there is no "teammates always blue" rule) |
| Radar bomb package | `0x180ec16b0` | default `#ff9b25`; local CT -> red; else fd20 -> carrier's slot colour (white on the ground); defused -> green | stays orange `#ff9b25` |
| Team counter avatars | `0x180ec66e0` | fd20 -> slot colour (index % 5) on the avatar border panels | border wash `#6f9ce6` (CT) / `#eabe54` (T) |
| Team counter player count | `0x180ec9120` | fd20 (with `PlayerCountInsteadOfAvatars`) | - |
| Chat | `0x180ea3620` | fd20 + valid index -> coloured `#CSGO_Competitive_Dot` (+ letter for `== 2`) before the name | no dot, plain name |
| Scoreboard / Panorama `GetPlayerColor` | `0x180faac50` | fd20 + valid index -> `#RRGGBB` | `""`: scoreboard.js hides `player-color` |
| Buy menu teammate pips | `0x180db3790` | **no fd20**: `0x180885500` index >= 0 -> slot colour | wash `0xff787878` (grey `#787878`) over the white `.player-pip.has-item` |

So in casual, on a server for more than 10 players, or for any game type other than classic, CS2 shows no slot
colour anywhere; the radar falls back to the side washes. The buy menu pips only check the mode (the server-assigned
index), not the player limit.

Not decided by RE: the default of `cl_show_enemy_avatar_colors` (its registration at `0x1800add29` sets flag bytes
but the value slot was not decoded). SLUI keeps colouring both teams on the counter and scoreboard, as today.

## SLGO mapping (user decisions 2026-11-17)

- Competitive family = profile id, the scoreboard's existing split (`SidecarScoreboardRules.ModeIcon`): `casual` is
  casual, `competitive` and custom profiles are the competitive family.
- Player limit = 2 x `max_players_per_team` (competitive 10, casual 20). The literal SL `max_players` is not used:
  local competitive servers run 20 slots for spectators, which would turn slot colours off everywhere.
- Side colour = SLGO role colours (the HUD already re-skins CS2's CT / T palettes as SCP / NTF).
