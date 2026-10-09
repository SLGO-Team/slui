/**
 * SLUI-drawn stand-ins for the generic Source 2 particle textures the CS2 kill effects use. Each is a small analytic
 * model fitted to the luminance profile measured on the game's texture (reference only; nothing is copied): radial
 * or axial falloffs, evaluated once into an RGBA float image: the colour in linear light (the game decodes its sRGB
 * textures; the alpha channel is stored linear) and the alpha. Colour and alpha stay apart because the spritecard
 * shader saturates overbright x colour before it multiplies by alpha. Most of these textures are white; the
 * basic_flare and yellowflare ones are warm (an orange falloff around a white-hot core), which gives the beam its
 * orange halo under the team colour. The renderer tints the panel with the team colour at the end.
 */

export type ParticleTextureName =
  | "glow05" // particle_glow_05 (lineglow_lvl5)
  | "glow04" // sprites/glow04 (lineglow_lvl3): a flat core to r 0.05, wider skirt
  | "flare" // yellowflare: a square hot core to 0.17 with a faint square skirt
  | "rays" // basic_flare_rays / basic_flare sequence 2: a point core, faint rays and one bright diagonal streak
  | "raysTrail" // killid's ray layer: basic_flare_rays turned 45 degrees and zoomed 3x, times base_trail
  | "raysRing" // glow: basic_flare sequence 2 times particle_ring_wave_8
  | "raysFaintRing" // glow: basic_flare sequence 3 (thin rays only, ~2 % bright) times particle_ring_wave_8
  | "lens" // particle_anamorphic_lens: a horizontal line ~1 % thick
  | "streakFlare" // particle_flare_007b: a soft core with faint diagonal streaks
  | "beam" // killid: simple_lines_01 edge lines plus soft_gradient (texture blend ADD), across x along
  | "crack" // beam_crack_02 rope, across x along
  | "smoke" // beam_smoke_01 rope, across x along
  | "disc" // glow_simple_01 (masks): a disc to r 0.55 with a soft rim
  | "white"; // a solid quad (untextured ropes)

/** Interleaved linear RGB and alpha per texel. */
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
/**
 * Warm textures' colour, as green / red and blue / red in linear light against the texel's luminance: orange through
 * the falloff, white where the core clips. Measured on basic_flare (rays) and yellowflare.
 */
type Chroma = { green: (luminance: number) => number; blue: (luminance: number) => number };
const BASIC_FLARE_CHROMA: Chroma = {
  green: profile([[0.002, 0.76], [0.005, 0.71], [0.017, 0.67], [0.055, 0.64], [0.173, 0.62], [0.424, 0.63], [0.693, 0.71], [0.872, 0.88], [0.98, 1]]),
  blue: profile([[0.002, 0.58], [0.005, 0.51], [0.017, 0.42], [0.055, 0.37], [0.173, 0.35], [0.424, 0.35], [0.693, 0.41], [0.872, 0.56], [0.98, 0.91]]),
};
const YELLOWFLARE_CHROMA: Chroma = {
  green: profile([[0.002, 0.79], [0.005, 0.69], [0.017, 0.64], [0.055, 0.59], [0.173, 0.56], [0.424, 0.68], [0.693, 0.8], [0.872, 0.91], [0.98, 0.99]]),
  blue: profile([[0.002, 0.66], [0.005, 0.51], [0.017, 0.43], [0.055, 0.36], [0.173, 0.33], [0.424, 0.48], [0.693, 0.66], [0.872, 0.82], [0.98, 0.95]]),
};
/**
 * base_trail (the trail renderers' default texture): a teardrop along v, a bright blob at v 0.7-0.85 with a thin
 * tail towards v 0.3 over a wide soft skirt, colour in linear light. Each row is three gaussians across u (widths
 * 0.06, 0.28 and 0.7) whose amplitudes, measured per row, are these profiles over v (0 = the head end); clipped at 1.
 */
const trailRows = (rows: readonly (readonly [number, number, number, number])[]) =>
  [1, 2, 3].map((column) => profile(rows.map((row) => [row[0], row[column]] as const)));
const BASE_TRAIL = trailRows([
  [0, 0, 0, 0], [0.04, 0.001, 0, 0.003], [0.1, 0.011, 0, 0.041], [0.16, 0.008, 0, 0.052], [0.22, 0.009, 0, 0.063],
  [0.28, 0.023, 0, 0.076], [0.34, 0.048, 0.036, 0.099], [0.4, 0.1, 0.098, 0.136], [0.46, 0.111, 0.162, 0.186],
  [0.52, 0.218, 0.203, 0.24], [0.58, 0.352, 0.283, 0.263], [0.64, 0.289, 0.521, 0.245], [0.7, 0, 0.904, 0.196],
  [0.76, 0, 1.066, 0.144], [0.82, 0, 1.058, 0.045], [0.88, 0.066, 0.555, 0.005], [0.94, 0.006, 0.099, 0], [0.98, 0, 0, 0],
]);
/**
 * base_trail as killid's ray layer multiplies it: colour only. Multiplying its alpha as well (VRF's MIX_RGBA reading)
 * leaves the recorded halo beside the beam 4-15x too dim on kills 4 and 5; the colour alone matches it.
 */
function baseTrail(u: number, v: number): readonly [number, number] {
  const along = (v + 1) / 2;
  const across = (width: number) => Math.exp(-((u / width) ** 2));
  return [Math.min(1, BASE_TRAIL[0](along) * across(0.06) + BASE_TRAIL[1](along) * across(0.28) + BASE_TRAIL[2](along) * across(0.7)), 1];
}
/**
 * particle_ring_wave_8 (glow's second texture layer, multiplied): a lopsided swirl, a bright ring at r 0.5-0.6 open
 * towards the lower right, a dimmer centre with two dark spots. Its mean linear luminance over r (0.05 steps from
 * 0.025), times an angular gain per ring band (24 steps from -180 degrees, v down) blended between band centres.
 */
const RING_WAVE_RADIAL = profile([0.17, 0.18, 0.171, 0.159, 0.152, 0.138, 0.136, 0.162, 0.219, 0.305, 0.421, 0.445, 0.381, 0.28, 0.18, 0.103, 0.055, 0.027, 0.012, 0.005, 0]
  .map((value, index) => [0.025 + index * 0.05, value] as const));
const RING_WAVE_BANDS: readonly (readonly [number, readonly number[]])[] = [
  [0.1, [1.03, 1.12, 1.22, 1.28, 1.22, 1.08, 0.89, 0.58, 0.35, 0.24, 0.31, 0.6, 0.82, 1.06, 1.51, 1.77, 1.62, 1.38, 1.15, 1.03, 0.97, 0.91, 0.93, 0.97]],
  [0.29, [0.26, 0.55, 1.38, 2.21, 2.66, 2.5, 2.01, 1.62, 1.46, 1.38, 1.13, 0.84, 0.88, 1.32, 1.34, 0.72, 0.39, 0.25, 0.2, 0.23, 0.23, 0.17, 0.13, 0.15]],
  [0.54, [0.98, 1.18, 1.7, 1.51, 1.64, 1.87, 1.56, 1.11, 1.19, 1.66, 1.68, 0.81, 0.32, 0.2, 0.06, 0.02, 0.01, 0.02, 0.12, 0.61, 0.76, 1.44, 1.98, 1.59]],
  [0.8, [1.35, 1.42, 1.08, 0.68, 0.65, 0.8, 0.97, 1.11, 1.86, 2.95, 2.98, 2.66, 1.1, 0.25, 0.07, 0.03, 0.02, 0.03, 0.07, 0.15, 0.3, 0.93, 1.26, 1.3]],
];
function ringWave(u: number, v: number): readonly [number, number] {
  const r = Math.hypot(u, v);
  // Angle bins are centred 7.5 degrees after their start; interpolate around the circle.
  const position = ((Math.atan2(v, u) + Math.PI) / (Math.PI * 2)) * 24 - 0.5;
  const gainAt = (gains: readonly number[]) => {
    const index = Math.floor(position);
    const fraction = position - index;
    return gains[(index + 24) % 24] * (1 - fraction) + gains[(index + 25) % 24] * fraction;
  };
  let gain = gainAt(RING_WAVE_BANDS[RING_WAVE_BANDS.length - 1][1]);
  if (r <= RING_WAVE_BANDS[0][0]) gain = gainAt(RING_WAVE_BANDS[0][1]);
  for (let band = 1; band < RING_WAVE_BANDS.length; band += 1) {
    const [r0, gains0] = RING_WAVE_BANDS[band - 1];
    const [r1, gains1] = RING_WAVE_BANDS[band];
    if (r > r0 && r <= r1) gain = gainAt(gains0) + ((gainAt(gains1) - gainAt(gains0)) * (r - r0)) / (r1 - r0);
  }
  return [RING_WAVE_RADIAL(r) * gain, 1];
}
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
 * Fills a float image from `texel(u, v)` = [colour luminance, alpha] with u, v in -1..1 (centre 0; v grows
 * downwards). A plain number is an opaque colour (alpha 1). The colour is white, or `chroma` at the same luminance.
 * `multiply` is a second, white texture layer multiplied in (SPRITECARD_TEXTURE_BLEND_MULTIPLY): [colour, alpha].
 */
function paint(
  width: number,
  height: number,
  texel: (u: number, v: number) => number | readonly [number, number],
  chroma?: Chroma,
  multiply?: (u: number, v: number) => readonly [number, number],
): TextureData {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = ((x + 0.5) / width) * 2 - 1;
      const v = ((y + 0.5) / height) * 2 - 1;
      const value = texel(u, v);
      const [luminance, alpha] = typeof value === "number" ? [Math.max(0, value), 1] : [Math.max(0, value[0]), value[1]];
      const [layerColor, layerAlpha] = multiply ? multiply(u, v) : [1, 1];
      const green = chroma ? chroma.green(luminance) : 1;
      const blue = chroma ? chroma.blue(luminance) : 1;
      // Rec. 709 weights, as the luminance profiles were measured.
      const red = (luminance / (0.2126 + 0.7152 * green + 0.0722 * blue)) * layerColor;
      const offset = (y * width + x) * 4;
      data[offset] = red;
      data[offset + 1] = red * green;
      data[offset + 2] = red * blue;
      data[offset + 3] = Math.max(0, alpha * layerAlpha);
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
      }, YELLOWFLARE_CHROMA);
    case "rays":
      return paint(256, 256, raysLum, BASIC_FLARE_CHROMA);
    case "raysTrail":
      // Source (u, v) = target turned -45 degrees, so the target's v axis lands on the u = v diagonal, then divided by
      // m_flFinalTextureScaleU/V 3: the card shows only the texture's central third. The renderer's second texture
      // input is empty, so it is the default base_trail, multiplied over the card as is: it keeps the warm glow to a
      // narrow halo along the beam above its foot.
      return paint(128, 256, (u, v) => raysLum((u + v) / Math.SQRT2 / 3, (v - u) / Math.SQRT2 / 3), BASIC_FLARE_CHROMA, baseTrail);
    // glow's two texture layers: the basic_flare frame, multiplied by particle_ring_wave_8 (blend mode MULTIPLY,
    // the default), which leaves mostly a lopsided ring of the flare's light.
    case "raysRing":
      return paint(256, 256, raysLum, BASIC_FLARE_CHROMA, ringWave);
    case "raysFaintRing": {
      const rays = rayField(11, 80, 0.8);
      return paint(128, 128, (u, v) => 0.022 * Math.max(0, 1 - Math.hypot(u, v) / 0.95) * rays(Math.atan2(v, u)), undefined, ringWave);
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
