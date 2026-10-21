# DWM backdrop blur under overlay panels (spike, 2026-10-20)

Question: can SLUI blur the game behind a panel, as CS2's world blur does under the scoreboard,
shop and message zone, instead of compensating with denser fills (spec cs2-visual-replication
sections 11 and 15, system-boundaries 3.1)?

**Answer: yes.** A separate backdrop window can do it: a click-through, never-activated, topmost
popup the size of the panel, with `SetWindowCompositionAttribute` accent blur. It blurs a
flip-model game window in borderless fullscreen and in windowed mode. The DWM GPU cost could not
be measured apart from an overlay's own cost. The blur radius is fixed (σ ≈ 30 px). Stacking two
windows gives about σ 42 px, which is CS2's scoreboard strength at 1080p. The Windows 11
documented system backdrop (DWMSBT acrylic) does **not** work for this.

## How it was measured

Tool: `spikes/backdrop-blur` (standalone crate, not part of the SLUI build).
`backdrop-blur-spike probe [--quick] [--only 1,3,...]` runs every variant over a stand-in game.
`play` runs over the real SCP:SL (see "In-game test" below).

- Stand-in game: a D3D11 window with a DXGI flip-model swap chain (FLIP_DISCARD, 2 buffers, as
  Unity's D3D11 player uses), presenting every vblank. It runs borderless (WS_POPUP covering the
  monitor) or windowed (WS_OVERLAPPEDWINDOW, 1260x787 client). It draws a known pattern: 384 px
  black/white bands, a 2 px checker, colour patches, and a black edge 30 px outside the panel.
  It can also fill the frame with one flat colour, and it can shift its bands to test content
  updates.
- Backdrop: `WS_POPUP` with `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST`, and either
  `WS_EX_LAYERED | WS_EX_TRANSPARENT` with `LWA_ALPHA` 255 (click-through, like the overlay) or
  without them. The client is painted black, and `WM_NCHITTEST` returns HTTRANSPARENT.
- Capture: DXGI desktop duplication, which returns the frames DWM actually composed, with their
  `LastPresentTime`. The tool analyses only the stand-in's own pixels, and nothing is saved.
- Machine: Windows 11 Enterprise 26200 (25H2), RTX 4070 Laptop GPU, 165 Hz panel, transparency
  effects on, dark theme. Measured at 1680x1050 (100 %) and at 2560x1600 (150 %).
  Scoreboard rect = SLUI's 1080p canvas rect (480, 278, 960x584), scaled by height/1080 and
  centred, as the overlay places it.

## Methods (borderless game, scoreboard rect)

| Method | Result over the game |
| --- | --- |
| `ACCENT_ENABLE_BLURBEHIND` (3), flags 0 | **Blurs.** Edge 10-90 % = 76 px (σ ≈ 30). Same with and without `WS_EX_LAYERED \| WS_EX_TRANSPARENT`. |
| `ACCENT_ENABLE_ACRYLICBLURBEHIND` (4), flags 0, GradientColor alpha 0 | **Blurs**, and on this build it is identical to 3 to within 1 grey level. GradientColor alpha adds a tint (table below). |
| `ACCENT_ENABLE_HOSTBACKDROP` (5) | Opaque black: no backdrop without host-backdrop brush plumbing. |
| `DWMWA_SYSTEMBACKDROP_TYPE` = TRANSIENTWINDOW (acrylic) | No blur on the popup: a flat fallback grey 84, even with the popup itself foreground. It blurred (σ ≈ 30) only on an ordinary captioned, **active** window, and turned flat as soon as another window was foreground. This rules it out for an overlay. |
| `DWMWA_SYSTEMBACKDROP_TYPE` = MAINWINDOW (mica) | Flat 32 (mica samples the wallpaper, never windows behind it). |
| Accent flags 2 (3 or 4) | Nearly opaque tint (black 2-12, whatever alpha the colour has). Do not use. |
| No accent (control) | A layered window with black paint is opaque black. So the backdrop window can only work through an accent. |

Activation does not matter for the accent methods. They blurred with the game foreground and with
an unrelated window foreground (`[6]`).

## Blur strength and tone

- **Radius:** σ ≈ 30 px in physical pixels, fixed. It was the same at 1680x1050 @100 % and at
  2560x1600 @150 %, so it scales with neither resolution nor DPI, and no API sets it. The point
  spread has longer tails than a Gaussian: 192 px from an edge the plateau is still ~7 % off.
- **Stacking:** each backdrop blurs what is under it, the lower backdrop included. Two windows
  gave σ 41.7 px and three gave σ 50.9 px (√N · 30). The cost did not change measurably (see GPU).
- **Tone**, measured with flat full-frame colours (inside value for game value x):

  | Backdrop | Response |
  | --- | --- |
  | 1 layer, no tint | 7 + 0.835·x; noise sd 0.8; saturation slightly up (red 255 → 231 while white → 219) |
  | 2 layers | 13 + 0.69·x |
  | 3 layers | 18 + 0.57·x |
  | 1 layer, GradientColor 0x40000000 | 14 + 0.65·x |
  | 1 layer, 0x80000000 | 21 + 0.40·x |
  | 1 layer, 0xC0000000 | 28 + 0.19·x |
  | 1 layer, 0xFF000000 | flat 34 (opaque, blur invisible) |
  | 2 layers, top 0x70000000 | 23 + 0.38·x |

  Tint through GradientColor raises the black floor. A CSS fill on the overlay panel above the
  backdrop is the better tint: x2 under `rgba(0,0,0,0.46)` gives 7 + 0.37·x.

## Against the CS2 captures (numbers only)

`research/cs2-world-blur-fit.py` fits `inside = a + b · gaussian_σ(outside)`. Inside is the
scoreboard's text-free padding strip (with the dot texture box-filtered away). Outside is the strip
just outside the panel. The fit uses the 2026-10-19 captures at 1080p:

| Capture | Edge | σ | R² | b | a |
| --- | --- | --- | --- | --- | --- |
| page 1 passive | top / left / right / bottom | 53 / 50 / 52 / 37 | 0.99 / 0.98 / 0.995 / 0.96 | 0.41 / 0.39 / 0.40 / 0.31 | -5 / -1 / -2 / 9 |
| page 1 cursor | top | 40 | 0.96 | 0.33 | 7 |
| page 2 passive | top / right | 39 / 33 | 0.99 / 0.975 | 0.39 / 0.35 | 1 / 6 |

The other edges fit poorly (R² < 0.9: flat world there) and are left out. The R² curves are broad
(above 0.95 from σ 30 to 60).

- **CS2 world blur at 1080p ≈ σ 35-55 px**, so DWM x2 (σ 42) matches. Panorama scales with the
  screen height; if its blur does too, 2560x1600 needs about σ 60-70, which is x4-x5.
- **CS2 tone inside the scoreboard ≈ 0.31-0.41 · blurred world + (−5…9)**, matching the 0.33-0.40
  inside/outside ratio in `cs2-scoreboard-layout.md`. DWM x2 under `rgba(0,0,0,0.46)` gives
  7 + 0.37·x, which matches. Today's `rgba(14,16,19,0.84)` passes 0.16 of the *unblurred* scene.
- Message zone: the 40 px boxes in the 2026-10-05 screenshots are too small for a stable fit, so
  the spike assumes they use the same world blur as the scoreboard (not measured). A backdrop on
  the 444x59 alert box (1600p) blurs fully to its edges: the 2 px checker's std is 0.8 inside and
  also in its top 2 rows. It also samples beyond its own rect: a black edge 30 px outside darkens
  the inside edge from 215 to 205, with no clamped halo.
- Shop: CS2's buy-menu mask is a light blur (CSS 2-3 px in the shop research) with desaturation.
  DWM's minimum is σ 30 and it adds saturation, so it does **not** fit the shop mask.

## Corners

- `SetWindowRgn` with a GDI round rect does **not** clip the backdrop: the blur reaches the
  square corner.
- `DWMWA_WINDOW_CORNER_PREFERENCE` works on the layered tool popup, with antialiased corners.
  ROUNDSMALL is ≈ 4 px and ROUND ≈ 8 px at 100 % DPI (DWM scales these with DPI; 150 % was not
  measured). `DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE` keeps Windows 11's 1 px border off, and no
  border line showed.
- CS2 uses 5 px (scoreboard) and 3 px (boxes) at 1080p. ROUNDSMALL is close, but no API sets an
  arbitrary radius.

## Latency (165 Hz, one frame = 6.06 ms)

- Show (`SetWindowPos(SWP_SHOWWINDOW | SWP_NOACTIVATE)` on a hidden, already-created window): the
  blur appears in the first or second composed frame after the call, +7…16 ms. The first show of
  a freshly created window took +10…26 ms, so create the windows once and keep them hidden. No
  run produced a black or unblurred intermediate frame.
- Hide: the next frame, +6…14 ms.
- Layered alpha: a change applies on the next frame (+6.7 ms). Alpha cross-fades linearly between
  sharp and blurred: the sharp-step fraction at an edge is 0.04 / 0.34 / 0.59 / 0.81 / 1.0 at
  α 255 / 192 / 128 / 64 / 0. So a panel's fade-in or fade-out can drive the backdrop alpha.
- Game content: the blurred image trails the game's own pixels by 0-3 frames, usually 1-2
  (≤ 12 ms at 165 Hz). Flat black/white switches gave 0,2,2,3,1,2,1,2,2,1,3,2 frames; band flips
  stayed in sync in 121/121 frames (BLURBEHIND) and 98/121 (ACRYLIC). Under a σ 30+ blur this is
  not visible.
- Game window moving (windowed, 4 px per step, backdrop still): the blurred content followed the
  window in 58/61 and 59/61 frames. When the panel itself must move (the game window moved),
  move the backdrop in the same pass as the overlay realign (`align_overlay_to`, 100 ms poll).

## GPU cost (2560x1600 @165 Hz, stand-in presenting every vblank, capture off)

| State | dwm.exe 3D engine | Game present mode (DXGI_FRAME_STATISTICS_MEDIA) |
| --- | --- | --- |
| No other window | 0.0 % | overlay (MPO, hardware composed) |
| One backdrop (scoreboard, full screen or 3 message boxes), 3 stacked (scoreboard or full screen) | 0.3-0.4 % | composed |
| Full-screen colour-key layered overlay stand-in only | 0.4 % | composed |
| Overlay stand-in + scoreboard backdrop | 0.4 % | composed |

Any overlay-like window already makes DWM compose the game. The backdrop adds nothing measurable
on top of that, in GPU time or in present mode. One thing is still open: whether SLUI's real
overlay (WebView2 in a layered window) keeps SCP:SL in MPO. If it does, the backdrop would be what
moves SCP:SL to composed flip, which can add up to a frame of present latency. PresentMon in game
answers this (optional step below).

## Behaviour when the game is not foreground

DWM keeps blurring whatever is foreground (accent methods). SLUI hides the overlay unless SCP:SL or
the overlay itself is foreground. Backdrops must follow the same rule, in the same
`sync_overlay_visibility` path. The spike's `play` mode does this (SCPSL.exe or slui.exe in front).

## Not tested

- Real SCP:SL: this is the user's test below.
- Windows "Transparency effects" off and energy saver: Windows is expected to drop the blur to a
  solid tint. A product would read `EnableTransparency`, listen for `WM_SETTINGCHANGE`, and fall
  back to today's dense fills.
- Windows 10, AMD/Intel GPUs, multi-monitor, HDR.

## In-game test (the user)

The debug build is the spike binary; the SLUI build stays untouched. From the repo root on branch
`spike/backdrop-blur`:

```
cargo run --manifest-path spikes/backdrop-blur/Cargo.toml -- play --stack 2
```

Flags: `--stack 1..6` (layers; σ ≈ 30·√N px), `--method accent-acrylic|accent-blur|sbt-acrylic`,
`--scene N` (start N scenes further). Hotkeys work while the game is in front:

| Keys | Action |
| --- | --- |
| Ctrl+Alt+1 | Scene: scoreboard rect while **CapsLock is held** → scoreboard rect always → message-zone boxes → whole window (shop mask) → off |
| Ctrl+Alt+2 | Layers 1 → 2 → 3 → 4 (blur strength) |
| Ctrl+Alt+3 | Tint of the top layer: none → 0x60 → 0x40 → 0x80 black (0x60 over 2 layers ≈ CS2's darkening, with a raised black floor) |
| Ctrl+Alt+4 | Corners: square → DWM small → DWM round |
| Ctrl+Alt+0 | Quit |

1. Start SCP:SL in its current borderless mode (Unity "FullScreenWindow"), then run the command
   above. Do not start SLUI yet: its scoreboard draws the 0.84 fill, which hides most of the blur.
2. Hold CapsLock: the scoreboard rect should blur the game live (turn the camera). Press
   Ctrl+Alt+3 once (0x60 tint) and compare the look with the CS2 captures. Press Ctrl+Alt+2 for
   3 and 4 layers (at 2560x1600, CS2's strength is expected at 4-5).
3. Ctrl+Alt+1 through the scenes; the message-zone boxes and the whole-window mask show at once.
4. Switch SCP:SL to windowed and move the window: the backdrops should follow within about a frame
   per poll (16 ms).
5. Alt+Tab to another app: the backdrops hide; back in the game they return.
6. Optional: start SLUI (`npm run tauri dev`, with `SLUI_SCOREBOARD_SPIKE=1` on the scoreboard
   branch). The console then says "SLUI overlay found": the backdrops sit directly under the
   overlay, and its panels draw on top.
7. Optional: watch FPS with and without backdrops (Ctrl+Alt+1 to "off"). PresentMon shows whether
   SCP:SL stays "Hardware: Independent Flip/Composed: Flip" with SLUI alone and with a backdrop.
8. Optional: turn off Settings → Personalization → Colors → Transparency effects. The blur should
   disappear; this is the case that needs a fallback.

## Recommendation

**Adopt for the scoreboard, and for the message zone and progress card once step 2 looks right in
game. Keep the denser fills for the shop mask.**

Follow-up task shape (product change through a PR):
- Rust: a backdrop module owning a pool of accent-acrylic (or blur-behind) windows per panel region:
  created once, kept hidden, flags 0, GradientColor 0, `DWMWCP_ROUNDSMALL`, border none.
  - Layer count = `round((42 · H / 1080 / 30)²)`, so 2 at 1080p and 4 at 1600p; or a user-chosen
    strength.
  - Placed directly under the overlay HWND, moved in `align_overlay_to`, hidden and shown with the
    overlay.
  - A command `set_backdrop_regions([{x, y, w, h}] in overlay CSS px)`.
  - Disabled when transparency effects or energy saver are on.
- Frontend: panels report their rect after the first paint (double rAF, ResizeObserver). They clear
  it before hiding, so the backdrop never shows before or after the panel (the mismatch stays ≤ 1
  frame). Fades drive the backdrop alpha.
- Fills: retune from the captures over the blur, scoreboard ≈ `rgba(0,0,0,0.46)` + dot grid over
  x2. Keep today's dense fills as the fallback.
- Spec and memory: system-boundaries 3.1 (new window and command), cs2-visual-replication 11/15
  (fills with and without backdrop), the "overlay has no world blur" note. The mock preview could
  then use `backdrop-filter: blur(42px)` to stand in for the native blur.
- Risks: `SetWindowCompositionAttribute` accents are undocumented (widely used, but behaviour has
  changed between Windows builds), and the blur depends on user settings. Both are covered by the
  fill fallback.
