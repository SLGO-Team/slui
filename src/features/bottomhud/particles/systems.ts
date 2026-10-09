import { bias, clamp01, curve, lerp, loop, seededRandom, WHITE, type Particle, type Rgb, type SystemSpec } from "./engine.ts";

export type { Particle };

/**
 * CS2's kill-streak particle systems (particles/ui/ammohealthcenter/ui_hud_kill_streaks_*.vpcf), ported field by
 * field. Values are the game's; fields a system leaves at the Source 2 default are filled with that default.
 * World units, +x is screen-left, z is up; the HUD line is z = 28.
 */

type Point = { x: number; z: number };

/** Path ends of the kill streak systems (CP1 / CP2) and the per-kill control points. */
const CP1: Point = { x: 110, z: 8 };
const CP2: Point = { x: -110, z: 8 };

type Level = {
  /** Beam root and tip (CP5, CP4). */
  beamFrom: Point;
  beamTo: Point;
  /** CP11.x: dims the beam (alpha 1 - 0.9 * v, flare overbright 5 * (1 - v)). */
  dim: number;
};

const LEVELS: Readonly<Record<1 | 2 | 3 | 4 | 5, Level>> = {
  1: { beamFrom: { x: 0, z: 30 }, beamTo: { x: 0, z: 90 }, dim: 0.9 },
  2: { beamFrom: { x: -1, z: 30 }, beamTo: { x: -8, z: 90 }, dim: 0.9 },
  3: { beamFrom: { x: -2, z: 30 }, beamTo: { x: -14.5, z: 90 }, dim: 0.9 },
  4: { beamFrom: { x: -3, z: 30 }, beamTo: { x: -22, z: 88 }, dim: 0.5 },
  5: { beamFrom: { x: -5, z: 30 }, beamTo: { x: -29, z: 88 }, dim: 0 },
};

const rand = (random: () => number, min: number, max: number) => min + (max - min) * random();
/** `PF_TYPE_RANDOM_BIASED` with a STANDARD bias parameter (-1..1, 0 is uniform). */
const randBiased = (random: () => number, min: number, max: number, parameter: number) => min + (max - min) * bias(random(), clamp01((parameter + 1) / 2));
type Srgb = readonly [number, number, number];
/**
 * A particle colour as the shader takes it: the 8-bit value / 255, not decoded (unlike textures). Decoding made the
 * pale blue sparks and starbursts teal over the gold wash, where the recording stays gold.
 */
function linear([r, g, b]: Srgb): Rgb {
  return [r / 255, g / 255, b / 255];
}
/** C_INIT_RandomColor between `min` (default white) and `max`. */
function randomColor(random: () => number, max: Srgb, min: Srgb = [255, 255, 255]): Rgb {
  const t = random();
  return linear([lerp(min[0], max[0], t), lerp(min[1], max[1], t), lerp(min[2], max[2], t)]);
}
/**
 * C_OP_ColorInterpolate: from the creation colour to `fade` over the age window `start` -> `end`, clamped (kill 2's
 * window runs backwards, 0.5 -> 0.2: the particles start at the fade colour and are back to their own by mid-life).
 */
function colorInterpolate(from: Rgb, fade: Rgb, age: number, start = 0, end = 1): Rgb {
  const t = clamp01((age - start) / (end - start));
  return [lerp(from[0], fade[0], t), lerp(from[1], fade[1], t), lerp(from[2], fade[2], t)];
}
const PALE_BLUE = [155, 205, 253] as const;
const GREY_137 = [137, 137, 137] as const;
const BLACK: Rgb = [0, 0, 0];

/** C_OP_BasicMovement drag, per 60 Hz step. */
const drag = (amount: number, dt: number) => Math.pow(1 - amount, dt * 30);

/** C_OP_FadeAndKill. */
function fadeAndKill(age: number, { startAlpha = 1, endAlpha = 0, startIn = 0, endIn = 0.5, startOut = 0.5, endOut = 1 } = {}): number {
  const smooth = (from: number, to: number) => {
    const t = clamp01((age - from) / (to - from));
    return t * t * (3 - 2 * t);
  };
  if (age < startIn) return startAlpha;
  if (age < endIn) return lerp(startAlpha, 1, smooth(startIn, endIn));
  if (age < startOut) return 1;
  return lerp(1, endAlpha, smooth(startOut, endOut));
}

/** C_OP_InterpolateRadius: the scale at `age` (before the window: start scale; after: end scale). */
function interpolateRadius(age: number, { start = 1, end = 1, from = 0, to = 1, b = 0.5 } = {}): number {
  return lerp(start, end, bias(clamp01((age - from) / (to - from)), b));
}

/** C_INIT_DistanceToCPInit (to CP0, the origin). */
function distanceRemap(distance: number, { inMin = 0, inMax = 128, outMin = 0, outMax = 1, b = 0.5 } = {}): number {
  const value = lerp(outMin, outMax, clamp01((distance - inMin) / (inMax - inMin)));
  // m_flRemapBias acts on the remapped value, clamped to 0..1 first (so lineglow_lvl5's 1.5 near the centre is 1).
  return b === 0.5 ? value : bias(clamp01(value), b);
}

/** C_INIT_CreateSequentialPathV2 with two points: particles alternate between the path ends. */
function sequentialEnd(particle: Particle, from: Point, to: Point): Point {
  return particle.number % 2 === 0 ? from : to;
}

function lineGlow(level: 2 | 3 | 5): SystemSpec {
  const params = level === 2
    ? { max: 35, duration: 0.8, radius: [10, 12], life: 1, color: PALE_BLUE, fade: linear([0, 255, 255]), rotation: [0, 90], warpMax: 0.2,
      warpCurve: [[0, 0], [9.824, 0.081], [29.011, 0.444], [50, 1]], dist: { inMin: 5, inMax: 50, outMin: 1.5, outMax: 0.1 }, radiusBias: 0.9,
      passes: [{ texture: "lens", radiusScale: 3, overbright: 2 }, { texture: "streakFlare", radiusScale: 3, overbright: 2 }] }
    : level === 3
      ? { max: 50, duration: 0.8, radius: [10, 12], life: 1, color: [166, 167, 169] as const, fade: null, rotation: [90, 90], warpMax: 0.5,
        warpCurve: [[0, 0], [14.893, 0.129], [35.607, 0.76], [50, 1]], dist: { inMax: 55, outMin: 1.5, outMax: 0, b: 0.45 }, radiusBias: 0.8,
        passes: [{ texture: "lens", radiusScale: 2, overbright: 1, desaturation: 0.5 }, { texture: "glow04", radiusScale: 2, overbright: 1, desaturation: 0.5 }] }
      : { max: 100, duration: 2, radius: [15, 15], life: 0.5, color: [206, 206, 206] as const, fade: linear([247, 247, 247]), rotation: [90, 90], warpMax: 0.55,
        warpCurve: [[0, 0], [13.353, 0.21], [35.607, 0.76], [50, 1]], dist: { inMax: 55, outMin: 1.5, outMax: 0.2, b: 0.29 }, radiusBias: 0.8,
        passes: [{ texture: "lens", radiusScale: 2, overbright: 1 }, { texture: "glow05", radiusScale: 2, overbright: 1 }] };
  return {
    name: `lineglow-${level}`,
    delay: 0,
    maxParticles: params.max,
    instant: 25,
    rate: 100,
    duration: params.duration,
    init(particle, random) {
      const end = sequentialEnd(particle, CP1, CP2);
      // The warp curve runs over particle numbers 0..50, looped: the needles sweep out from the centre every 50.
      const warp = lerp(0, params.warpMax, curve(params.warpCurve as [number, number][], loop(particle.number, 50)));
      particle.x = end.x * warp;
      particle.z = end.z + 20;
      particle.life = params.life;
      // DistanceToCPInit runs before the +20 offset, at the path height.
      particle.radius0 = rand(random, params.radius[0], params.radius[1]) * distanceRemap(Math.hypot(particle.x, end.z), params.dist);
      // rand[0, 90] with a GAIN bias of -0.9999 (kill 2) lands on either end: flat lines or needles.
      particle.rotation = random() < 0.5 ? params.rotation[0] : params.rotation[1];
      particle.color0 = randomColor(random, params.color);
      particle.color = particle.color0;
      particle.alpha0 = 1;
    },
    update(particle, age) {
      particle.radius = particle.radius0 * interpolateRadius(age, { start: 0.25, end: 2, b: params.radiusBias });
      particle.alpha = particle.alpha0 * fadeAndKill(age, { startAlpha: 0 });
      if (params.fade) particle.color = colorInterpolate(particle.color0, params.fade, age, 0.5, 0.2);
    },
    passes: params.passes.map((pass) => ({ ...pass, kind: "sprite" as const })) as SystemSpec["passes"],
  };
}

function glow(ace: boolean): SystemSpec {
  return {
    name: ace ? "glow-5" : "glow",
    delay: 0,
    maxParticles: 5,
    instant: 0,
    rate: 20,
    duration: 0.35,
    init(particle, random) {
      particle.z = 25;
      particle.life = randBiased(random, 0.5, 1, 0.45);
      particle.radius0 = rand(random, 50, 90);
      particle.rotation = rand(random, -100, -75);
      // RandomSequence 2..3 of basic_flare: the rayed flare or its faint thin-ray frame.
      particle.texture = random() < 0.5 ? "rays" : "raysFaint";
    },
    update(particle, age) {
      particle.radius = particle.radius0 * interpolateRadius(age, { start: 0.5, end: 1, b: 0.8 });
      particle.alpha = fadeAndKill(age, { startAlpha: 0, endIn: 0.1 });
    },
    passes: [{ kind: "sprite", texture: "sequence", radiusScale: ace ? 1.1 : 1, overbright: ace ? 4 : 2, desaturation: 1, saturate: false, addSelf: 1 }],
  };
}

/** Sparks rising from the line (splash / splash_many). */
function splash(many: boolean): SystemSpec {
  const warpCurve: [number, number][] = many ? [[0, 0], [24.651, 0.226], [213.641, 0.76], [300, 1]] : [[0, 0], [4.93, 0.226], [42.728, 0.76], [60, 1]];
  return {
    name: many ? "splash-many" : "splash",
    delay: 0,
    maxParticles: 100,
    instant: many ? 65 : 35,
    rate: 0,
    duration: 0,
    init(particle, random) {
      // C_INIT_CreateAlongPath: a random point between the path ends, then the x warp by creation order.
      const t = random();
      const x = lerp(CP1.x, CP2.x, t);
      particle.x = x * curve(warpCurve, particle.number);
      particle.z = 8;
      particle.vz = many ? rand(random, 0, 500) : rand(random, 30, 150);
      particle.life = many ? rand(random, 1, 1.5) : 2;
      // DistanceToCPInit runs before the warp, on the point along the path.
      particle.radius0 = rand(random, 5, 8) * 0.5 * distanceRemap(Math.hypot(x, 8), { inMin: 20, outMin: 1, outMax: 0.2 });
      particle.rotation = rand(random, 0, 180);
      particle.color0 = linear(PALE_BLUE);
    },
    update(particle, age, dt) {
      particle.color = colorInterpolate(particle.color0, BLACK, age);
      particle.vz = (particle.vz + 10 * dt) * drag(0.1, dt);
      particle.z += particle.vz * dt;
      const grow = interpolateRadius(age, { start: 0, end: 1, to: 0.2, b: 0.8 });
      const shrink = interpolateRadius(age, { start: 1, end: 0, from: 0.2, b: 0.8 });
      particle.radius = particle.radius0 * grow * shrink;
      particle.alpha = fadeAndKill(age, { endIn: 0.25 });
    },
    passes: [{ kind: "sprite", texture: "flare", radiusScale: many ? 2 : 1, overbright: 3, saturate: false }],
  };
}

/** Bright flares shooting up from the line (splash_cubes, kill 4; splash_cubes_lvl5, kill 5). */
function splashCubes(ace: boolean): SystemSpec {
  const half = ace ? 90 : 50;
  return {
    name: ace ? "splash-cubes-5" : "splash-cubes",
    delay: 0,
    maxParticles: 100,
    instant: ace ? 0 : 20,
    rate: ace ? 65 : 0,
    duration: ace ? 1.5 : 0,
    init(particle, random) {
      // Sequential path with 20 points between (half, 9) and (-half, 9).
      const slot = particle.number % 20;
      particle.x = lerp(half, -half, slot / 19);
      particle.z = 9;
      particle.vz = ace ? rand(random, 30, 150) : rand(random, 90, 400);
      particle.life = 1;
      particle.radius0 = 10 * 0.5 * distanceRemap(Math.hypot(particle.x, 9), { inMin: 20, outMin: 1, outMax: 0.2 });
      particle.color0 = randomColor(random, GREY_137);
    },
    update(particle, age, dt) {
      particle.color = colorInterpolate(particle.color0, BLACK, age);
      particle.vz = (particle.vz + 90 * dt) * drag(ace ? 0.1 : 0.15, dt);
      particle.z += particle.vz * dt;
      particle.radius = particle.radius0 * curve([[0, 0], [0.178, 2], [0.319, 0.808], [1, 0.63]], age);
      particle.alpha = fadeAndKill(age, { endIn: 0.25, startOut: 0.8 });
    },
    passes: [{ kind: "sprite", texture: "streakFlare", radiusScale: 2, overbright: 4, saturate: false }],
  };
}

/** Starbursts spreading along the line for two seconds (kill 5). */
function radiate(): SystemSpec {
  return {
    name: "radiate",
    delay: 0,
    maxParticles: 200,
    instant: 0,
    rate: 120,
    duration: 2,
    init(particle, random, collectionAge) {
      const end = sequentialEnd(particle, CP1, CP2);
      // PARTICLE_NUMBER remapped 0..90 -> 0..1, looped.
      const spread = loop(particle.number, 90) / 90;
      particle.x = end.x * spread;
      particle.z = end.z * lerp(1.2, 0.9, spread) + 22;
      particle.life = 1;
      // DistanceToCPInit runs after the +22 offset.
      const distance = Math.hypot(particle.x, particle.z);
      particle.radius0 = rand(random, 5, 10) * lerp(0.5, 1, clamp01(collectionAge / 0.5)) * distanceRemap(distance, { inMax: 100, outMin: 10, outMax: 0 });
      particle.alpha0 = distanceRemap(distance, { inMin: 60, inMax: 100, outMin: 1, outMax: 0 });
      particle.rotation = -45;
      particle.color = linear(PALE_BLUE);
    },
    update(particle, age) {
      const grow = interpolateRadius(age, { start: 0, end: 1, to: 0.2 });
      const shrink = interpolateRadius(age, { start: 1, end: 0, from: 0.2 });
      particle.radius = particle.radius0 * grow * shrink;
      particle.alpha = particle.alpha0 * fadeAndKill(age, { endIn: 0.25 });
    },
    passes: [{ kind: "sprite", texture: "rays", radiusScale: 1, overbright: 3, saturate: false }],
  };
}

/** The light column from behind the new card (killid): a gradient band with bright edges and a flare streak. */
function beam(level: Level): SystemSpec {
  return {
    name: "killid",
    delay: 0,
    maxParticles: 16,
    // m_nInitialParticles 3 plus the instantaneous emitter's 1.
    instant: 4,
    rate: 8,
    duration: 0.25,
    init(particle) {
      particle.x = level.beamFrom.x;
      particle.z = level.beamFrom.z;
      particle.trailX = level.beamTo.x;
      particle.trailZ = level.beamTo.z;
      particle.life = 1;
      particle.radius0 = 9;
      particle.alpha0 = 1 - 0.9 * level.dim;
      // The trail length is a literal 2.0 (its curve map does not apply to literals).
      particle.trail0 = 2;
    },
    update(particle, age) {
      particle.radius = particle.radius0 * interpolateRadius(age, { start: 2, end: 1.3, b: 0.9 });
      particle.alpha = particle.alpha0 * (age < 0.65 ? 1 : (1 - age) / 0.35);
      // The age curve (1.1 until 0.8, to 0 at the end); each renderer fades the length in over its own time.
      particle.trail = particle.trail0 * curve([[0, 1.1], [0.195, 1.1], [0.81, 1.093], [1, 0]], age);
    },
    passes: [
      { kind: "trail", texture: "beam", radiusScale: 1, overbright: 1, lengthFadeIn: 0.1 },
      // basic_flare_rays with its UV turned 45 degrees, so the streak runs along the trail, and zoomed 3x (its warm
      // core fills the card: the orange halo round the beam's foot); twice as long, shifted half a length towards the head.
      { kind: "trail", texture: "raysTrail", radiusScale: 3, overbright: 5 * (1 - level.dim), lengthScale: 2, forwardShift: 0.5, lengthFadeIn: 0.5 },
    ],
  };
}

/**
 * Occluders, alpha-blended black in game, all destroyed 2.0 s after the kill (StopAfterCPDuration). They only hide
 * the systems drawn before them, so the order of a kill's children matters (kill 5's beam, radiate and sparks come
 * after cards_mask and show over the cards):
 * - motion: a black band along the path under the line, so the effects only rise above it;
 * - circlemsk: a black disc over the circle (glow_simple_01, radius 25, at the line);
 * - cards_mask (kills 4 and 5): a black capsule from z 20 towards z 67 over the card fan, its width and head
 *   taper from CP10 (4: radius 25.4, taper 0.32; 5: radius 30, taper 0.26), drawn at radius scale 2.
 * When they vanish, what is still alive (kill 5: the radiate starbursts) shows whole, also under the line and over
 * the circle: the flash the recording shows 2.0 s after the fifth kill.
 */
export const MASK_SECONDS = 2;
export type CardsMask = { radius: number; taper: number };

/** One child of a kill's parent system, in the parent's order. */
export type Layer =
  | { kind: "system"; spec: SystemSpec }
  | { kind: "cardsMask"; mask: CardsMask }
  | { kind: "motion" }
  | { kind: "circleMask" }
  /** circle_flash: rope segments on a ring of radius 15 around the circle, 150 per second for 1 s. */
  | { kind: "ring" };

const system = (spec: SystemSpec): Layer => ({ kind: "system", spec });
const MOTION: Layer = { kind: "motion" };
const CIRCLE_MASK: Layer = { kind: "circleMask" };
const RING: Layer = { kind: "ring" };

/** The children CS2 plays for a kill, in order (ui_hud_kill_streaks_1..5, _many). */
export function killEffect(count: number): Layer[] {
  if (count >= 6) return [system(glow(false)), MOTION, CIRCLE_MASK, RING];
  const level = LEVELS[Math.max(1, count) as 1 | 2 | 3 | 4 | 5];
  switch (count) {
    case 1: return [system(beam(level)), MOTION, CIRCLE_MASK];
    case 2: return [system(lineGlow(2)), system(beam(level)), MOTION, CIRCLE_MASK, RING];
    case 3: return [system(glow(false)), system(lineGlow(3)), system(splash(false)), system(beam(level)), MOTION, CIRCLE_MASK];
    case 4: return [system(splashCubes(false)), system(glow(false)), { kind: "cardsMask", mask: { radius: 25.4, taper: 0.32 } }, system(beam(level)),
      system(lineGlow(3)), system(splash(false)), MOTION, CIRCLE_MASK, RING];
    default: return [system(glow(true)), system(lineGlow(5)), system(splashCubes(true)), { kind: "cardsMask", mask: { radius: 30, taper: 0.26 } },
      system(radiate()), system(beam(level)), system(splash(true)), MOTION, CIRCLE_MASK, RING];
  }
}

/** circle_flash's colour for rope segment `index`: RandomColor white..137 grey, then ColorInterpolate to white from 0.35. */
export function ringColor(seed: number, index: number, age: number): Rgb {
  const random = seededRandom(seed * 7919 + index);
  return colorInterpolate(randomColor(random, GREY_137), WHITE, age, 0.35);
}
