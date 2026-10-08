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
- Clip bar `#AmmoClipBar`: Panorama says 65 x 4 with a 1px black border and track `rgba(255,255,255,0.1)`; the
  recording shows a 2px line at y 1047-1048 (fill = wash colour, anchored left) over a faint grey track (~0.18
  white) and no dark border. Low clip: fill red with `#DD0000` 5px glow.
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

## Particle port (in progress, 2026-10-08) — resume here

The user asked for a pixel-level match of the kill effect. Fitting shapes by eye (`spectrum.ts`, now unused by
the component; kept only for its smoke tests until removed) was rejected four times. The current approach ports
CS2's own particle systems:

- Source: the game's `particles/ui/ammohealthcenter/ui_hud_kill_streaks_*.vpcf` (decompiled locally with
  Source2Viewer-CLI from the CS2 VPK; reference only, never committed). The HUD plays them in a
  `ParticleScenePanel` 900 x 500, `cameraOrigin 0 600 127`, `lookAt 0 0 127`, `fov 41`, additive, washed with the
  team colour (`hudhealthammocenter.xml`, `particle_controls.css` `.UiParticlePanelAmmoCenter`).
- Per kill level the parent system starts children (no delays): 1 killid+motion+circlemsk; 2 adds lineglow and
  circle_flash; 3 glow, lineglow_lvl3, splash; 4 splash_cubes, glow, cards_mask, lineglow_lvl3, splash,
  circle_flash; 5 glow_5, lineglow_lvl5, splash_cubes_lvl5, cards_mask, radiate, killid, splash_many, motion,
  circlemsk, circle_flash; 6+ (_many) glow, motion, circlemsk, circle_flash. Control points: CP1 (110, 8),
  CP2 (-110, 8), beam CP5 -> CP4 = (0,30)->(0,90) / (-1,30)->(-8,90) / (-2,30)->(-14.5,90) / (-3,30)->(-22,88) /
  (-5,30)->(-29,88), CP11.x dim 0.9/0.9/0.9/0.5/0, CP10.x 4/5 (cards mask size). Masks (motion band under the
  line, circlemsk disc, cards_mask) live 2 s; kill 5's radiate (120/s for 2 s, life 1 s) outlives them: that is
  the "spindle" flash at 2.0 s (needles and glow then also show below the line).
- The kill-5 "needles" are lineglow_lvl5: anamorphic-lens sprites rotated 90 degrees (vertical), 25 instant +
  100/s for 2 s, life 0.5 s, radius 15 x DistanceToCPInit (1.5 near the centre -> 0.2 at 55 units, bias 0.29),
  x warped by particle number (0..0.55 of the path), InterpolateRadius 0.25 -> 2 (bias 0.8), FadeAndKill from 0.
- Code: `src/features/bottomhud/particles/` — `engine.ts` (systems, Source 2 conventions, unit 2.005 px per unit
  with the horizontal fov; a vertical fov made everything half the recorded size), `systems.ts` (ported specs),
  `textures.ts` (analytic textures fitted to the measured luminance profiles: glow exp(-r/0.12), lens line 2 %
  thick, flare_007b gaussian 0.13, rays, beam), `render.ts` (ring flash, masks, paint per frame). BottomHud mounts
  one canvas per kill over the whole row (CS2's panel is the HUD's last child).
- Open problems at hand-off: overall energy and tone mapping (`PANEL_GAIN` + the SVG tone-map filter
  `TONE_TABLE`, k = 4: currently far too bright/white and the glow from `glow`/`radiate` dominates); the
  needles still read weaker than in the recording; the beam is too wide/soft compared with the game's
  saturated column; colour (the light NTF blue saturates to white sooner than CS2's gold). Next steps: calibrate
  per system against the 60 fps frames side by side (kill 5 at 0.15 / 0.35 / 0.6 / 0.9 / 1.3 / 2.08 / 2.25 /
  2.5 s), then check kills 2-4 and 6+, then remove `spectrum.ts` and its smoke tests, update the spec section 13
  motion text, run lint / test / audits, and ask the user for a visual review (PR #21 stays without auto-merge).

### Session 2026-10-08 (afternoon) — renderer rewritten, resume here

Pipeline now (`particles/gl.ts`): WebGL2, RGBA16F panel, spritecard maths per quad
(`saturate(overbright x colour x tex.rgb)` unless the renderer disables it, x `smoothstep(0,1,tex.a)` x alpha,
x (1 + addSelf)), additive or alpha-blended (masks = black alpha blend, drawn in the parent's child order), then
per channel `1 - exp(-1.5 x light)` with NO sRGB encode, x team wash, alpha = max channel ("over" composite: CS2's
saturated beam is exactly the wash colour (254,206,117) whatever is behind). Canvas has no CSS filter/blend.

Authoritative findings (vtex sources, VRF reverse-engineered renderer — `Renderer/Shaders/particle_spritecard.frag.slang`,
`Renderer/Particles/Renderers/RenderTrails.cs`, `ValveResourceFormat/Particles/AttributeMapping.cs`, `Utils/ParticleMath.cs`):
- textures are sRGB (decode rgb; alpha linear); several keep the shape in alpha only (lens, soft_gradient,
  simple_lines, glow_simple) — `textures.ts` stores [colour, alpha] pairs measured separately.
- particle colours are /255, not decoded (decoding turned pale-blue sparks teal; recording is gold).
- PARTICLE_NUMBER = creation index; lineglow warp curves (0..50) and radiate remap (0..90) are PF_INPUT_MODE_LOOPED
  (gives the recording's 0.5 / 0.75 s outward sweeps — kymograph matches).
- literal inputs ignore their curve map: killid TrailLength = 2.0 (x1.1) -> beam length 2.2 x |CP4-CP5| (matches).
- bias = x / ((1-x)(1/b-2)+1); DistanceToCPInit bias applies to the remapped value clamped to 0..1.
- FadeAndKill smoothstep; drag per 1/30 s; RANDOM_BIASED via BiasFromParameter (kill 2 rotation GAIN -0.9999 -> 0 or 90).
- roll is counter-clockwise on screen (radiate -45 -> vertical streaks; fixed needle contrast and the 2.0 s flash).
- field 38 = ManualAnimationFrame (irrelevant). Kill 2's ColorInterpolate window 0.5 -> 0.2 is applied clamped
  (VRF would skip it, but the recording shows the cyan x gold green).
- Panel geometry confirmed: line y 448 = z 28 = circle centre; CP1/CP2 (+-110, 0, 8); CP5/CP4 per level as listed.

State vs recording (offline renders): kills 1-4 match well (beam, kill-2 green, sparks); kill 5 matches timing,
spread and contrast. Known differences: radiate sits ~3 u above the line per spec, so light 0-30 px above the
line is ~1.4x the recording (below the line matches) — unresolved, no spec basis for a shift; beam along-fade is
fitted (`textures.ts` beam). Kill 6+ not checked (no recording).

Next: (1) real-app check — `capture.mjs` frames came back all white (255) this session; investigate (headless Edge
page/WebGL?) or use the Browser pane screenshot; check NTF light-blue wash and the cards-mask notch over real
cards. (2) remove `spectrum.ts` + its smoke tests, add particle smoke tests (textures/systems are DOM-free).
(3) spec section 13 text, lint/test/audits, commit, push PR #21, ask the user for visual review.

Local tools (D:/Temp/slui-bh, never commit): `hb.mjs <count> <ms,...> <prefix>` (offline render in headless Edge
on 9223 via the mock server; env ONLY=<system names>, NORAW=1, EXPOSURE=x; writes PNG + raw .f32),
`hsbs.py` / `hdiff.py` / `hzoom.py` (CS2 vs SLUI over the pre-kill frame), `kymo2.py` (line kymograph),
`hb/fr/k5.raw` (kill-5 frames 10.1 s + 2.7 s, 900x500 panel crop). Kill onsets in the kills recording:
2.350 / 4.317 / 6.250 / 8.183 / 10.167 s. VRF sources downloaded in `vrf/`.
