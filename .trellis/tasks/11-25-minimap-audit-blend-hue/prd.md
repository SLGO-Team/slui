# Minimap audit: judge the blend hue where both renders cover alike

Follow-up found while checking #122 locally (2026-11-25).

## Problem

`scripts/minimap-visual-audit.mjs` stopped at `map-blend a=0: the blend adds the world's colour, not the map's`
on this PC (headless Chrome), in both the pre-#122 and current builds, at one pixel (1920x1080 clip x 201,
y 96; on - off = [25, 73, 124]). Every later audit step (114 of 172 screenshots, most checks) never ran.

Pixel analysis: (201, 96) sits on a seam between two room tiles. Off, it and its neighbour (200, 96) are both
room coverage ~0.91; on, the lift layer (`minimap-radar__lift`, its own composited SVG group at
`liftOpacity` 0.376) covers (201, 96) only ~0.75 while (200, 96) stays 0.91. With unequal coverage, on - off is
`M·(c_on - c_off) + W·(c_off - peak·c_on)`: the map colour enters without any blend error. The hue check
assumed identical coverage in both shots, which only flat regions guarantee.

## Requirements

- Judge the hue strictly on pixels whose 3x3 neighbourhood is one colour in both shots; assert those are
  more than half the radar pixels (a wrong-colour blend would show there by the thousand).
- Edge / seam pixels keep the range check (0..W·(1 - max(a, peak))); hue misses there are counted as
  `edgeOffHue` with the first one in `edgeWorst` in `audit.json`.
- No rendering change.

## Acceptance Criteria

- [x] The full audit passes on this PC: 76 checks, 172 screenshots; a = 0 at 1920x1080 reports `edgeOffHue: 1`
      at (201, 96); ~80% of radar pixels are flat.
- [x] A deliberately wrong blend colour (`BLEND_WASH` not scaled by the peak) still fails the audit.
