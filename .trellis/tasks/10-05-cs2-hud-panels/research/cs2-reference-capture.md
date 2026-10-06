# CS2 reference screenshot capture

Decision (user, 2026-10-05): capture 1920x1080 CS2 reference screenshots with a
local offline-server script instead of manual play. Screenshots stay on the
local machine and are never committed (public-repo rule); this file records
the method and, later, text-only findings per state.

## Method

- Script: `<CS2>/game/csgo/cfg/slui_ref.cfg` (outside this repo; deleted after use).
- Commands verified present in the local CS2 build (client/server/engine2
  binaries, 2026-10-05): `png_screenshot [filename]`, `endround`, `bot_place`,
  `bot_kill <all> <t|ct> ...`, `mp_pause_match`, `timeout_terrorist_start`,
  `mp_plant_c4_anywhere`, `mp_ignore_round_win_conditions`,
  `mp_respawn_on_death_ct`, `item_defuser`.
- `png_screenshot` (and F8 bound to it) produces no file and no console output
  in the release client (likely development-only). Capture uses the Steam
  overlay screenshot (F12) instead, taken in table order; files land in the
  Steam userdata `760/remote/730/screenshots` folder as JPG and are mapped to
  states by timestamp order. Only F9 (`bot_place`) stays bound; `ref_done`
  unbinds it.
- `panorama_dispatch_event` exists but the win panel title/MVP are filled by
  C++ from game events, so it cannot stage complete panels.

## States

| Order name | Panel / state |
|---|---|
| `slui_win_mvp3` | Win panel, own team won, most-kills MVP (3 kills of 4) |
| `slui_win_ace` | Win panel, own team won, ace MVP |
| `slui_win_lost` | Win panel, own team lost |
| `slui_win_spectator` | Win panel, spectator, team-win title |
| ~~`slui_win_draw`~~ | Skipped: `endround` restarts the round with no win panel. SLGO never draws a round (`RoundResultModelBuilder.ForRound` always has a winner); a draw only exists at match end (`ForMatch` with no winner), and the CS2 win-panel CSS has no draw-specific style, so the draw panel is derived without a capture |
| `slui_win_match` | Match-end win panel |
| `slui_alert_warmup` | Alert: warmup countdown |
| `slui_alert_matchpoint` | Alert: match point |
| `slui_alert_final` | Alert: final round |
| `slui_alert_pause` | Alert: match paused |
| `slui_alert_timeout` | Alert: team timeout countdown |
| `slui_hint_high` | High-priority hint (C4 plant outside site) |
| `slui_hint_low` | Low-priority hint (weapon dropped) |
| `slui_progress_plant` | Progress bar: planting |
| `slui_progress_defuse` | Progress bar: defusing without kit |
| `slui_progress_defuse_kit` | Progress bar: defusing with kit |

## Findings

### Capture set (2026-10-05)

20 Steam screenshots at 1920x1080 (plus one discarded 1600x1024 trial),
mapped to states by content, not by order. Captured: win T + most-kills MVP,
win T + ace MVP, win CT + ace MVP (blue variant after all), lost (no MVP),
win without MVP (x2, the spectator scene did not switch to spectator),
match-starting countdown, match point, alert flash frame, final round,
paused (with and without a high hint), team timeout (with and without a high
hint), two low hints, planting (no progress bar), bomb-planted high hint,
defuse with kit, defuse without kit, CS2 end-of-match screen.
Not captured: spectator title, warmup countdown, match-end win panel (the
capture landed on the separate end-of-match screen). Coordinates below are
1080p screen pixels read from the captures (approximate, +-3 px); measure
exactly during implementation.

### Win panel

- Panel sits top-centre just under the team counter: title box with side
  bars, `»` / `«` chevrons, title 「回合胜利」 in large spaced letters on a
  translucent fill.
- **All gold/olive in this capture is the T side colour, not a neutral panel
  colour** (user correction 2026-10-05): title, bars, chevrons, fill, MVP label
  chip and the checker background all follow the winning side (CS2
  `--Win--T` / `--Win--CT`; CT fill `rgba(9,40,61,.85)`, T fill
  `rgba(66,46,8,.85)`), and the title turns `negativeColor` red when the
  viewer's team lost. SLUI must parametrise every one of these by side. Decided (user
  2026-10-05): SLGO team colours replace the CS2 side colours, so no CT-side
  capture is needed (a CT-side scene could not switch teams anyway).
- Directly under the title, inside the same box, a small white fun-fact line:
  「AceTaffy 击杀 3 名对手。」. CS2 shows a fun fact here; the plugin currently
  puts the end-reason line in this slot as a placeholder.
- MVP strip below the title box, wider than it, with an animated
  pixel/checker background in the side colour (`hudwinpanel_background_map.js`): square
  Steam avatar on the left; to its right a side-coloured label chip
  「最多击杀MVP（3杀）」, the player name on its own line in large condensed
  white text, and a small music-kit row: kit icon + 「完美世界 - 花脸♪」.
- Matches the plugin model: 3 kills of 4 enemies → "most kills (3)", not ace;
  2 of 2 → 「回合王牌MVP」.
- Geometry: title box ≈ x 760-1160 (400 wide), y 190-270; MVP strip
  ≈ x 650-1250, y 287-375, fading out at both ends; avatar ≈ 72 px square.
- Fun-fact line varies per round (「AceTaffy 在本回合通过爆头击杀了 3 名敌人。」,
  「T在 4 秒内消灭了CT。」, 「CT获得胜利并且无一阵亡。」).
- CT win: same layout, blue fill/bars/chips and blue checker strip.
- Lost: title, bars and chevrons turn red, fill turns neutral dark grey; no
  MVP strip when the viewer's team has no MVP. (The card below it in that
  capture is CS2's separate death panel, out of scope.)
- Win with no MVP (no player kills): title box only, no MVP strip.

### Bottom-centre message zone

All boxes ≈ x 810-1110 (300 wide), dark translucent fill, centred white text.
- Alert (`CSGOHudAlerts`) ≈ y 750-790, thin gold left/right bars, 18 px text:
  「将在 2后开始比赛...」, 「赛点」, 「最终局」, 「比赛已暂停」,
  「T 队暂停还剩 0:58」 (countdown in the text). A new alert flashes: one
  capture shows the whole box solid white mid-flash.
- High hint ≈ y 803-860, red left bar, taller box, one or two lines:
  「比赛将在静止时间期间被设置为暂停。」, 「炸弹已被安放。/离引爆还剩 120 秒。」.
  No warning icon visible in these captures.
- Low hint ≈ y 868-907, gold left/right bars like the alert:
  「你捡起了炸弹。」, 「您已扔掉 AK-47」, 「C4 必须被安放在爆破区域。」 (the C4
  restriction is a low hint, not a high one).
- Alert + high hint, and alert + low hint, are visible together (4-slot model
  confirmed).

### Progress card

- Planting shows **no** progress card in CS2 (only the C4 viewmodel).
- Defusing: card ≈ x 710-1210 (500 wide), y 630-750, bright bars on both
  sides; left a ~95 px ring with the icon inside (wire cutters with kit, C4
  icon without kit), right a title line (「你正在拆除炸弹。」 /
  「你在没有拆弹器的情况下拆除炸弹。」) and a `00:02.765` style timer
  (mm:ss.mmm) under it.
- The yellow card colour is not a team colour: `hudprogressbar.css` animates
  the ring and background wash red → yellow → green over the progress
  (`circle-full-to-empty`), so mid-progress captures are yellow. The icon pulses
  in `color-CT` (kit) or `color-icon-bomb` `#ffb136` (no kit).

### Win panel: SLUI render vs captures (2026-10-05)

Measured on headless-Chrome renders of the mock scenes (`hudSceneAt=2000`,
no theme pack, so Stratum2 falls back to Barlow / Saira) against the T-win
most-kills capture, 1920x1080:

- Exact (+-0 px): title box 760-1160 / 190-270, CJK title glyph columns
  871-904 / 918-953 / 965-1001 / 1013-1048 and rows 206-241, chevrons
  776-789 and 1130-1143, subtitle ink rows 255-264, MVP strip top 286,
  avatar 770-842 / 295-367 (with a kit row), chip rows 294-314, name cap top
  322, kit ink rows 356-365. 1600x900 scales uniformly.
- Deviations: Panorama places the title 2 px lower and the subtitle 2 px
  higher than the captures show; SLUI follows the captures. The Panorama
  `brightness` 1.5 / 1.3 on the MVP name and kit text is not visible in the
  captures (the CT name is the plain side colour) and is not applied. The chip
  is wider with the fallback fonts than with Stratum2 (text width only). The
  title-box fill is a translucent tinted grey read from the captures, not
  CS2's near-opaque `winPanelBgColorT/CT`. The 3D MVP banner scene is replaced
  by a SLUI-drawn checker canvas and the glitch video by a SLUI-drawn glitch
  sprite, both animated as measured below; the music-kit artwork overlapping
  the avatar is dropped (no SLGO equivalent) and the trailing note glyph is a
  SLUI icon.
- Motion: see "Win panel motion (recording)" below (superseded the earlier
  guessed root fade, chevron slide and checker twinkle).

### Win panel motion (recording)

Source: a local 1920x1080 in-game recording (2026-10-05; never committed),
stepped frame by frame. The file is variable frame rate with a 240 fps time
base but ~60 rendered frames per second, so timings are +-17 ms. Three panels:
T win with most-kills MVP and music kit (console partly over it), a second
T win with MVP (clean, the main reference), and a lost panel without MVP.
Times are from the first frame of the title box (t = 0).

Entrance (win and lost identical, colours aside):

- 0-230 ms: title box opens from its centre, full height. Width (of 400):
  14, 36, 62, 94, 132, 169, 211, 246, 286, 318, 346, 376, 394, 400 per frame,
  fits `cubic-bezier(0.3, 0.1, 0.7, 1)`. The side bars show in the accent; the
  inside is white over a box fading in (white alpha vs. scene 0.03, 0.14, 0.27,
  0.37, 0.49, 0.58, 0.68, 0.75, 0.82, 0.87, 0.92, 0.96, 0.98, 1; fits
  `cubic-bezier(0.2, 0.1, 0.4, 0.9)`).
- 230-245 ms fully white; the white then clears slowly (to ~85 % by 345 ms)
  and fast after (gone by ~410 ms). The title glyphs are at their final size
  and place under the white (no scale-in).
- 320-650 ms: glitch over the title box, a 30 fps clip (each image held for two
  frames): full-height and partial vertical bars 3-35 px wide, rounded
  horizontal pills, speckles on the right, the first image mostly a pale wash
  of horizontal streaks; the last ~2 images fade (gone by ~660 ms). Colour: a
  light tint of the accent (pale gold on a T win, salmon on a loss).
- 560-730 ms: both chevrons slide inwards from 19 px outside their rest
  position, i.e. they emerge from behind the side bars (clipped at the bar),
  right edge 771, 773, 776, 778, 780, 783, 785, 787, 789, 790 px for the left
  one. They start at brightness ~1.5 (T gold reads (255, 254, 193)), hold it
  until ~70 % of the slide and settle to (240, 198, 130) by 730 ms.
- 990-1220 ms: subtitle fades in (linear), together with the MVP strip.
- MVP strip (990 ms; 0.94-0.99 s in the two win panels): opens from its
  centre as a solid white bar, full strip height, its faded ends scaling with
  it. Width per frame 4, 24, 55, 97, 150, 205, 260, 324, 387, 454, 506, 545,
  584, 609, 621: 240 ms, fits `cubic-bezier(0.4, 0.2, 0.7, 1)`. White holds
  ~30 ms, then clears over ~170 ms (ease-in, 1260-1430 ms); avatar, texts and
  checker are already in place under it.

Checker idle (both win panels, ~8.5 s each, per-square luminance series):

- Grid: 17 px squares, 19.32 px pitch on both axes; 5 rows, the middle row
  centred on the strip (rows at y 286-300 cut, 303-319, 322-338, 341-358,
  361-375 cut); a column gap near the strip's vertical centre line.
- A lighting wave climbs the rows: each row starts lighting 468 ms after the
  row below, the top row is followed by the bottom row again, so every square
  gets a pass every 2.34 s. The phase is locked to the strip entrance (both
  panels agree within ~70 ms): the bottom row starts at 1.885 s after the
  strip opens (mod 2.34 s). Within a row the onset lags 6.8 ms per column left
  to right (~0.2 s across), plus random jitter of ~+-0.1 s per square.
- Per pass a square lights with ~60 % probability; which squares light is
  random per pass (correlation between the two panels 0.25). Lit levels vary:
  ~30 % of the lit passes are about half brightness.
- Envelope of one pass (median of 95 events, normalised): rise over ~350 ms,
  hold to 1.0 s (0.95-0.98), linear fade to 0 by 1.95 s, dark until the next
  pass.
- Colours (T win): strip base / dark square (50, 37, 6); a fully lit square in
  the middle (102, 78, 24) = base + 0.26 x (accent - base); squares more than
  ~195 px from the strip centre light up to ~1.65x brighter (luminance
  amplitude ~27 in the middle, ~45 near the ends). Unlit squares are just the
  base (after the checker stops the strip is a flat (50, 37, 6)).
- The checker disappears in one frame 9.0 s after the strip entrance
  (8.98 s and 9.03 s), leaving the plain strip; the panel itself stays.

Exit (the round-start reset; win at 92.86 s and lost at 117.2 s):

- Frame 1: the title box turns solid white (title, chevrons hidden), then
  collapses to its centre: width 400, 344, 316, 279, 245, 200, 165, 128, 86,
  56 (win) / 388, 358, 330, 298, 258, 224, 185, 150, 113, 70, 44 (lost) per
  frame, i.e. ~0.17-0.2 s, near linear, the white thinning to a translucent
  light grey; the side bars stay on its edges.
- MVP strip: frame 1 the band widens to ~1.85x (about 1170-1200 px, faded ends
  scaled with it) and shows a fully lit random checker again; the avatar and
  texts are not stretched and fade out within ~4 frames; a white wash rises
  over the band (~0.6 by 70 ms, ~0.9 by 150 ms); from ~70 ms the band
  collapses to its centre, width ~1110, 910, 750, 580, 410, 265, 163, 56, 7,
  gone by ~230 ms.

SLUI implementation (`WinPanel.css`, `checker.ts`) uses these numbers
directly; remaining differences: the glitch images are procedurally drawn
(not CS2's clip), the checker squares are flat (no faint darker gap lines or
corner ticks between lit squares), and the exit is driven by the plugin's
hold time ending instead of the round-start event.

### Message zone motion (recording)

Same local recording, stepped at 60 fps (+-17 ms). Events: 「比赛开始」 alert
(enter ~127.2 s, exit ~130.6 s; again ~190 s), 「赛点」 alert (~167.6-171.6 s,
FlashAnim), low hints (「您已扔掉 AK-47」 ~162 s, a run of replacements
~178-184 s, exit ~184.75 s), two-line high hint 「炸弹已被安放。/离引爆还剩
120 秒。」 (~193.5 s). t = first frame of the box.

Geometry and colour (stills): every box x 810-1109; alert y 750-789, low hint
868-907, two-line high hint 802-861; CJK ink rows 763-776 (alert), 881-894
(low), 815-827 / 836-848 (two lines, 21 px pitch); Latin caps share the CJK
ink centre. Bars 2 px at x 810-811 / 1108-1109: low hint (236, 189, 87)
opaque; alert bars blend to the gold at ~0.5 over both bright and dark scenes;
high hint (255, 23, 0). Fill: scene behind the alert / low hint keeps 0.87-1.03
of its brightness and dark scenes get lighter (fits grey ~65 at ~0.33); the
high hint scene drops to 0.48.

Enter (alert and both hints alike):

- 0-233 ms: box opens from its centre, full height, width per frame 4, 16,
  32, 54, 82, 106, 138, 166, 196, 224, 244, 270, 286, 296, 300; fits
  `cubic-bezier(0.3, 0.05, 0.65, 0.9)` (first frame at ~8 ms). Inside it is
  white (~0.92 over the scene); the bars show over the white.
- Text visible faintly under the white from ~233 ms.
- White alpha 0.92 to ~250 ms, then 0.86 (267), 0.79 (300), 0.58 (350),
  0.30 (400), 0.14 (433), 0.07 (450), ~0 (500).
- Glitch ~300-650 ms: 30 fps, tall slabs and stepped partial bars of a pale
  tint of the bar colour (pale gold; pale red for the high hint), denser at
  the box ends, fading over the last ~150 ms.

Replacement: a showing slot swaps to the next message's text in one frame
(low hints, five replacements ~178-184 s); no animation.

Alert exit (「比赛开始」, t = exit start): text fades 0-250 ms (box unchanged),
box turns white 250-400 ms, holds to ~500 ms, collapses 500-750 ms with the
enter curve reversed (width 296, 286, 268, 248, 220, 193, 164, 138, 108, 82,
54, 34, 16, 4).

Low hint exit: no white. The box (text scaled with it) collapses to its
centre in ~170-200 ms, ease-in (half width 150, 146, 136, 118, 98, 74, 51, 0
per ~17-33 ms), while it fades (bar strength ~117 -> ~30); the text is gone
after ~50-100 ms.

「赛点」 (tone match point): CS2 `FlashAnim` (3.7 s) confirmed by timing: normal
enter, text brightness falls slowly over ~2 s (opacity 0.85 -> 0.65), at
3.18 s it brightens (89 % keyframe, opacity 1) and fades out by ~3.45 s; at
3.68 s (animation end) the white box appears without text, holds ~240 ms and
collapses like the alert exit. 「比赛开始」 (default tone) does not flash.
The plugin's match point lasts 5 s (`SpecialRoundNotificationManager`), so
SLUI stretches the 0.65 plateau and times the closing flash to end at the
plugin's expiry.

Not visible in the recording: rich colour spans (CS2 colours skin names; the
plugin sends plain text), warning icon in the high hint.

### Progress card (recording)

A clean 10 s defuse without kit (card from 211.0 s to the zoom at ~221.05 s,
「你在没有拆弹器的情况下拆除炸弹。」), stepped at 60 fps; p = elapsed / 10 s.

- Card x 710-1209, y 630-749, appears at full opacity in one frame (no fade
  in). Fill reads as black ~0.43 over the sand (base (99, 86, 76) over
  (172, 153, 136)).
- Ring: outer x 773-867, 8px stroke, centre (821.5, 687.5), i.e. top-aligned
  10px under the card; the arc grows from the bottom in both directions,
  linear in p (20 % covers +-36 deg, 50 % the lower half). Track 8px light
  grey (+13 over the fill).
- Side bars 4px. Bar colour vs p (each half eased in and out, CSS
  `ease-in-out` fits): red (255, 102, 73) -> yellow (253, 244, 65) at 50 % ->
  green (84, 174, 68); ring arc (252, 112, 92) -> (254, 236, 80) ->
  (100, 168, 80). Additive in Panorama (`green` is #008000 there).
- Side glow: per side ~exp(-(x / L)^2) of the side colour at ~0.2 (normal
  blend fits: R drops when green takes over), L ~ 400px x p (fitted 15, 61,
  99, 107, 168, 208px at p 0.05-0.55); the two sides make a flat wash from
  ~70 %.
- Icon: C4 ink 37x52 (50px box), pulse period 0.8 s between (243, 194, 128)
  and white, phase not tied to the card (CS2 loops it from panel creation).
- Text: title ink y 647-661, x 899-1128 (14.4px per CJK glyph, i.e. smaller
  than the 0.9 Noto scaling of the other panels); countdown `00:09.984`
  updates every frame, digits ink y 716-727, right edge 1141, colour white at
  ~0.86; the layout row is centred on its content width (ring left gap 63px).
- End: the countdown holds `00:00.000` ~4 frames, then the card zooms
  (bottom edge 749 -> 761 in ~180 ms, i.e. ~1.2x) brightening, and is gone
  by ~0.25 s: CS2 `hudProgressBarSuccessZoom` (1.3x, brightness 2, 0.4 s)
  under a faster fade.
- Planting shows no card (captures); no cancel was recorded.
