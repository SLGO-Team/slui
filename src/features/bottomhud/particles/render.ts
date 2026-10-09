import { ParticleSystem, curve, toScreenX, toScreenY, UNIT, clamp01 } from "./engine.ts";
import type { PanelRenderer } from "./gl.ts";
import { killEffect, MASK_SECONDS, ringColor, type CardsMask } from "./systems.ts";

/** How long a kill's particles run (kill 5: radiate emits for 2 s, each starburst lives 1 s). */
export const KILL_PARTICLE_SECONDS = 3.1;

/**
 * circle_flash: rope segments on a ring of radius 15 around the circle, 150 per second for 1 s, each living 1 s,
 * drawn by two rope renderers (beam_crack_02 at radius x0.5, beam_smoke_01 at x0.8, both overbright 2).
 */
function drawRingFlash(renderer: PanelRenderer, t: number, seed: number) {
  const cx = toScreenX(0);
  const cy = toScreenY(28);
  const radius = 15 * UNIT;
  const step = (Math.PI * 2) / 30;
  const count = Math.floor(Math.min(t, 1) * 150);
  for (let index = 1; index < count; index += 1) {
    const age = t - index / 150;
    if (age < 0 || age >= 1) continue;
    const number = clamp01(curve([[0, 0], [5.204, 0.154], [10, 1]], index));
    const alpha = number * curve([[0, 0], [0.043, 0.63], [0.151, 0.97], [0.274, 0.549], [0.795, 0]], age);
    if (alpha <= 0.002) continue;
    const width = 6 * curve([[0, 0], [0.043, 1.26], [0.151, 1.939], [0.274, 1.099], [1, 0.21]], age) * curve([[0, 1], [0.856, 1], [1, 0]], index / 150);
    const color = ringColor(seed, index, age);
    const a0 = -(index - 1) * step;
    const a1 = -index * step;
    const p0 = [cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius] as const;
    const p1 = [cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius] as const;
    // beam_crack_02 is alpha-blended (the renderer's default), beam_smoke_01 additive; both overbright 2, saturated.
    for (const [texture, scale, blend] of [["crack", 0.5, "alpha"], ["smoke", 0.8, "add"]] as const) {
      const half = width * scale * UNIT;
      // Rope normal: radial at the segment's middle.
      const mid = (a0 + a1) / 2;
      const nx = Math.cos(mid) * half;
      const ny = Math.sin(mid) * half;
      renderer.quad(texture, [[p0[0] + nx, p0[1] + ny], [p0[0] - nx, p0[1] - ny], [p1[0] - nx, p1[1] - ny], [p1[0] + nx, p1[1] + ny]],
        { color: [color[0] * 2, color[1] * 2, color[2] * 2], alpha, saturate: true }, blend);
    }
  }
}

/** The occluders' paint: opaque black, alpha-blended. */
const BLACK = { color: [0, 0, 0] as const, alpha: 1, saturate: true };

/** motion: a black rope of radius 20 between the path ends (110, 8) and (-110, 8), under the line. */
function drawMotionMask(renderer: PanelRenderer) {
  const left = toScreenX(110);
  const right = toScreenX(-110);
  const top = toScreenY(28);
  const bottom = toScreenY(-12);
  renderer.quad("white", [[left, top], [right, top], [right, bottom], [left, bottom]], BLACK, "alpha");
}

/** circlemsk: three black glow_simple_01 sprites of radius 25 on the circle, each drawn by two renderers. */
function drawCircleMask(renderer: PanelRenderer) {
  for (let index = 0; index < 6; index += 1) renderer.sprite("disc", toScreenX(0), toScreenY(28), 25 * UNIT, 0, BLACK, "alpha");
}

/**
 * cards_mask: a glow_simple_01 trail of radius x2 from z 20 to 20 + 45 x 1.05, its head (bottom) narrowed by the
 * taper; like every trail no wider than it is long (m_flConstrainRadiusToLengthRatio 1), so 47.25 units at most.
 */
function drawCardsMask(renderer: PanelRenderer, mask: CardsMask) {
  const cx = toScreenX(0);
  const head = toScreenY(20);
  const length = 45 * 1.05;
  const tail = toScreenY(20 + length);
  const half = Math.min(mask.radius * 2, length) * UNIT;
  const headHalf = half * mask.taper;
  renderer.quad("disc", [[cx - half, tail], [cx + half, tail], [cx + headHalf, head], [cx - headHalf, head]], BLACK, "alpha");
}

/** One kill's particles; `paint(renderer, t)` draws the moment `t` seconds after the kill into the panel. */
export function createKillParticles(count: number, seed: number) {
  const layers = killEffect(count).map((layer, index) => (layer.kind === "system" ? { ...layer, system: new ParticleSystem(layer.spec, seed * 31 + index) } : layer));
  return (renderer: PanelRenderer, t: number) => {
    const masks = t < MASK_SECONDS;
    for (const layer of layers) {
      if (layer.kind === "system") {
        layer.system.step(t);
        layer.system.draw(renderer);
      } else if (layer.kind === "ring") drawRingFlash(renderer, t, seed);
      else if (!masks) continue;
      else if (layer.kind === "motion") drawMotionMask(renderer);
      else if (layer.kind === "circleMask") drawCircleMask(renderer);
      else drawCardsMask(renderer, layer.mask);
    }
  };
}
