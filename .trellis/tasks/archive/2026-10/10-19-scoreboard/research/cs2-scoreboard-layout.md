# CS2 scoreboard layout (measured)

Sources: the user's three CS2 competitive screenshots of 2026-10-19 (page 1 passive, page 2 cursor mode, page 2
passive; kept locally, never committed) and `../cs2ui/panorama` `layout/scoreboard.xml`,
`styles/scoreboard.css`, `scripts/scoreboard.js`, `scripts/common/gamerules_constants.js`. The captures are
1924x1127 windows: the 1920x1080 game area starts at (2, 45). Every coordinate below is a game coordinate at
1920x1080 (Panorama units); "x a..b" is inclusive. Panorama widths were checked against the captures and agree to
+-2px unless a deviation is noted; where they disagree the capture wins.

## Panel (`.sb-main`)

- Box 960 x 584 at x 480..1439, y 278..861 (5v5 competitive with timeline). Horizontally centred; vertically
  centred plus Panorama `y: 30px` (centre y 570). Height is `fit-children`, so it grows with rows (casual 10v10)
  and stays centred at y 570; Panorama animates width/height over 1 s ease-in-out (only visible when the layout
  changes while shown).
- Padding 20 top / left / right, none at the bottom. Content box x 500..1419 (920 wide), from y 298.
- Radius 5px. Fill: Panorama `rgba(0,0,0,0.88)` plus a 1.5 % dot texture on the world blur; the captures read
  ~0.6 black over the blurred world (inside/outside luminance ratio 0.37-0.40 at the top and bottom edges). The
  overlay cannot blur (spec section 11), so use a denser fill, starting at `rgba(0,0,0,0.7)`, tuned in the audit.
  The dot texture is not recreated.
- Show / hide: no motion source yet; show and hide at once (CS2's scoreboard pops in on key press).

## Vertical stack (5 rows per team, competitive)

| Part | y range | Notes |
| --- | --- | --- |
| Meta row 1 (mode, time) | 298..335 | padding 4/4, 1px divider `#80808030` at y 335, width 860 (x 500..1359) |
| Meta row 2 (buttons) | 336..372 | `.sb-meta` is 75 high, so row 2 clips at y 372 |
| Labels row | 373..398 | cells 24 high at y 374..397 (margins 1/1) |
| Top team (NTF) | 399..532 | rows y 400..423, 426..449, ... 504..527; info column 133 high |
| Timeline | 534..636 | margins 2/2; height 103 (half-time scores column) |
| Bottom team (SCP) | 640..772 | rows y 641..664 ... 745..768 |
| Spectator block | 773..812 | empty in SLGO (padding-top 20 + table margin-bottom 20) |
| Footer | 813..861 | 48 high, mouse hint |

- Row pitch 26: `.sb-row` margins 1/1 around 24px cells. A team block is `max(rows x 26, 133)` high: the info
  column (80 emblem + two 20px labels) is taller than 5 rows (130). Players tables have `min-height: 120px` and
  `max-height: 270px` (10 rows = 260 fit).
- No-timeline template (CS2 casual): the timeline is replaced by an empty `.sb-timeline` (min-height 20, margins
  2/2 = 24).

## Columns (rows and labels)

Team block = info column (80 wide, `margin-right: 10px`) at x 500..579, then the table at x 590..1419. A row is
830 wide: `.highlight-row` 770 (x 590..1359) plus report/commend buttons (cursor mode only, real players only;
not recreated). The labels row uses the same cells; the 80 + 10 spacer sits left of it.

| Cell | Width | x (page 1) | x (page 2) | Content |
| --- | --- | --- | --- | --- |
| status | 24 | 590..613 | same | 20x20 image (padding 2): dead X (`#999`-washed team colour) |
| ping | 37 | 614..650 | same | bot icon 16 high centred, or ping `#888` 18px; label = signal-bars icon |
| flair | 32.4 | 651..682 | same | empty in SLGO (keep the gap) |
| avatar | 24 | 683..706 | same | 24x24 avatar framed in the player colour |
| name | fill | 707..1029 | 707..1059 | padding 0 6px (text from x 713), 18px, ellipsis |
| set | 280 / 250 | 1030..1309 | 1060..1309 | right-aligned against damage; the name absorbs the difference |
| damage | 50 | 1310..1359 | same | always shown |

- Page 1 set: money 66 (right-aligned, text right edge ~x 1090), kills 50 (centre 1121), deaths 50 (1171),
  assists 50 (1221), HS% 64 (1278).
- Page 2 set: MVPs 50 (centre 1085), utility damage 50 (1135), enemies flashed 50 (1185), KDR 50 (1235), ADR 50
  (1285). Labels in capture: 金钱 杀敌数 死亡数 助攻数 爆% 伤害 / MVP次数 (shown "MVP次…", ellipsis in 50px) 道具 致盲
  KDR 伤/局 伤害.
- Cell labels 18px with 6px side margins, centred (money right-aligned). Label-row text: Stratum2 Condensed 18px,
  `margin-top: 5px`, ellipsis.
- Cell fills: name/status/ping/flair/avatar `#ffffff05`, stat cells `#ffffff08`, the sorted column's cells
  `#ffffff10` and its label `brightness: 2`. Label-row cells have no fill. Dead and disconnected rows drop every
  cell fill (transparent).
- Hover (cursor mode): `.highlight-row:hover` adds `rgba(200,200,200,0.05)`. Hovering a row pauses re-sorting.

## Colours (capture peaks; Panorama defines)

- Team tint (names, stats, emblem digit, bot icon, half-time scores, timeline icons and ticks): CS2 CT `#B5D4EE`
  (capture peak 200,214,228), T `#EAD18A` (capture 223,212,180). SLGO maps them to `ROLE_COLORS` (NTF
  `rgb(150,200,250)`, SCP `#d94652`), as the bottom HUD and shop do.
- Labels row and phase labels: ~`#cccccc` (capture peak 210). Mode label and time: grey `#808080` (capture
  ~136). Team side name: team tint; "存活：n/5" the team tint at 0.2 (capture 106,110,118 for CT).
- Dead row: `wash-color: #999` on the whole row (team tint x 0.6: capture name 132,130,117 vs 222,216,186 alive).
- Disconnected row: labels `#ccc`, images washed `#999`.
- Local row: Panorama says team colour at 0.07, but the capture reads far stronger: T row fill 93,86,59 against
  ~50,52,50 on other rows, about the team colour at 0.2. Use the capture (team tint, ~0.2) and tune in the audit.
- Ping text `#888`. Footer hint: Panorama `#ffffff20`, capture peak ~105 on ~20 (12px bold); match the capture.

## Header (meta)

- Row 1: mode icon 24x24 at x 506..529 (margins 0 18 0 6), y 302..325 (vertical-align top); in the capture a
  coloured mode logo. Mode label at x 540 (`position: 40px`), Stratum2 regular condensed bold 22px grey, ink
  around y 307..328 (CJK). Elapsed time right-aligned at x 1359 (row width 860), Stratum2 Mono 18px grey
  ("9:51", `m:ss`).
- Row 2: server line (not drawn, D6). Cursor-mode buttons at the right end of the 860 row: 26 wide, 10 apart,
  x 1334..1359 (stats), 1298..1323, 1262..1287; top y 350 (`margin-top: 10px`), visible to y 368 (19 high,
  clipped by the 75px meta). Fill `#80808080`, icon 20x20 washed `#cccccc`; hover `brightness: 2`; active state
  `rgba(250,250,250,0.2)`. SLGO: stats rightmost, side swap left of it (D5); voice and block-UGC are not drawn.
- Buttons and footer hint switch by `.mouse-active` (opacity 0/1, no transition).

## Team info column (`.sb-team__info`)

- 80 wide at x 500..579. Emblem panel 80x80 at the team block top (y 399..478 top team); team-logo disc
  centred: CT a dark disc with a thin light ring and a dim CT logo, T a dim gold disc with a dark T logo. Score
  digit Stratum2 bold mono 70px bolder in the team tint, centred (CT "1" ink about x 525..557, y 410..466).
  Panorama's text shadow is not applied (spec section 3).
- Side name 20px regular condensed, team tint, centre x 540, centre y ~492 ("CT"); "存活：5/5" 20px at 0.2
  opacity, centre y ~520. SLGO: side name NTF / SCP.

## Timeline (`.sb-timeline`, competitive template only)

Flow right at y 534..636:

- Half-time scores 80 wide (x 500..579): two 40-wide columns (centres x 520 and 560) for 前半场 / 后半场, each
  `flow-children: down`: top-team score (20px condensed, 24 high, team tint, centre y 546), phase label (18px
  condensed `#ccc`, wraps to two lines "前半" / "场" in 40px, margins 4/4, centre y ~575 and ~598), bottom-team
  score (centre y 625).
- Rounds area 650 wide (x 580..1229): segments centred in it, `padding-left: 10px`; a round is 20 wide; first
  half rounds 1..12 at x 659..898, divider 2px (gray 0.1, 50 % high) with 10px margins at x 909..910, second half
  13..24 at x 921..1160. Round n centre: 669 + 20 (n - 1) in the first half, 931 + 20 (n - 13) in the second.
- Round column, flow down: top-team result (min-height 49, bottom-aligned), tick 2px high at y 584..585 and
  90 % wide (18px), bottom-team result (min-height 49, top-aligned). Tick label (14px condensed, opacity 0.6) on
  every fifth round, centred on the tick.
- Tick colour: winner's team tint for played rounds (`wash-color`, opacity 0.2 -> 1 with `.hilite` for rounds
  <= played + 1, i.e. the current round's tick is white-ish), `#ffffff40` at 0.2 for future rounds.
- Result icon 20x20 box (padding 3, margins 2), opacity 0.4, team tint; a won round adds `--active`: a 4px
  padding toward the tick and a gradient `#ffffff22` -> 0 away from the tick. Capture: CT icon y 562..581,
  T icons y 588..607. CS2 icons: kill (elimination), timer (time), bomb (target bombed), defuser (defused),
  trophy (clinch).
- Clinch: for the first future round where a team would reach the win score (`played + needed - score`), a
  trophy in that team's slot (only the earlier of the two, both on a tie); later rounds get `past-clinch`
  (opacity 0.1). Capture page 1 (CT 1, T 3, 4 played, 13 to win): T trophy at round 14 bottom, rounds 15+ faded.
- Loss bonus 68 wide, centred in the space right of the rounds area (x 1230..1419 -> x 1291..1358): CT pips
  (`padding-top: 10px`, bottom 2), label 战败补偿 (18px condensed `#ccc`, margins 4/4), T pips (top 2, bottom 10).
  Pips 14x2 with 1px right margin (four = 60 wide); lit = team tint, unlit black at 0.6. Capture: label ink x
  1295..1355, CT pips y ~568, T pips y ~597.

## Footer

- 48 high (y 813..861). Hint `[MOUSE2] 启用光标` 12px bold, right-aligned with a 10px margin (ink x 1321..1407,
  y 833..842); passive mode only.

## Fonts

| Use | Panorama | Size |
| --- | --- | --- |
| Names | `stratum-medium` | 18 |
| Stat cells, ping | `stratum-regular-mono` | 18 (MVP count 10) |
| Label row, phase, loss-bonus label, tick labels | Stratum2 Condensed | 18 (ticks 14) |
| Mode label | regular condensed bold | 22 |
| Time | Stratum2 Mono | 18 |
| Team score | bold mono, bolder | 70 |
| Side name, alive | regular condensed | 20 |
| Half-time score | Stratum2 Condensed | 20 |
| Footer hint | `stratum-bold` | 12 |

CJK falls back to the bundled Noto Sans SC at 0.9 (spec section 9).

## Motion (Panorama; no recording)

- Row reorder: `position, opacity` 0.25 s ease-in-out. Set switch: opacity 0.1 s. Cell brightness/wash 0.25 s
  ease-out. Stat change pulse: brightness 1 -> 3 (5 %) -> 1 over 1 s.
- Not recreated without a recording: the panel's own show/hide (none observed), the stat pulse (needs live
  changes while open; optional later).

## Template choice (CS2)

- `competitive` / `premier` / `scrimcomp2v2`: with timeline and half-time scores.
- `casual`: no timeline (spacer), so no half-time scores and no loss-bonus pips. Its row snippet orders page 1 as
  money / K / D / A / MVPs, page 2 as HS% / KDR / ADR / utility / flashed, and ends with score; SLGO keeps the
  competitive columns in every mode (no score stat).
