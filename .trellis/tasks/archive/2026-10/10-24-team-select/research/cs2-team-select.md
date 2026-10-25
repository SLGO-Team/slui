# CS2 team select: sources and captures

## Sources (`../cs2ui/panorama`)

- `layout/teamselectmenu.xml`: two half-screen buttons (`BtnSelectTeam-TERRORIST` left, `BtnSelectTeam-CT` right),
  each = round team icon, title (`#terrorists` / `#counter-terrorists`), subtitle `PlayerBotCount`, roster list
  (`List-0` / `List-1`, `Teammate` snippet = avatar + name); top-centre `AutojoinTimer` (Countdown); bottom-right
  action bar `TeamSelectCancel` (cancel.vsvg) / `TeamSelectSpectate` (camera.vsvg) / `TeamSelectAuto` (refresh.vsvg);
  centred `TeamJoinError` (warning icon + label); `TeamSelectFade` black wash.
- `scripts/teamselectmenu.js`:
  - hover highlights a team (scene glow, not reproducible here); click = `jointeam 2|3`, spectate = `jointeam 1`,
    auto = `jointeam 0`; clicking the team you are on only hides the panel.
  - `_ShowPanel`: black fade shown at once, fades out over 0.5 s after 0.5 s.
  - `_OnServerForcingTeamJoin(timeout)`: unassigned (team 0) hides Cancel; with a timeout shows the timer with a
    `timeout`-second radial bar. Escape: unassigned -> game menu, else hide. Keys 1 = T, 2 = CT.
  - `TeamJoinFailed(locString)`: error panel for 5 s.
  - Subtitle `#team_select_bot_player_count` = "{n} 玩家 - {m} 电脑玩家" (bots counted apart; bots get `.bot`).
- `styles/teamselectmenu.css`:
  - Team halves: `team-select-button` 50% x 90%; T gradient `rgba(92,74,33,1)` -> 0 over the top 30% (hover 40%),
    CT `rgba(37,75,105,1)` -> 0 over 30% (hover 40%).
  - `mainmenu-content`: bottom band, `#00000080` below 91.5% of the height, fading to 0 by 90.5%.
  - Icon 100x100 (padding 10 -> 80 px art), margin-top 30, `brightness .5`, hover `1.5` (capture: about 1.7x).
  - Title 50px Stratum2 Bold Condensed uppercase; subtitle 20px bold; `text-shadow` everywhere (SLUI drops it,
    spec rule).
  - List: `flow-children: down-wrap`, max-height 280; teammate 200 px wide, margin 4, opacity .8, hover 1;
    humans `t-color #eabe54` / `ct-color rgb(150,200,250)` with black label; bots `#303030` with white label;
    name 17px, letter-spacing .35px, margin-left 8, box-shadow `#0000005e 0 0 6px`.
  - Timer 60x60, margin-top 40, label 22px bold white; bg ring 2px `#333` at .6; bar ring 8px `#333` revealed by a
    radial clip 0 -> 360 deg over the timeout (wash white at 60%, red at the end, fades out at 98-100%).
  - Error: `rgba(0,0,0,.5)`, padding 16, radius 2, `warningColor #b1af2d` wash, 0.25 s opacity.
  - Fallback mode only: map screenshot with `brightness .7` and `blur gaussian(6,6,3)`.
- `mainmenu.css` `.content-controls-actions-bar`: 96 px high, padding 0 64px, bottom, top border `rgba(255,255,255,.05)`
  (team select sets it to 0). `csgostyles.css` `.PopupButton`: hover `rgba(255,255,255,.05)`, label 24px uppercase
  Stratum2 condensed medium, margin `10px 12px 8px`; image margin-left 8; hover sound `generic_button_rollover`.

## User captures (2000x1125, x0.96 = 1080p CSS px)

Kept outside the repository (public repo: never commit captures). 1 = in game, hover T;
2 = in game, hover CT; 3 = first join, both teams empty, timer "8秒", no Cancel.

| Thing | Capture px | 1080p |
| --- | --- | --- |
| T / CT icon | 80 px, top y 44, centres x 583 / 1417 | 78, y 42 |
| Title "T" | y 158..229 | 152..220 |
| Roster rows | x 479..688 (209 wide), y 249 + 49 n, 43 high | 200 wide, pitch 47, 41 high |
| Own row | `#eabe54` at 1.0 hovered, .8 not | as CSS |
| Bot rows | `#303030`, hovered team more opaque | as CSS |
| Timer | centre x 1000, y 72 | 960, 69 |
| Action bar | icons + labels y 1062..1088, right edge x 1911 | bar 96 high |

Seam tint (capture 3, x 990 vs 1010): y 10 `(101,84,49)` vs `(60,85,110)`, y 150 nearly equal, none from about y 300
(30% of the 90% button) -> only the CSS gradients tint the halves. Bottom band from y about 1030.
