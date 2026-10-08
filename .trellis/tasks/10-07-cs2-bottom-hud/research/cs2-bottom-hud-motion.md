# CS2 bottom HUD: reference recordings and first findings

Three 1080p / 60 fps recordings made by the user on 2026-10-07 (kept locally, never committed):

| Recording | Content |
| --- | --- |
| kills | first ~30 s: 14 bot kills in one round (cards 1-5, then the counter card 6-14), knife switch at the end |
| fire | AK-47 magazines emptied: per-shot pop, clip bar, low-ammo red, reloads (reserve magazines 3 -> 2 -> 1) |
| balance | balance changes by purchases and resets ($13300 down to $0, several steps) |

Findings from 2 fps contact sheets, then 60 fps frame stepping and luminance tracking (numpy) of the
emblem, beam, card and stroke regions. Times are from the kill frame (t0 = first frame the emblem whitens).

## Layout (1080p, T side, captured)

- One row centred on x 960, baseline ~y 1030: left block (armor icon + health `100` with an underline bar),
  a thin horizontal stroke to the centre emblem (circle ~61px, T logo), the stroke continues right to the
  clip `30` with its underline bar, then the reserve `3` + magazine icon.
- CS2's own money panel sits separately at the bottom-left corner (`$65535`, x ~18, right-aligned). SLGO moves
  the balance into the health slot (user request).

## Kill cards

- Kill N (1-5): a card drops from above into a vertical light beam over the emblem; the emblem fills white
  for a few frames; the horizontal strokes glow (particle sparks along the line, wider at kill 5); the health
  and clip numbers flash white with it. The cards fan out like a hand: 1 card upright, 2-5 spread to the left
  and right of the upright newest card, the newest card carries the number.
- Kill 6+: the fan collapses into one upright counter card (`kill_extra`) with the kill count; each further kill
  re-runs a smaller flash (emblem white, card bright) without the fan.
- Each card shows the kill pip (skull = `default`).
- Switching to the knife hides the clip/reserve block; the kill cards and emblem stay.

## Ammo

- Every shot: the clip number pops (bigger and brighter for a moment) and steps down.
- The underline bar under the clip shrinks with the clip (anchored left).
- Low clip: number and bar turn red with a red glow. Observed 6/30 red, 7/30 normal: red at <= 20 % of the clip.
- Empty (0): stays red; reload refills to 30 and the reserve magazine count steps down with an icon drop.

## Balance

- Each change rolls the changed digits vertically like an odometer (decreasing digits roll one way); the text
  is right-aligned, so fewer digits shift the `$` to the right.

## CS2 sources used for measurements

`../cs2ui/panorama/layout/hud/hudhealthammocenter.xml`, `styles/hud/hudhealthammocenter.css`,
`layout/hud/hudmoney.xml`, `styles/hud/hudmoney.css`, `scripts/hud/hudmoney.js`. The kill/ammo icons were
viewed locally from the game package as reference only; SLUI redraws what it needs.

## Measured (60 fps)

### Geometry (1080p)

- Panorama `hud-HA`: 800 x 72, bottom 16px above the screen edge, centre row y 1028. Centre circle 64 x 64
  (`hud-HA-center`, blur fill + 3px white border, washed; measured ~61px visible) at (960, 1028).
- Left/right panels each (800 - 64) / 2 = 368 wide. Strokes: 1px, 50 % of the panel (184px), from the circle
  outwards, white -> transparent gradient, washed: x 744-928 and 992-1176.
- Big numbers (`hud-HA-health_or_ammo-label`): Stratum2 bold TF 42px, label 70px wide, centred text.
  Left number block right-aligned 200px left of the circle panel edge (`margin-right: 200px`), right block
  starts 200px right of it (`margin-left: 200px`): clip label x 1192-1262 (recording: "30" ink 1205-1250).
- Clip bar `#AmmoClipBar`: 65 x 4, 1px black border, 14px above the panel bottom, track
  `rgba(255,255,255,0.1)`, fill = wash colour, anchored left. Low clip: fill red with `#DD0000` 5px glow.
- Reserve label: Stratum2 bold TF 32px right after the clip; reserve icon box 32 wide, icon 18px high,
  margin-left 4px, y -1px.
- Kill cards: every card image is a 48 x 126 viewBox drawn at 152px height (57.9 x 152), centred on the
  circle centre (measured: card top at y 961, card 33.8 x 45.8 at viewBox x 10-38, y 8.4-46.4), so cards
  rotate about the circle centre. Fan transforms (Panorama, exact), card k of n:
  n=1: k1 (0,0) 0deg. n=2: k1 (-2,2) -6, k2 (2,0) +6. n=3: k1 (-3,4) -12, k2 (0,2) 0, k3 (3,0) +12.
  n=4: k1 (-5,6) -18, k2 (-2,4) -6, k3 (2,2) +6, k4 (5,0) +18. n=5: k1 (-7,8) -24, k2 (-3,6) -12,
  k3 (0,4) 0, k4 (3,2) +12, k5 (7,0) +24. Later cards paint over earlier ones. Transition 0.2 s ease-in-out
  when the fan re-lays out. From 6 kills: only `kill_extra` (0,0) 0deg with the count (white 21px bold label,
  y 21px, x -1px inside the card).
- Card art: dark translucent card (blur fill + dot pattern 0.2 under `kill_mask`), washed outline + grid;
  number on `kill_1..5`; pip layer per kind (default = skull top-left + small skull bottom-right).

### Kill burst (kills 1-5)

- Whole `hud-HA` row (numbers, strokes, circle) and the new card: Panorama `on-kill`, brightness 6 for 30 %
  of 0.7 s then ease-out to 1 (measured circle: white t0-250ms, back to normal by ~650ms; washed colour
  times 6 clips to white). Stroke bright until ~500ms, normal by ~620ms.
- Light beam (particle system, recreated): a ~40px wide vertical column behind the new card, along the new
  card's rotation, from the circle up past y 860; grows upward 17-67ms, full by 200ms, holds to ~670ms,
  fades out by ~1 s. Card stays bright under it and fades back to normal by ~1.05 s.
- Kills 2-5 add particles: small sparks scattered around the circle/strokes rising (t 100-500ms); kill 4-5 a
  "skyline" of thin vertical streaks along the strokes near the circle (peak 300-700ms). Kill 5 additionally
  plays a big equalizer flare ~2.0 s later: wide horizontal glow along both strokes with vertical streaks of
  random height, peak 50-400ms, gone by ~700ms.
- Kill 6 (fan -> counter): fan collapses to the centre and sinks behind the circle in ~100ms, the counter card
  rises from behind the circle in ~70ms; circle whitens as above, then a soft halo around the circle
  (t 230-700ms). No beam. Kills 7+: circle/card flash only (card bright with white grid, ~1 s).
- Health/clip numbers flash white with the circle (same `on-kill`).

### Ammo

- Each shot: Panorama `jitter-number` 50ms (scale 1.15 + translate(-3,-4), brightness 3 -> 5 -> 3 -> 1).
- Low clip (<= 20 %, 6/30 red, 7/30 normal): the number keeps the wash colour; a red glow sits behind it
  (`text-shadow 0 0 9px #DD0000` in Panorama, clearly visible in game) and the clip bar fill turns red.
- Reload: reserve icon drops out 50px and comes back from above (`reload`, 0.3 s ease-in).
- Weapon change: block scales 0.75 -> 1 in 0.1 s.

### Balance odometer

- CS2 `DigitPanel`: each character is a vertical strip of symbols; on change each strip translates directly
  from the old symbol to the new one (decreasing digits move the strip down, the new digit enters from
  above), all digits together. Recorded motion: starts ~3 frames after the change, lasts ~31 frames
  (~520ms); fitted easing `cubic-bezier(0.2, 0.15, 0.6, 1)`. Glyphs are separated by small gaps, which
  reads as a brief hold on each passing digit.
- Width: digits right-aligned in a fixed number of cells (CS2 pads to the width of "$16000"); fewer digits
  leave blank cells on the left.

### Kill 5 in detail (second pass, after review)

- 0-1 s: the column is opaque and bright, holds to ~950ms, gone by ~1100ms. Sparks: ~20-40 small dots over
  the fan, mostly left of the column, rising 40-150px with a twinkle, 70-1000ms. Spectrum: a dense golden
  haze mound around the circle (up to ~45-60px, +-70px) textured with fine vertical hair lines ~3px apart;
  consecutive 60 fps frames show the texture nearly still: the mound grows, widens along the strokes and
  fades, the lines do not bounce (a first, flickering recreation read as a music player).
- 1-2 s: the mound settles low and wide (+-130px) with tall thin streaks over the cards.
- 2.0 s: the row flashes again (the emblem stays visible on its circle), a lens-shaped glow +-120-160px wide and
  +-25-30px high with bars mirrored above and below the line, tall streaks over the cards; fades by ~2.7s, a thin
  waveform along the line until ~3.0s.

### Shot and low clip in detail

- Shot (60 fps): frame 1 the new number is ~1.15x, shifted up-left and pale (gold -> pale yellow, not white);
  frame 2 normal size ~4px lower; frame 3 normal.
- Low clip: the glyph keeps its colour; a soft orange-red halo hugs it (Panorama 9px, strength 2.5), no hard rim.
- Texture (zoomed 60 fps frames, review 2026-10-08): every line is a needle, wide where it leaves the stroke and
  sharp at the tip; neighbouring bases blur together into one glow, only the tips stay apart; all edges are
  soft. Under the needles a blurred fog mound about half their height.
