import { particleTexture, type ParticleTextureName } from "./textures.ts";

/**
 * A small particle engine for CS2's kill-streak effects (particles/ui/ammohealthcenter/ui_hud_kill_streaks_*),
 * ported system by system from the game's particle definitions: the same emitters, initialisers, operators and
 * renderer settings, with SLUI-drawn textures. The HUD renders them in a 900 x 500 particle panel whose camera
 * sits 600 units in front of the origin with a 41 degree horizontal field of view (hudhealthammocenter.xml), so
 * one world unit is 2.005 px and z = 28 is the HUD line; +x points left on screen.
 *
 * Source 2 conventions used here: lifespans in seconds, `bias(x, b) = x ^ (ln b / ln 0.5)`, FadeAndKill fades
 * in over 0-0.5 of the life and out over 0.5-1 unless set, the continuous emitter's default rate is 100/s.
 */

/** Particle panel geometry in 1080p canvas pixels. */
export const PANEL_WIDTH = 900;
export const PANEL_HEIGHT = 500;
export const PANEL_LEFT = 510;
export const PANEL_TOP = 580;
/** World units to pixels (900px / (2 * 600 * tan 20.5deg)); a vertical field of view made every effect half the recorded size. */
export const UNIT = PANEL_WIDTH / (2 * 600 * Math.tan((20.5 * Math.PI) / 180));
/** The HUD line (z = 28) and the circle centre inside the panel. */
export const LINE_Y = 1028 - PANEL_TOP;
const CENTER_X = PANEL_WIDTH / 2;
const LINE_Z = 28;

export const toScreenX = (x: number) => CENTER_X - x * UNIT;
export const toScreenY = (z: number) => LINE_Y - (z - LINE_Z) * UNIT;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const bias = (x: number, b: number) => (b === 0.5 ? x : Math.pow(x, Math.log(b) / Math.log(0.5)));
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

/** Piecewise-linear lookup of a Source 2 curve (its spline points; the slopes are not needed at this size). */
export function curve(points: readonly (readonly [number, number])[], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    if (x <= x1) {
      const [x0, y0] = points[index - 1];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return points[points.length - 1][1];
}

/** Deterministic random numbers, so one kill always plays the same way. */
export function seededRandom(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100_000) / 100_000;
  };
}

export type Particle = {
  /** Pool slot when created (Source 2 PARTICLE_NUMBER), wrapping at the system's particle limit. */
  number: number;
  /** Creation order, for path assignment. */
  serial: number;
  born: number;
  life: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius0: number;
  radius: number;
  alpha0: number;
  alpha: number;
  /** Grey level of the particle colour (the panel's wash tints it with the team colour). */
  grey: number;
  rotation: number;
  texture: ParticleTextureName;
  /** Trail target and length factor (beam). */
  trailX: number;
  trailZ: number;
  trail0: number;
  trail: number;
};

export type RenderPass = {
  texture: ParticleTextureName;
  radiusScale: number;
  overbright: number;
  /** Sprites are squares; trails stretch the texture from the particle towards its target. */
  kind: "sprite" | "trail";
  lengthScale?: number;
};

export type SystemSpec = {
  name: string;
  /** Seconds after the kill the system starts. */
  delay: number;
  maxParticles: number;
  instant: number;
  rate: number;
  /** Continuous emission length in seconds (0 = none). */
  duration: number;
  init(particle: Particle, random: () => number, collectionAge: number): void;
  /** Called every frame with the particle's normalised age; returns false to kill it early. */
  update?(particle: Particle, age: number, dt: number): void;
  passes: readonly RenderPass[];
};

export function newParticle(number: number, serial: number, born: number): Particle {
  return {
    number, serial, born, life: 1, x: 0, z: 0, vx: 0, vz: 0, radius0: 1, radius: 1, alpha0: 1, alpha: 1, grey: 1, rotation: 0,
    texture: "glow", trailX: 0, trailZ: 0, trail0: 0, trail: 0,
  };
}

/** One running particle system. */
export class ParticleSystem {
  private readonly particles: Particle[] = [];
  private emitted = 0;
  private emitCarry = 0;
  private lastT: number | null = null;
  private readonly random: () => number;

  constructor(private readonly spec: SystemSpec, seed: number) {
    this.random = seededRandom(seed);
  }

  /** Advances to `t` seconds after the kill. */
  step(t: number): void {
    const local = t - this.spec.delay;
    if (local < 0) return;
    const previous = this.lastT ?? local;
    const dt = Math.max(0, Math.min(0.1, local - previous));
    this.lastT = local;
    const spec = this.spec;
    const spawn = (bornAt: number) => {
      if (this.particles.length >= spec.maxParticles) return;
      // PARTICLE_NUMBER: the slot in the system's pool, which wraps at the particle limit.
      const particle = newParticle(this.emitted % spec.maxParticles, this.emitted, bornAt);
      this.emitted += 1;
      spec.init(particle, this.random, bornAt);
      particle.radius = particle.radius0;
      particle.alpha = particle.alpha0;
      particle.trail = particle.trail0;
      this.particles.push(particle);
    };
    if (this.emitted === 0 && previous === local) {
      for (let index = 0; index < spec.instant; index += 1) spawn(0);
    }
    if (spec.duration > 0 && spec.rate > 0) {
      const from = Math.min(previous, spec.duration);
      const to = Math.min(local, spec.duration);
      this.emitCarry += (to - from) * spec.rate;
      while (this.emitCarry >= 1) {
        this.emitCarry -= 1;
        spawn(to);
      }
    }
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      const age = (local - particle.born) / particle.life;
      if (age >= 1) {
        this.particles.splice(index, 1);
        continue;
      }
      spec.update?.(particle, clamp01(age), dt);
    }
  }

  get done(): boolean {
    return this.lastT !== null && this.lastT > this.spec.duration && this.particles.length === 0 && this.emitted > 0;
  }

  draw(ctx: CanvasRenderingContext2D, tint: (name: ParticleTextureName) => HTMLCanvasElement): void {
    for (const pass of this.spec.passes) {
      const texture = tint(pass.texture);
      for (const particle of this.particles) {
        const strength = particle.alpha * particle.grey * pass.overbright;
        if (strength <= 0.002) continue;
        const x = toScreenX(particle.x);
        const y = toScreenY(particle.z);
        if (pass.kind === "sprite") {
          const size = particle.radius * pass.radiusScale * UNIT * 2;
          drawAdditive(ctx, texture, strength, () => {
            ctx.translate(x, y);
            ctx.rotate((-particle.rotation * Math.PI) / 180);
            ctx.drawImage(texture, -size / 2, -size / 2, size, size);
          });
        } else {
          // A band from the particle towards its target, as wide as the particle.
          const tx = toScreenX(particle.trailX);
          const ty = toScreenY(particle.trailZ);
          const length = Math.hypot(tx - x, ty - y) * particle.trail * (pass.lengthScale ?? 1);
          // Trail width: calibrated on the recording's ~45 px column (radius 18 at the start).
          const width = particle.radius * pass.radiusScale * UNIT * 1.25;
          const angle = Math.atan2(tx - x, -(ty - y));
          drawAdditive(ctx, texture, strength, () => {
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.drawImage(texture, -width / 2, -length, width, length);
          });
        }
      }
    }
  }
}

/**
 * Gain of the additive panel before tone mapping. CS2 adds the overbright particles in HDR and tone-maps the
 * panel; here they add at this gain into the 8-bit canvas and the canvas is tone-mapped by an SVG filter
 * (`TONE_TABLE`, (1 - e^(-4x)) / (1 - e^-4)), which lifts faint needles and compresses overlaps instead of clipping
 * them to white. Calibrated on the recording.
 */
export const PANEL_GAIN = 0.25;
export const TONE_TABLE = "0.000 0.225 0.401 0.537 0.644 0.727 0.791 0.842 0.881 0.911 0.935 0.954 0.968 0.979 0.988 0.995 1.000";

/** Additive draw; strengths above 1 (Source 2 overbright) stack extra passes. */
function drawAdditive(ctx: CanvasRenderingContext2D, _texture: HTMLCanvasElement, strength: number, paint: () => void) {
  let remaining = Math.min(strength * PANEL_GAIN, 3);
  while (remaining > 0.002) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, remaining);
    paint();
    ctx.restore();
    remaining -= 1;
  }
}

/** White textures tinted once per colour. */
export function tinter(color: string): (name: ParticleTextureName) => HTMLCanvasElement {
  const cache = new Map<ParticleTextureName, HTMLCanvasElement>();
  return (name) => {
    let tinted = cache.get(name);
    if (!tinted) {
      const source = particleTexture(name);
      tinted = document.createElement("canvas");
      tinted.width = source.width;
      tinted.height = source.height;
      const ctx = tinted.getContext("2d");
      if (ctx) {
        ctx.drawImage(source, 0, 0);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, tinted.width, tinted.height);
      }
      cache.set(name, tinted);
    }
    return tinted;
  };
}

export { clamp01, lerp };
