"""Renders public/assets/hud/dot-grid.png: a seamless 512x512 white dot grid
used as the HUD/shop panel texture (alpha carries the pattern).

Usage: python scripts/build-dot-grid.py   (requires numpy + Pillow)
"""

from pathlib import Path

import numpy as np
from PIL import Image

SIZE = 512
COLUMNS, ROWS = 109, 111  # whole numbers of dots per tile keep the texture seamless
RADIUS = 1.33  # px; matches the panel texture density (mean alpha ~0.26)
SUPERSAMPLE = 8
OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "hud" / "dot-grid.png"


def coverage(count: int) -> np.ndarray:
    """Per-pixel distance (px) to the nearest dot centre along one axis, supersampled."""
    samples = (np.arange(SIZE * SUPERSAMPLE) + 0.5) / SUPERSAMPLE
    pitch = SIZE / count
    offset = (samples - pitch / 2) % pitch
    return np.minimum(offset, pitch - offset)


def main() -> None:
    dx = coverage(COLUMNS)[None, :]
    dy = coverage(ROWS)[:, None]
    inside = (dx * dx + dy * dy) <= RADIUS * RADIUS
    alpha = inside.reshape(SIZE, SUPERSAMPLE, SIZE, SUPERSAMPLE).mean(axis=(1, 3))
    rgba = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = np.round(alpha * 255).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(OUT, optimize=True)
    print(f"{OUT.name}: mean alpha {alpha.mean():.3f}")


if __name__ == "__main__":
    main()
