# Effective Gaussian sigma of CS2's world blur under the scoreboard, from a 1920x1080 capture of the
# scoreboard (the 2026-10-19 captures: game area at (2, 45) of a 1924x1127 window; captures stay local).
# A strip just inside the panel padding should equal a + b * gaussian(sigma) of the strip just outside.
# Usage: python -I cs2-world-blur-fit.py <capture.webp>
import sys
import numpy as np
from PIL import Image

def gauss_blur_1d(v, sigma):
    if sigma <= 0:
        return v.copy()
    r = int(np.ceil(4 * sigma))
    x = np.arange(-r, r + 1)
    k = np.exp(-x * x / (2 * sigma * sigma)); k /= k.sum()
    pad = np.pad(v, r, mode='edge')
    return np.convolve(pad, k, mode='valid')

def box(v, n):
    k = np.ones(n) / n
    pad = np.pad(v, n // 2, mode='edge')
    return np.convolve(pad, k, mode='valid')[: len(v)]

def fit(inside, outside, margin):
    best = None
    rows = []
    for sigma in np.arange(0, 120.5, 1.0):
        b = gauss_blur_1d(outside, sigma)[margin:-margin]
        y = inside[margin:-margin]
        A = np.vstack([np.ones_like(b), b]).T
        coef, res, *_ = np.linalg.lstsq(A, y, rcond=None)
        pred = A @ coef
        r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        rows.append((sigma, r2, coef[1]))
        if best is None or r2 > best[1]:
            best = (sigma, r2, coef[0], coef[1])
    return best, rows

path = sys.argv[1]
im = np.asarray(Image.open(path).convert('RGB')).astype(float)[45:1125, 2:1922]
lum = im.mean(axis=2)
print(path.split('/')[-1], lum.shape)
cases = {
    # name: (inside rows/cols, outside rows/cols, axis range)
    'top    (x 500..1420)': ('h', (281, 296), (260, 275), (500, 1420)),
    'bottom (x 500..1250)': ('h', (848, 860), (865, 880), (500, 1250)),
    'left   (y 300..850)': ('v', (482, 498), (460, 476), (300, 850)),
    'right  (y 300..850)': ('v', (1422, 1438), (1444, 1460), (300, 850)),
}
for name, (kind, ins, outs, rng) in cases.items():
    if kind == 'h':
        inside = lum[ins[0]:ins[1], rng[0]:rng[1]].mean(axis=0)
        outside = lum[outs[0]:outs[1], rng[0]:rng[1]].mean(axis=0)
    else:
        inside = lum[rng[0]:rng[1], ins[0]:ins[1]].mean(axis=1)
        outside = lum[rng[0]:rng[1], outs[0]:outs[1]].mean(axis=1)
    inside = box(inside, 7)  # remove the ~3.4px dot texture
    (sigma, r2, a, b), rows = fit(inside, outside, 40)
    curve = ' '.join(f'{s:.0f}:{r:.2f}' for s, r, _ in rows if s in (0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100))
    print(f'  {name}: best sigma {sigma:.0f}px  R2 {r2:.3f}  inside = {a:.1f} + {b:.3f} * blurred outside   | R2 by sigma {curve}')
    print(f'      inside mean {inside.mean():.1f} std {inside.std():.2f}, outside mean {outside.mean():.1f} std {outside.std():.2f}')
