import { LINE_Y, PANEL_HEIGHT, PANEL_WIDTH, ParticleSystem, curve, tinter, toScreenX, toScreenY, UNIT, clamp01 } from "./engine.ts";
import { killEffect, MASK_SECONDS, type CardsMask } from "./systems.ts";

/** How long a kill's particles run (kill 5: radiate emits for 2 s, each starburst lives 1 s). */
export const KILL_PARTICLE_SECONDS = 3.1;

/** circle_flash: rope segments on a ring of radius 15 around the circle, 150 per second for 1 s, each living 1 s. */
function drawRingFlash(ctx: CanvasRenderingContext2D, t: number, color: string) {
  const cx = toScreenX(0);
  const cy = toScreenY(28);
  const radius = 15 * UNIT;
  const step = (Math.PI * 2) / 30;
  const count = Math.floor(Math.min(t, 1) * 150);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (let index = 1; index < count; index += 1) {
    const age = t - index / 150;
    if (age < 0 || age >= 1) continue;
    const number = clamp01(curve([[0, 0], [5.204, 0.154], [10, 1]], index));
    const alpha = number * curve([[0, 0], [0.043, 0.63], [0.151, 0.97], [0.274, 0.549], [0.795, 0]], age);
    if (alpha <= 0.01) continue;
    const width = 6 * curve([[0, 0], [0.043, 1.26], [0.151, 1.939], [0.274, 1.099], [1, 0.21]], age) * curve([[0, 1], [0.856, 1], [1, 0]], index / 150);
    // Two rope renderers (crack x0.5, smoke x0.8), both at overbright 2.
    for (const [scale, strength] of [[0.8, 1.2], [0.5, 1.6]] as const) {
      ctx.globalAlpha = Math.min(1, alpha * strength);
      ctx.lineWidth = width * scale * 2 * UNIT;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -(index - 1) * step, -index * step, true);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The black occluders of the first two seconds, punched out of the additive layer. */
function drawMasks(ctx: CanvasRenderingContext2D, cardsMask: CardsMask | null) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  // motion: everything under the line.
  ctx.fillRect(0, LINE_Y, PANEL_WIDTH, PANEL_HEIGHT - LINE_Y);
  // circlemsk: the circle (glow_simple_01's disc fills ~60 % of the 50-unit sprite).
  const cx = toScreenX(0);
  const disc = ctx.createRadialGradient(cx, LINE_Y, 0, cx, LINE_Y, 33);
  disc.addColorStop(0, "rgba(0,0,0,1)");
  disc.addColorStop(0.9, "rgba(0,0,0,1)");
  disc.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = disc;
  ctx.fillRect(cx - 33, LINE_Y - 33, 66, 66);
  if (cardsMask) {
    // cards_mask: a trail from its head at z 20 (tapered) to z 67 (length 45 x 1.05), wide at the top like the fan.
    const bottom = toScreenY(20);
    const top = toScreenY(20 + 45 * 1.05);
    const half = cardsMask.radius * UNIT * 0.6;
    const gradient = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.2, "rgba(0,0,0,1)");
    gradient.addColorStop(0.8, "rgba(0,0,0,1)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(cx - half * cardsMask.taper, bottom);
    ctx.lineTo(cx - half, top);
    ctx.lineTo(cx + half, top);
    ctx.lineTo(cx + half * cardsMask.taper, bottom);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** One kill's particles; `paint(t)` draws the moment `t` seconds after the kill into a panel-sized context. */
export function createKillParticles(count: number, seed: number, color: string) {
  const effect = killEffect(count);
  const systems = effect.systems.map((spec, index) => new ParticleSystem(spec, seed * 31 + index));
  const tint = tinter(color);
  return (ctx: CanvasRenderingContext2D, t: number) => {
    ctx.clearRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const system of systems) {
      system.step(t);
      system.draw(ctx, tint);
    }
    if (effect.ring) drawRingFlash(ctx, t, color);
    ctx.restore();
    if (t < MASK_SECONDS) drawMasks(ctx, effect.cardsMask);
  };
}
