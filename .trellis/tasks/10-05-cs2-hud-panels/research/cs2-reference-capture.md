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
  by two SLUI checker tiles that twinkle; the music-kit artwork overlapping the
  avatar is dropped (no SLGO equivalent) and the trailing note glyph is a SLUI
  icon. The CS2 glitch video layer is not recreated.
- The exit is the root's 0.3 s fade plus the title box collapsing; Panorama's
  1 s delayed MVP collapse is not replayed, so the strip leaves with the title.
