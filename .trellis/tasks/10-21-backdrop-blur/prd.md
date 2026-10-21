# Native world blur under CS2-style HUD panels

## Goal

Every SLUI panel that sits on a world blur in CS2 blurs the game behind it in SLUI too, through
native DWM backdrop windows under the overlay. When the blur is unavailable, the panels keep
today's dense fills.

## Background

- The 2026-10-20 spike (`research/dwm-backdrop-blur.md`) showed that a click-through popup with
  `SetWindowCompositionAttribute` accent blur, placed under the overlay, blurs SCP:SL live.
- In-game test 2026-10-21: the SLUI scoreboard (fill `rgba(0,0,0,0.46)`) over one backdrop layer
  looked right to the user. **One layer is the chosen strength.**
- The user asked for every panel that CS2 blurs. The list comes from the Panorama sources
  (`research/cs2-world-blur-sources.md`): scoreboard, alerts, hints, progress card, killfeed rows,
  win panel result, bottom HUD centre circle and kill cards, radar viewport, team counter equipment.

## Requirements

1. **Panels.** Each panel in the table in `research/cs2-world-blur-sources.md` gets a backdrop that
   matches its on-screen rect, corners, visibility and opacity, including while it animates.
   Panels that are not drawn get no backdrop.
2. **Strength.** One backdrop layer by default (σ ≈ 30 px). A setting allows 1-3 layers.
3. **Switch.** A setting "游戏背景模糊" turns the backdrops off (default on).
4. **Fallback.** With the switch off, or when Windows cannot blur (transparency effects off,
   energy saver on, unsupported Windows build), no backdrop window shows and every panel draws its
   current dense fill. The change applies while running, without a restart.
5. **Fills.** With the blur on, each panel uses its CS2 fill as on the blurred world (Panorama
   value or capture fit), not the dense stand-in.
6. **Visibility rules.** Backdrops follow the overlay: shown only while the overlay may show (game
   or overlay in front, overlay enabled), aligned to the game window, under the overlay in z-order,
   never above other apps, never focusable, click-through.
7. **Mock preview.** `npm run dev:mock` shows a stand-in for the native blur so reviews compare like
   with like.
8. **Not in scope.** The shop mask keeps its CSS treatment (CS2 blurs the HUD there too, which a
   backdrop under the overlay cannot do, and DWM's minimum blur is too strong). Panels SLUI does not
   have (death panel, vote, spectator, round impact score) are out of scope.

## Acceptance criteria

- [ ] In SCP:SL (borderless and windowed), each in-scope panel blurs the game behind it, and the
      blur matches the panel's rect and corners within one frame of its motion.
- [ ] No backdrop is visible when the panel is hidden, the overlay is disabled, or another app is
      in front; Alt+Tab away and back works.
- [ ] Turning off Windows transparency effects or the SLUI switch shows the dense fills, with no
      blur window left on screen.
- [ ] The strength setting changes the blur live.
- [ ] No measurable FPS drop in SCP:SL with all backdrops on, compared with the overlay alone.
- [ ] The user approves the look of each panel group in game (visual PRs wait for review).
- [ ] Spec updated: system-boundaries (backdrop windows and command), cs2-visual-replication (fills
      with and without blur), and the "overlay has no world blur" notes in code comments.

## Task map

| Child | Delivers | Order |
| --- | --- | --- |
| `10-21-backdrop-core` | Native backdrop module, region contract, settings and fallback, mock stand-in, scoreboard | first |
| `10-21-backdrop-rect-panels` | Alerts, hints, progress card, killfeed rows, win panel result | after core |
| `10-21-backdrop-shaped-panels` | Bottom HUD circle and kill cards, radar, team counter equipment | after core; needs a shape check (circles) |

Each child lands as its own PR. The core child uses branch `feat/backdrop-blur`, which also carries
these planning artifacts; the later children branch off `main` after it merges.
