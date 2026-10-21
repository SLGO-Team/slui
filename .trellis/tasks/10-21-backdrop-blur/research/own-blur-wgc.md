# DWM blur refresh rate, and an own blur through Windows.Graphics.Capture (2026-10-21)

## Problem found in game

The first in-game test of the core child (DWM accent backdrop under the scoreboard) looked right
while still, but the user saw the blurred background stutter while turning the camera, with
acrylic and with plain BLURBEHIND alike.

## Measurement

Spike tool `measure` mode (`spikes/backdrop-blur`, branch `spike/backdrop-blur`, local only):
DXGI desktop duplication of a strip just left of the scoreboard rect (plain game) and a strip
inside its left padding (blurred game), 8 s while the user holds CapsLock and turns the camera at
2560x1600 / 165 Hz. "Updates" = composed frames in which the strip changed.

| Run | Game outside | Blur inside | Blur lag after a game change (composed frames) |
| --- | --- | --- | --- |
| SLUI (debug, mock) + DWM BLURBEHIND backdrop | 81.6/s | **29.0/s** (every ~35 ms) | 2-4 |
| Spike backdrop only (no SLUI), DWM BLURBEHIND | 125.6/s | **31.0/s** | 2-4 |
| Spike own blur (WGC + GPU), no SLUI | 90.5/s | **82.6/s** (median gap 12.1 ms = game's 11.9 ms) | 0-1 (458 of 502) |

- DWM refreshes accent blur at about 30 Hz over a running game, whatever the accent and with or
  without SLUI. This matches a built-in DirectComposition backdrop frame-rate limit that only a DWM
  hook (DWMBlurGlass's "Disable Dcomp framerate limit") removes. Hooking dwm.exe is out of
  question for a distributed app (admin rights, per-build offsets, system-wide effect, AV/anti-cheat).
  The 2026-10-20 spike missed it: it measured lag of band flips, not update rate.
- The own blur follows every game frame. The user confirmed it is smooth in game.
- Game frame rates differ between runs because the scene differed; the FPS cost of each approach
  is not measured yet (open item, same-spot A/B needed).

## Own blur, as built in the spike (`wgc` mode)

- `GraphicsCaptureItem` for the game HWND (`IGraphicsCaptureItemInterop::CreateForWindow`),
  free-threaded `Direct3D11CaptureFramePool` (2 buffers, recreated on resize),
  `SetIsCursorCaptureEnabled(false)`, `SetMinUpdateInterval(1 ms)`.
- Capture border: `GraphicsCaptureAccess::RequestAccessAsync(Borderless)` returned Allowed (4) for
  the unpackaged exe on Windows 11 26200, and `SetIsBorderRequired(false)` succeeded: no yellow
  border. (Windows 10 has no borderless capture.)
- GPU, per frame on the capture callback: copy the panel rect plus a 3σ margin (clamped to the
  window) into a 3-mip texture, `GenerateMips`, horizontal then vertical Gaussian at 1/4
  resolution (σ/4), bilinear upscale into the panel-size swap chain, `Present(0)`. CPU time
  0.13-0.18 ms per frame; σ is free (not stuck at DWM's 30 px).
- Output window: `WS_POPUP`, ex `NOREDIRECTIONBITMAP | TOPMOST | TOOLWINDOW | NOACTIVATE | LAYERED |
  TRANSPARENT`, `LWA_ALPHA 255`, DirectComposition target + visual + composition swap chain
  (FLIP_SEQUENTIAL, alpha ignored). `WindowFromPoint` at its centre returned the game: click-through
  works in game.
- The capture only sees the game window, so the overlay and the blur window never feed back.

## Consequences for the design

- Replace the DWM accent backdrop with this pipeline; the page side (region registry,
  `data-world-blur`, settings, mock stand-in) stays.
- DirectComposition can clip each region's visual to a rounded rect of any radius
  (`IDCompositionRectangleClip`), including circles, and fade it (visual opacity), which also
  settles the shaped child's open question.
- Availability no longer depends on Windows transparency effects or energy saver; it depends on
  borderless capture being allowed (Windows 11) and the capture session starting.
- Tone: no DWM tint or noise. Fills over the blur are retuned from the captures (the scoreboard
  look accepted earlier was 0.46 black over acrylic tinted 0x40 ≈ 0.6 black over a clean blur).
- Strength: σ in px can follow CS2's fit (35-55 px at 1080p, scaled with height) or the setting.
