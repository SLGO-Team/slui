/**
 * SLUI-drawn stand-ins for the generic Source 2 particle textures the CS2 kill effects use. Each is a small analytic
 * model fitted to the luminance profile measured on the game's texture (reference only; nothing is copied): radial
 * or axial falloffs, evaluated once into a two-channel float image: the colour's luminance in linear light (the game
 * decodes its sRGB textures; the alpha channel is stored linear) and the alpha. The two stay apart because the
 * spritecard shader saturates overbright x colour before it multiplies by alpha. The renderer tints the panel with
 * the team colour at the end.
 */

export type ParticleTextureName =
  | "glow05" // particle_glow_05 (lineglow_lvl5)
  | "glow04" // sprites/glow04 (lineglow_lvl3): a flat core to r 0.05, wider skirt
  | "flare" // yellowflare: a square hot core to 0.17 with a faint square skirt
  | "rays" // basic_flare_rays / basic_flare sequence 2: a point core, faint rays and one bright diagonal streak
  | "raysTrail" // basic_flare_rays with the UV turned 45 degrees (killid): the streak along v
  | "raysFaint" // basic_flare sequence 3: thin rays only, ~2 % bright
  | "lens" // particle_anamorphic_lens: a horizontal line ~1 % thick
  | "streakFlare" // particle_flare_007b: a soft core with faint diagonal streaks
  | "beam" // killid: simple_lines_01 edge lines plus soft_gradient (texture blend ADD), across x along
  | "crack" // beam_crack_02 rope, across x along
  | "smoke" // beam_smoke_01 rope, across x along
  | "disc" // glow_simple_01 (masks): a disc to r 0.55 with a soft rim
  | "white"; // a solid quad (untextured ropes)

/** Interleaved colour luminance and alpha per texel. */
export type TextureData = { width: number; height: number; data: Float32Array };

/** Piecewise-linear profile through `[x, y]` points. */
function profile(points: readonly (readonly [number, number])[]): (x: number) => number {
  return (x) => {
    if (x <= points[0][0]) return points[0][1];
    for (let index = 1; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      if (x <= x1) {
        const [x0, y0] = points[index - 1];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return points[points.length - 1][1];
  };
}

/** Radial profiles (r in half-sizes), measured on the game's textures: colour (linear) and alpha. */
const GLOW05_COLOR = profile([[0, 0.963], [0.02, 0.928], [0.05, 0.759], [0.1, 0.472], [0.15, 0.283], [0.2, 0.176], [0.3, 0.058], [0.4, 0.028], [0.5, 0.013], [0.6, 0.005], [0.7, 0.002], [0.8, 0]]);
const GLOW05_ALPHA = profile([[0, 0.99], [0.02, 0.971], [0.05, 0.886], [0.1, 0.718], [0.15, 0.569], [0.2, 0.451], [0.3, 0.271], [0.4, 0.176], [0.5, 0.11], [0.6, 0.063], [0.7, 0.027], [0.8, 0.004], [0.9, 0]]);
const GLOW04 = profile([[0, 0.955], [0.05, 0.955], [0.1, 0.798], [0.15, 0.527], [0.2, 0.368], [0.3, 0.181], [0.4, 0.083], [0.5, 0.045], [0.6, 0.026], [0.7, 0.014], [0.8, 0.006], [0.9, 0.003], [1, 0]]);
const STREAK_COLOR = profile([[0, 1], [0.02, 0.905], [0.05, 0.662], [0.1, 0.369], [0.15, 0.123], [0.2, 0.057], [0.3, 0.015], [0.4, 0.003], [0.5, 0]]);
const STREAK_ALPHA = profile([[0, 1], [0.02, 0.975], [0.05, 0.908], [0.1, 0.839], [0.15, 0.541], [0.2, 0.373], [0.3, 0.196], [0.4, 0.086], [0.5, 0]]);
const RAYS_GLOW = profile([[0, 1], [0.02, 0.804], [0.05, 0.251], [0.1, 0.121], [0.15, 0.074], [0.2, 0.051], [0.3, 0.026], [0.4, 0.014], [0.5, 0.007], [0.6, 0.004], [0.7, 0.003], [0.8, 0.001], [0.9, 0]]);
/** The diagonal streak of basic_flare_rays along its length (centre line), linear. */
const RAYS_STREAK = profile([[0, 1], [0.03, 0.98], [0.1, 0.75], [0.25, 0.19], [0.4, 0.058], [0.6, 0.011], [0.8, 0.001], [0.9, 0]]);
const DISC = profile([[0, 0.949], [0.5, 0.949], [0.55, 0.8], [0.6, 0.325], [0.7, 0.094], [0.8, 0.043], [0.9, 0.02], [1, 0]]);
/** Lens line brightness along its length (u). */
const LENS_ALONG = profile([[0, 0.79], [0.2, 0.77], [0.4, 0.7], [0.5, 0.62], [0.6, 0.49], [0.7, 0.34], [0.8, 0.15], [0.9, 0.01], [1, 0]]);
/** soft_gradient across the trail. */
const GRADIENT_ACROSS = profile([[0, 0], [0.12, 0], [0.19, 0.149], [0.25, 0.321], [0.31, 0.424], [0.37, 0.452], [0.69, 0.452], [0.75, 0.339], [0.81, 0.173], [0.875, 0.028], [0.94, 0]]);
/** Rope textures across their width (0..1, 17 samples): colour and alpha. */
const acrossProfile = (values: readonly number[]) => profile(values.map((value, index) => [index / (values.length - 1), value] as const));
const SMOKE_COLOR = acrossProfile([0, 0.001, 0.01, 0.035, 0.055, 0.093, 0.157, 0.221, 0.217, 0.185, 0.133, 0.087, 0.054, 0.028, 0.009, 0.002, 0]);
const SMOKE_ALPHA = acrossProfile([0, 0.03, 0.112, 0.194, 0.25, 0.327, 0.418, 0.476, 0.461, 0.431, 0.379, 0.315, 0.252, 0.185, 0.111, 0.044, 0]);
const CRACK_COLOR = acrossProfile([0.003, 0.019, 0.032, 0.066, 0.177, 0.346, 0.679, 0.919, 0.858, 0.506, 0.266, 0.194, 0.086, 0.03, 0.022, 0.007, 0.001]);
const CRACK_ALPHA = acrossProfile([0.025, 0.08, 0.105, 0.156, 0.285, 0.463, 0.739, 0.945, 0.891, 0.572, 0.359, 0.292, 0.159, 0.088, 0.079, 0.037, 0.012]);

/** Deterministic random numbers so the procedural detail is the same every run. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100_000) / 100_000;
  };
}

/** Faint radial rays: a per-angle gain around 1, smoothed over neighbouring rays. */
function rayField(seed: number, count: number, depth: number): (angle: number) => number {
  const next = random(seed);
  const rays = Array.from({ length: count }, () => ({ angle: next() * Math.PI * 2, width: 0.01 + next() * 0.03, gain: next() }));
  return (angle) => {
    let sum = 0;
    for (const ray of rays) {
      let delta = Math.abs(angle - ray.angle);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      sum += ray.gain * Math.exp(-((delta / ray.width) ** 2));
    }
    return Math.max(0, 1 - depth + depth * sum);
  };
}

/**
 * Fills a float image from `texel(u, v)` = [colour, alpha] with u, v in -1..1 (centre 0; v grows downwards). A plain
 * number is an opaque colour (alpha 1).
 */
function paint(width: number, height: number, texel: (u: number, v: number) => number | readonly [number, number]): TextureData {
  const data = new Float32Array(width * height * 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = texel(((x + 0.5) / width) * 2 - 1, ((y + 0.5) / height) * 2 - 1);
      const [color, alpha] = typeof value === "number" ? [value, 1] : value;
      data[(y * width + x) * 2] = Math.max(0, color);
      data[(y * width + x) * 2 + 1] = Math.max(0, alpha);
    }
  }
  return { width, height, data };
}

/** A white texture whose shape is all in its alpha (lens, gradients, lines, the mask disc). */
const alphaOnly = (alpha: number) => [1, alpha] as const;

/** Distance from the UL-LR image diagonal (u = v) and position along it. */
const diagonal = (u: number, v: number) => ({ along: Math.abs(u + v) / Math.SQRT2, across: Math.abs(u - v) / Math.SQRT2 });

const RAYS = rayField(7, 60, 0.35);
/** basic_flare_rays: the streak, a ~0.009 wide gaussian along the UL-LR diagonal, over the rayed glow. */
function raysLum(u: number, v: number): number {
  const { along, across } = diagonal(u, v);
  const streak = RAYS_STREAK(along) * Math.exp(-((across / 0.009) ** 2));
  return Math.max(streak, RAYS_GLOW(Math.hypot(u, v)) * RAYS(Math.atan2(v, u)));
}

function draw(name: ParticleTextureName): TextureData {
  switch (name) {
    case "glow05":
      return paint(128, 128, (u, v) => [GLOW05_COLOR(Math.hypot(u, v)), GLOW05_ALPHA(Math.hypot(u, v))]);
    case "glow04":
      return paint(128, 128, (u, v) => GLOW04(Math.hypot(u, v)));
    case "flare":
      // A 3 x 3 block of ~0.92 (to 0.17 of the half-size), a ring of ~0.12 to 0.3 and ~0.02 to 0.45, all square.
      return paint(64, 64, (u, v) => {
        const r = Math.max(Math.abs(u), Math.abs(v));
        return r < 0.17 ? 0.92 : r < 0.3 ? 0.12 : r < 0.45 ? 0.02 : r < 0.6 ? 0.008 : 0;
      });
    case "rays":
      return paint(256, 256, raysLum);
    case "raysTrail":
      // Source (u, v) = target turned -45 degrees, so the target's v axis lands on the u = v diagonal.
      return paint(128, 256, (u, v) => raysLum((u + v) / Math.SQRT2, (v - u) / Math.SQRT2));
    case "raysFaint": {
      const rays = rayField(11, 80, 0.8);
      return paint(128, 128, (u, v) => 0.022 * Math.max(0, 1 - Math.hypot(u, v) / 0.95) * rays(Math.atan2(v, u)));
    }
    case "lens":
      // Across: a ~1.2 px core of 256 (0.8 peak) over a faint ~6 px skirt; tall enough to resolve the core.
      return paint(64, 512, (u, v) => alphaOnly(LENS_ALONG(Math.abs(u)) * (Math.exp(-((v / 0.008) ** 2)) + 0.18 * Math.exp(-((v / 0.04) ** 2)))));
    case "streakFlare":
      // A soft core and one faint diagonal streak (colour ~0.09 / alpha ~0.48 at 0.2 along it).
      return paint(128, 128, (u, v) => {
        const r = Math.hypot(u, v);
        const { along, across } = diagonal(u, v);
        const streak = Math.max(0, 1 - along / 0.6) * Math.exp(-((across / 0.012) ** 2));
        return [Math.max(STREAK_COLOR(r), 0.14 * streak * Math.exp(-along / 0.12)), Math.max(STREAK_ALPHA(r), 0.7 * streak)];
      });
    case "beam":
      // u across (0..1), v along (0 = head, at the cards): simple_lines_01's dim line at 0.125 and bright line at
      // 0.875 around soft_gradient's band (normalised). Along, the recording shows the column saturated for 70 % of
      // its length and fading over the rest (it hides soft_gradient's own ramp), so that fade is fitted on it.
      return paint(128, 256, (u, v) => {
        const across = (u + 1) / 2;
        const along = (v + 1) / 2;
        const lines = 0.37 * Math.exp(-(((across - 0.125) / 0.006) ** 2)) + 0.99 * Math.exp(-(((across - 0.875) / 0.006) ** 2));
        const fade = along < 0.7 ? 1 : Math.exp(-(along - 0.7) / 0.05);
        // Both layers are white, so after the saturate their alphas add up (texture blend ADD).
        return alphaOnly((lines + GRADIENT_ACROSS(across) / 0.452) * fade);
      });
    case "crack": {
      const next = random(5);
      const breaks = Array.from({ length: 24 }, () => 0.5 + next());
      return paint(64, 128, (u, v) => {
        const gain = breaks[Math.floor(((v + 1) / 2) * breaks.length) % breaks.length];
        return [CRACK_COLOR((u + 1) / 2) * gain, Math.min(1, CRACK_ALPHA((u + 1) / 2) * gain)];
      });
    }
    case "smoke":
      return paint(64, 64, (u) => [SMOKE_COLOR((u + 1) / 2), SMOKE_ALPHA((u + 1) / 2)]);
    case "disc":
      return paint(128, 128, (u, v) => alphaOnly(DISC(Math.hypot(u, v))));
    case "white":
      return paint(1, 1, () => alphaOnly(1));
  }
}

const cache = new Map<ParticleTextureName, TextureData>();

export function particleTexture(name: ParticleTextureName): TextureData {
  let texture = cache.get(name);
  if (!texture) {
    texture = draw(name);
    cache.set(name, texture);
  }
  return texture;
}
