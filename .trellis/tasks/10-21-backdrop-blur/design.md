# Design: own world blur under HUD panels

Shared by all three children. Panel list: `research/cs2-world-blur-sources.md`.

**Revised 2026-10-21.** The first design put DWM accent-blur windows under the overlay
(`research/dwm-backdrop-blur.md`). In game DWM refreshed that blur at ~30 Hz while the game ran at
80-125 fps, which stuttered while the camera turned. SLUI now blurs the game itself: it captures
the game window with Windows.Graphics.Capture and blurs it on the GPU; the spike version followed
every game frame (`research/own-blur-wgc.md`).

## Shape

```
SCP:SL window ──(Windows.Graphics.Capture, every frame the game presents)──┐
                                                                            ▼
  blur window (click-through, DirectComposition swap chain, game-window size)  ← Rust `backdrop`
      └ overlay window (WebView2, layered, transparent)                         ← panels draw fills
```

The overlay page owns *where* blur is needed (it knows what it renders). Rust owns *how*
(capture, GPU, window, z-order, visibility, availability). One command and one event connect them.

## Native module (`src-tauri/src/backdrop.rs`, Windows only, `windows` 0.61 already in the tree)

- **Device**: one D3D11 hardware device (BGRA, multithread-protected) for capture, blur and
  presentation; shaders compiled once at start with `D3DCompile` (d3dcompiler_47 ships with
  Windows 10+).
- **Blur window**: `WS_POPUP`, ex `NOREDIRECTIONBITMAP | TOPMOST | TOOLWINDOW | NOACTIVATE | LAYERED |
  TRANSPARENT`, `LWA_ALPHA 255`, `WM_NCHITTEST → HTTRANSPARENT`: click-through and never activated
  (checked in game with `WindowFromPoint`). One DirectComposition visual holds one composition swap
  chain (B8G8R8A8, premultiplied alpha, FLIP_SEQUENTIAL, 2 buffers, maximum frame latency 1) sized
  to the game window. Created hidden on the main thread at startup; placed with the overlay's rect,
  directly under the overlay in z-order (`SetWindowPos(insert_after = overlay)`).
- **Capture**: `GraphicsCaptureItem` for the game HWND, free-threaded frame pool (2 buffers,
  recreated on size change), cursor off, `SetIsBorderRequired(false)` after
  `GraphicsCaptureAccess::RequestAccessAsync(Borderless)`, `SetMinUpdateInterval(1 ms)`. Started on
  the first non-empty region list, stopped after 5 s without visible regions, restarted when the
  game window changes. The game HWND comes from the foreground thread (the window it aligns the
  overlay to).
- **Per captured frame** (capture callback thread, engine mutex): clear the back buffer to
  transparent; for each region: copy region + 3σ margin (clamped to the window) into a 3-mip
  texture, `GenerateMips`, horizontal and vertical Gaussian at 1/4 resolution (σ/4), then draw into
  the back buffer at the region's rect: bilinear upscale, rounded-rect mask with antialiased edge
  (any radius, circles included), region opacity, premultiplied "over" blend. Present. Scratch
  textures are reused across regions and grown when a larger region needs it.
- **Strength**: σ = 20 / 30 / 40 px at 1080p (setting 1-3, default 1), scaled with the window
  height. Default 1 = σ ≈ 30 px at 1600p, the strength the user chose in game.
- **Coordinates**: regions arrive in overlay CSS px. Blur-window px = round(css × overlay scale
  factor) (the blur window has the overlay's rect). Capture px = blur-window px + overlay origin −
  capture origin (`DWMWA_EXTENDED_FRAME_BOUNDS` of the game window).
- **Visibility**: the blur window is shown only when all hold: the overlay may show and is visible,
  the setting is on, the blur is available, the region list is non-empty, and a frame with the
  current regions has been presented (so a stale frame never shows). Hiding is immediate (main
  thread) when any of these turns false. `sync_overlay_visibility`, `hide_overlay_window`,
  `apply_overlay_input_mode` and `align_overlay_to` refresh it.
- **Availability**: `GraphicsCaptureSession::IsSupported()`, borderless capture allowed (Windows 11),
  device, shaders and window created, and no capture failure for the current game window.
  Changes emit `slgo-backdrop-available { available }`. Windows 10 (no borderless capture) and any
  failure fall back to the dense fills. Windows transparency effects and energy saver do not matter.
- Non-Windows: commands are no-ops; availability is false.

## Command and event

```ts
// overlay → Rust, sent only when the list changes (at most once per animation frame)
invoke("set_backdrop_regions", { regions: BackdropRegion[] });
type BackdropRegion = { x: number; y: number; w: number; h: number;   // overlay CSS px
                        radius: number;                               // overlay CSS px, ≥ 0
                        alpha: number /* 0-1 */ };

invoke("set_backdrop_options", { enabled: boolean; strength: 1 | 2 | 3 });  // from settings
listen("slgo-backdrop-available", ({ available }) => …);
invoke("get_backdrop_available"): boolean;
```

Rust clamps the region count (64) and the values; an empty list hides the blur window.

## Frontend

- `src/platform/backdrop.ts`: a region registry. Panels call `useBackdropRegion(ref)`. One
  `requestAnimationFrame` loop runs while at least one element is registered: it reads each
  element's `getBoundingClientRect()`, its corner radius (computed `border-top-left-radius`,
  percentages resolved against the width, scaled by the element's on-screen/layout size ratio) and
  effective opacity (own × ancestors' computed opacity, `visibility`, `display`), drops elements
  with zero size or opacity, rounds, and sends the list only when it differs from the last one sent.
- Root attribute `data-world-blur="on" | "off"` on the overlay's `<html>`, set from
  availability × setting. Each panel's CSS keeps the dense fill as the default and adds the CS2 fill
  under `[data-world-blur="on"]`.
- Settings: `overlay.worldBlur: boolean` (default true) and `overlay.worldBlurStrength: 1 | 2 | 3`
  (default 1), shown in the home window's system settings.
- Mock (`dev:mock`): `data-world-blur="on"` and page boxes with `backdrop-filter: blur(σ)` under
  registered panels as a stand-in, so screenshots over the preview background compare like with
  like (allowed only as this stand-in, gated on the mock mode).

## Fills with the blur on

| Panel | Blur-on fill | Source |
| --- | --- | --- |
| Scoreboard | `rgba(0,0,0,0.6)` + dot grid | the look accepted in game 2026-10-21 (0.46 black over DWM acrylic tinted 0x40) on a clean blur; capture fit 0.31-0.41 of the blurred world |
| Shop mask | unchanged veil; the page `backdrop-filter` keeps blurring SLUI's HUD under it | tuned with the user in game |
| Others | Panorama value (e.g. `hud-blur-bg-color` `#000000a0`), corrected by capture where the spec already records one | per child |

The dense fills stay as the `off` values.

## Risks and checks

- FPS cost: capture copies each game frame; measured in game as a same-spot A/B (blur on/off) in
  the core child's test. If capture while idle costs, the 5 s idle stop already limits it to
  moments with a blurred panel on screen.
- Latency: the blur trails the game by 0-1 composed frames (spike); a panel's first appearance
  after an idle stop waits for the capture's first frame (the panel draws its fill meanwhile).
- Elevated or protected game windows cannot be captured: availability turns false, dense fills.
- Present mode: the blur window, like the overlay, keeps the game composed; checked with the FPS A/B.

## Rollback

The setting off (or `available = false`) restores today's rendering exactly. Reverting a child's PR
removes its panels' registration without touching the others.
