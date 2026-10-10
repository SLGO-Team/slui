import type { PanelRenderer } from "./gl.ts";
import type { ParticleTextureName } from "./textures.ts";

/**
 * A small particle engine for CS2's kill-streak effects (particles/ui/ammohealthcenter/ui_hud_kill_streaks_*),
 * ported system by system from the game's particle definitions: the same emitters, initialisers, operators and
 * renderer settings, with SLUI-drawn textures. The HUD renders them in a 900 x 500 particle panel whose camera
 * sits 600 units in front of the origin with a 41 degree horizontal field of view (hudhealthammocenter.xml), so
 * one world unit is 2.005 px and z = 28 is the HUD line; +x points left on screen.
 *
 * Source 2 conventions used here: lifespans in seconds, `bias(x, b) = x / ((1 - x)(1 / b - 2) + 1)`, FadeAndKill fades
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

/** The camera: 600 units in front of the particles' plane, level with z 127 (the panel's centre line). */
const CAMERA_DISTANCE = 600;
const CAMERA_Z = 127;
/**
 * A point `depth` units nearer the camera than the particles' plane (y = depth): perspective pushes it away from the
 * view centre by 600 / (600 - depth).
 */
export const toScreenNear = (x: number, z: number, depth: number) => {
  const scale = CAMERA_DISTANCE / (CAMERA_DISTANCE - depth);
  const centerY = toScreenY(CAMERA_Z);
  return [CENTER_X + (toScreenX(x) - CENTER_X) * scale, centerY + (toScreenY(z) - centerY) * scale] as const;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
/** The engine's bias curve (0.5 is the identity). */
export function bias(x: number, b: number): number {
  if (b <= 0) return 0;
  if (b >= 1) return 1;
  return x / ((1 - x) * (1 / b - 2) + 1);
}
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

/** `x` wrapped into 0..period (PF_INPUT_MODE_LOOPED). */
export const loop = (x: number, period: number) => x - Math.floor(x / period) * period;

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
  /** Creation index (Source 2 PARTICLE_NUMBER; the systems' curves over it loop, PF_INPUT_MODE_LOOPED). */
  number: number;
  born: number;
  life: number;
  /** Seconds since creation, as of the last step. */
  seconds: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius0: number;
  radius: number;
  alpha0: number;
  alpha: number;
  /** Particle colour, linear RGB (the panel's wash multiplies it by the team colour). */
  color: Rgb;
  /** The colour at creation (ColorInterpolate fades from it). */
  color0: Rgb;
  rotation: number;
  texture: ParticleTextureName;
  /** Trail target and length factor (beam). */
  trailX: number;
  trailZ: number;
  trail0: number;
  trail: number;
};

export type Rgb = readonly [number, number, number];
export const WHITE: Rgb = [1, 1, 1];

export type RenderPass = {
  /** "sequence": the particle's own texture (RandomSequence). */
  texture: ParticleTextureName | "sequence";
  radiusScale: number;
  overbright: number;
  /** Sprites are squares; trails stretch the texture from the particle towards its target. */
  kind: "sprite" | "trail";
  lengthScale?: number;
  forwardShift?: number;
  /** m_flLengthFadeInTime: a trail grows to its length over this many seconds of the particle's age. */
  lengthFadeIn?: number;
  /** m_flDesaturation: pulls particle colour x texture colour towards its luminance (1: grey). */
  desaturation?: number;
  /** m_bSaturateColorPreAlphaBlend (default on): overbright x colour clips at 1 before the alpha. */
  saturate?: boolean;
  /** m_flAddSelfAmount: the colour is scaled by 1 + this after the saturate. */
  addSelf?: number;
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

export function newParticle(number: number, born: number): Particle {
  return {
    number, born, life: 1, seconds: 0, x: 0, z: 0, vx: 0, vz: 0, radius0: 1, radius: 1, alpha0: 1, alpha: 1, color: WHITE, color0: WHITE, rotation: 0,
    texture: "glow05", trailX: 0, trailZ: 0, trail0: 0, trail: 0,
  };
}

/** One running particle system. */
export class ParticleSystem {
  private readonly particles: Particle[] = [];
  private emitted = 0;
  /** Particles the continuous emitter has made. */
  private continuous = 0;
  private lastT: number | null = null;
  private readonly spec: SystemSpec;
  private readonly random: () => number;

  constructor(spec: SystemSpec, seed: number) {
    this.spec = spec;
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
      const particle = newParticle(this.emitted, bornAt);
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
      // The k-th particle is due at k / rate, and only before the emission ends (killid: 8 per second for 0.25 s
      // makes one, at 0.125 s, as the recording's beam steps show).
      for (let due = (this.continuous + 1) / spec.rate; due <= local && due < spec.duration; due = (this.continuous + 1) / spec.rate) {
        this.continuous += 1;
        spawn(due);
      }
    }
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.seconds = local - particle.born;
      const age = particle.seconds / particle.life;
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

  draw(renderer: PanelRenderer): void {
    for (const pass of this.spec.passes) {
      for (const particle of this.particles) {
        const texture = pass.texture === "sequence" ? particle.texture : pass.texture;
        const alpha = particle.alpha * (1 + (pass.addSelf ?? 0));
        if (alpha <= 1e-4) continue;
        const paint = { color: scale(srgbToLinear(particle.color), pass.overbright), alpha, saturate: pass.saturate ?? true, desaturation: pass.desaturation ?? 0 };
        const x = toScreenX(particle.x);
        const y = toScreenY(particle.z);
        if (pass.kind === "sprite") {
          // Source 2 roll turns the sprite counter-clockwise as seen from the camera.
          renderer.sprite(texture, x, y, particle.radius * pass.radiusScale * UNIT, (particle.rotation * Math.PI) / 180, paint);
          continue;
        }
        // A trail from the particle (head, texture v = 0) towards its target, as wide as the particle's diameter.
        const tx = toScreenX(particle.trailX);
        const ty = toScreenY(particle.trailZ);
        const distance = Math.hypot(tx - x, ty - y);
        if (distance < 1e-3) continue;
        const fadeIn = pass.lengthFadeIn ? Math.min(1, particle.seconds / pass.lengthFadeIn) : 1;
        const length = distance * particle.trail * (pass.lengthScale ?? 1) * fadeIn;
        // m_flConstrainRadiusToLengthRatio (1): a trail is never wider than it is long.
        const half = Math.min(particle.radius * pass.radiusScale * UNIT, length);
        const ax = (tx - x) / distance;
        const ay = (ty - y) / distance;
        // m_flForwardShift moves the trail towards the head by that share of its length.
        const shift = (pass.forwardShift ?? 0) * length;
        const hx = x - ax * shift;
        const hy = y - ay * shift;
        const ex = hx + ax * length;
        const ey = hy + ay * length;
        // Across (-ay, ax) is the trail's left when looking from head to tail; texture u runs right to left.
        renderer.quad(texture, [
          [hx + ay * half, hy - ax * half], [hx - ay * half, hy + ax * half],
          [ex - ay * half, ey + ax * half], [ex + ay * half, ey - ax * half],
        ], paint);
      }
    }
  }
}

/**
 * A colour attribute decoded from sRGB, as the renderers draw it (m_bGammaCorrectVertexColors, on by default): the
 * pale blue starbursts are a third as bright in red as their 8-bit value says.
 */
export const srgbToLinear = ([r, g, b]: Rgb): Rgb => {
  const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [decode(r), decode(g), decode(b)];
};

/** A particle colour scaled by `strength` (the overbright factor). */
const scale = ([r, g, b]: Rgb, strength: number): Rgb => [r * strength, g * strength, b * strength];

/**
 * Exposure of the panel's tone map, 1 - e^(-exposure x light): CS2 blends the overbright particles in linear HDR and
 * tone-maps the panel, so overlaps compress instead of clipping. Calibrated on the recording.
 */
export const PANEL_EXPOSURE = 1.5;

export { clamp01, lerp };
