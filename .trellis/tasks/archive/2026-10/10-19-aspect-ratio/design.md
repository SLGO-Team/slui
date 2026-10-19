# Design: aspect-ratio-aware overlay canvas

## Layout rule (`src/shared/overlay.ts`)

```text
scale        = height / 1080                     (1 when either dimension <= 0)
canvas width = min(1920, width / scale)          (design units; 1728 at 16:10, 1440 at 4:3)
canvas height = 1080
```

`overlayScaleForViewport` returns the new scale. At 16:9 and wider it equals today's
`min(width / 1920, height / 1080)`, so nothing changes there; only narrower viewports switch from
width-limited to height-based scaling.

## Canvas width in CSS, not JS

The canvas width follows from the scale the panel already receives, so each canvas rule computes it:

```css
width: min(1920px, 100vw / var(--<panel>-scale));
margin-left: calc(min(1920px, 100vw / var(--<panel>-scale)) / -2);
```

No new props or hooks; `useOverlayScale` callers stay as they are. The overlay window has no scrollbars,
so `100vw` is the window width. The shop canvas (`translateX(-50%)`) only needs the width.

## Panel anchors

| Panel | Panorama anchor | Change |
| --- | --- | --- |
| Team counter | centre, full width | none (`left: 0; width: 100%`, flex halves) |
| Radar | top-left 12 px | none |
| Killfeed | right 10 px | none |
| Chat | viewport bottom-left | none (scaled from the corner, not on a canvas) |
| Win panel | centre, full width | none (`left: 0; width: 100%`) |
| Bottom HUD `.bhud` | centre, 800 wide | `left: 560px` -> `calc(50% - 400px)` |
| Alerts / hints `.hudmsg` | centre, 300 wide | `left: 810px` -> `calc(50% - 150px)` |
| Progress card `.hudprogress` | centre, 500 wide | `left: 710px` -> `calc(50% - 250px)` |
| Buy menu | centre (`.buymenu__contents`) | canvas width only |

Elements nested inside these boxes keep their offsets (they are relative to the box).

## Compatibility

- 16:9: scale and canvas width are identical to today, the `calc(50% - n)` values resolve to the old
  pixel offsets on a 1920 canvas.
- Wider than 16:9: unchanged (canvas clamps to 1920).
- `hudScaleForViewport` stays an alias.

## Rollback

Revert the PR; the change is CSS plus one formula.
