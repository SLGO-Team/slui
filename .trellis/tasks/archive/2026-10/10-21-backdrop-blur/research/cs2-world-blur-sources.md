# Which CS2 HUD panels sit on a world blur (Panorama sources, 2026-10-21)

Source: the Panorama dump in `../cs2ui/panorama` (reference only, see spec cs2-visual-replication).

## Two mechanisms

1. **`world-blur:` on a panel style.** The engine blurs the 3D world under that panel's rect.
   `@define hudWorldBlur: gaussian(2,2,2);` (`styles/csgostyles.css:9`) is the one value every HUD
   panel uses. `world-blur: none` turns it off for a state.
2. **`blurrects` on a full-screen blur panel** in `layout/hud/hud.xml`:
   - `HudBlur` (`mipmapgaussian(2, 2, 4)`): `Scoreboard EndOfMatch BuyMenu sliding-panel--TERRORIST
     sliding-panel--CT RetakeLoadout`. It sits above the HUD panels, so it blurs the HUD too under
     those rects (the buy menu blurs the radar, money, killfeed ... under it).
   - `HudBlurLess` (`mipmapgaussian(1, 1, 3)`): `RoundImpactScoreMain MapDraft`.

`hud-blur-bg-color` (`#000000a0`) is only a fill colour. It is not a blur; the blur comes from the
`world-blur` line next to it.

## Panels with `world-blur: hudWorldBlur`, and their SLUI counterpart

| Panorama selector | File | SLUI panel |
| --- | --- | --- |
| `CSGOScoreboard` | `styles/scoreboard.css:1639` | `features/scoreboard` (`.scoreboard`) |
| `CSGOHudAlerts` | `styles/hud/hudalerts.css:9` | `features/hudmessages` alerts |
| `.hud-hint.low-priority, .hud-hint.high-priority` | `styles/hud/hudhinttext.css:17` | `features/hudmessages` hints (message zone) |
| `.hud-progress-bar` | `styles/hud/hudprogressbar.css:10` | `features/hudmessages` progress card |
| `.DeathNoticeBG` (plain, victim, killer) | `styles/hud/huddeathnotice.css:65,79,97` | `features/killfeed` rows |
| `.WinPanel__Result` | `styles/hud/hudwinpanel.css:97` | `features/winpanel` |
| `.hud-HA-center` | `styles/hud/hudhealthammocenter.css:734` | `features/bottomhud` centre circle |
| `.kill-flag-bg-blur` | `styles/hud/hudhealthammocenter.css:1005` | `features/bottomhud` kill cards |
| `#Radar__Round--Inner`, `#Radar__Square--Inner` (`none` while scoped) | `styles/hud/hudradar.css:119,157` | `features/minimap` radar viewport |
| `.equipinfo__bg-container .equipinfo__blurbg` | `styles/hud/hudteamcounter-equipmentinfo.css:156` | `features/hud` team counter equipment |

No SLUI counterpart (not in scope): `.DeathPanel__BG-Blur`, `.HudSpecplayer__Bg`, `CSGOHudVote`,
demo controller/playback, `.ris__main` (round impact score), vanity loadout, match stakes, retake
loadout, map draft, radio sliding panels.

`world-blur: none` overrides: `.buymenu CSGOMoneyPanel .hud-bottom-row-background--left`
(`hudmoney.css:34`), `.buymenu .hud-bottom-row-background--right--*` (`hudweaponselection.css:806`),
radar and spectator backgrounds while scoped.

## Consequences for SLUI

- Every panel above uses the same `hudWorldBlur`, so one strength serves them all. The scoreboard
  capture fit (σ 35-55 px at 1080p) is the measured strength; the user chose 1 DWM layer (σ ≈ 30)
  in game on 2026-10-21.
- The buy menu's `HudBlur` blurs SLUI's own HUD panels under the menu as well as the world. A
  native backdrop sits under the overlay and cannot blur the overlay's own panels, and the spike
  found DWM's minimum σ too strong for the shop's light mask. The shop keeps its CSS mask.
- Earlier SLUI comments call `hud-blur-bg-color` "the blur fill". The fill and the blur are
  separate declarations; the blur is the `world-blur` line.
