# Shapes of the shaped and small panels under the own world blur (2026-10-21)

The PRD's first step asked whether a backdrop can be clipped to a circle (per-pixel-alpha layered
window, `DwmEnableBlurBehindWindow` region). That question belonged to the DWM design; with SLUI's own
blur (Windows.Graphics.Capture + GPU, parent design revised 2026-10-21) every region is masked in the
shader, so no window shape is involved.

| Panel | Shape | How |
| --- | --- | --- |
| Bottom HUD centre circle (`.bhud__disc`) | circle, 62 px | rounded-rect mask with radius = half the side (`border-radius: 50%` read from CSS) |
| Radar viewport, round / square | circle 250 px / square 290 px | same; the square has radius 0 |
| Kill cards (`.bhud-card__body`) | rounded rect 32.3 x 44.4, r 4.6, turned -24° to 24° about the circle centre | new region `angle`: the page reads the element's transforms down from the root (`DOMMatrix`), sends the unturned box about the bounding rect's centre; the shader evaluates the rounded rect in the turned frame and draws into the bounds |
| Team counter equipment (`.hud-player__equipment-background`) | 56 x 204 (160 dead), vertical fade mask, reveal by `clip-path: inset(0 0 X% 0)` | new region `fade`: 16 samples of `fade-mask.svg` (`sampleFade`) evenly spaced over the element's height, linear between them in the shader; the page shrinks the box by the computed `inset()` clip and offsets the fade so it stays on the element |

Checked in the mock preview (stand-in boxes with `rotate()` and a gradient mask built from the same
region data) at 1920x1080: the cards' blur stays inside each turned card, the equipment blur fades
with the fill. The shader compiles (`backdrop::platform::tests::shaders_compile`); the in-game look is
the user's review.

Region count: ten equipment panels, six cards, the circle, the radar, three message boxes, the
progress card, up to ~8 killfeed rows, the win panel and the scoreboard stay under the 64 cap.
