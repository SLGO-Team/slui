# Design: native world blur under HUD panels

Shared by all three children. Measurements and API findings: `research/dwm-backdrop-blur.md`.
Panel list: `research/cs2-world-blur-sources.md`.

## Shape

```
SCP:SL window
  └ backdrop windows (one per region × layer, accent blur)   ← new, Rust module `backdrop`
      └ overlay window (WebView2, layered, transparent)       ← panels draw their fill on top
```

The overlay page owns *where* blur is needed (it knows what it renders). Rust owns *how* (windows,
z-order, visibility, availability). One command and one event connect them.

## Native module (`src-tauri/src/backdrop.rs`, Windows only)

- **Window class**: `WS_POPUP`, ex `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED |
  WS_EX_TRANSPARENT` (+ `WS_EX_TOPMOST`), `LWA_ALPHA` per region, `WM_NCHITTEST → HTTRANSPARENT`,
  black client paint. Accent `ACCENT_ENABLE_BLURBEHIND` (3), flags 0, colour 0
  (`ACRYLICBLURBEHIND` gave the same image; BLURBEHIND stays in sync with game content more often
  in the spike). `DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE`. Corner via
  `DWMWA_WINDOW_CORNER_PREFERENCE` (square, small ≈ 4 px, round ≈ 8 px at 100 %).
- **Pool**: windows are created on the main thread once and reused; a region set that needs more
  windows grows the pool, fewer hides the extra ones. Never destroy-and-recreate per frame (first
  show of a new window is slower).
- **Layers**: `layers` (1-3) windows per region, stacked at the same rect.
- **Placement**: `SetWindowPos(backdrop, insert_after = overlay, …, SWP_NOACTIVATE)` so every
  backdrop sits directly below the overlay. Re-place after anything that re-asserts the overlay's
  topmost position (`apply_overlay_input_mode`).
- **Coordinates**: regions arrive in overlay CSS px. Physical rect = overlay window origin +
  round(css × overlay scale factor). Recomputed when the overlay moves (`align_overlay_to`).
- **Visibility**: backdrops are visible only when all hold: the overlay may show
  (`overlay_may_show`), the blur is available, the setting is on, the region list is non-empty.
  `sync_overlay_visibility` and `hide_overlay_window` drive them in the same pass as the overlay.
- **Availability**: a poll on the existing foreground thread (every 2 s) reads
  `HKCU\…\Themes\Personalize\EnableTransparency` and the energy-saver state
  (`GetSystemPowerStatus().SystemStatusFlag`), and checks that `SetWindowCompositionAttribute`
  resolves. Changes emit `slgo-backdrop-available { available: bool }` and hide backdrops at once
  when it turns false.
- Non-Windows: the command is a no-op and availability is always false.

## Command and event

```ts
// overlay → Rust, sent only when the list changes (at most once per animation frame)
invoke("set_backdrop_regions", { regions: BackdropRegion[] });
type BackdropRegion = { x: number; y: number; w: number; h: number;   // overlay CSS px
                        corner: "square" | "small" | "round"; alpha: number /* 0-1 */ };

invoke("set_backdrop_options", { enabled: boolean; layers: 1 | 2 | 3 });  // from settings
listen("slgo-backdrop-available", ({ available }) => …);
invoke("get_backdrop_available"): boolean;
```

Rust clamps the region count (64) and the values; an empty list hides all backdrops.

## Frontend

- `src/platform/backdrop.ts`: a region registry. Panels call `useBackdropRegion(ref, { corner })`.
  One `requestAnimationFrame` loop runs while at least one element is registered: it reads each
  element's `getBoundingClientRect()` and effective opacity (own × ancestors' computed opacity,
  `visibility`, `display`), drops elements with zero size or opacity, rounds to whole px, and sends
  the list only when it differs from the last one sent. A panel that moves or fades is followed
  frame by frame; a still panel costs one layout read per frame and no IPC.
- Root attribute `data-world-blur="on" | "off"` on the overlay's `<html>`, set from
  availability × setting. Each panel's CSS keeps the dense fill as the default and adds the CS2 fill
  under `[data-world-blur="on"]`.
- Settings: `overlay.worldBlur: boolean` (default true) and `overlay.worldBlurLayers: 1 | 2 | 3`
  (default 1) in `OverlaySettings`, shown in the home window's system settings. Older settings files
  fall back per field (existing rule).
- Mock (`dev:mock`): `data-world-blur="on"` and a stand-in `::before` with
  `backdrop-filter: blur(30px)` under registered panels, so screenshots over the preview background
  compare like with like. The spec rule against `backdrop-filter` in the mock is narrowed: allowed
  only as this stand-in, gated on the mock mode.

## Fills with the blur on

| Panel | Blur-on fill | Source |
| --- | --- | --- |
| Scoreboard | `rgba(0,0,0,0.46)` + dot grid | capture fit, accepted in game 2026-10-21 |
| Others | Panorama value (e.g. `hud-blur-bg-color` `#000000a0`), corrected by capture where the spec already records one | per child |

The dense fills stay as the `off` values.

## Risks and checks

- `SetWindowCompositionAttribute` is undocumented; availability falls back to dense fills if the
  call fails.
- Circles (bottom HUD centre circle, round radar): DWM corners stop at ≈ 8 px and `SetWindowRgn`
  does not clip the blur. The shaped child starts with a short check of per-pixel-alpha layered
  windows (`UpdateLayeredWindow`) and `DwmEnableBlurBehindWindow` regions; if neither clips, those
  two use the nearest square/rounded rect or stay unblurred, decided with the user.
- Present mode: whether a backdrop moves SCP:SL out of independent flip is checked with PresentMon
  in the core child's in-game test.
- IPC per frame during animations: bounded by "send on change"; measured in the core child.

## Rollback

The setting off (or `available = false`) restores today's rendering exactly. Reverting a child's PR
removes its panels' registration without touching the others.
