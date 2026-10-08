/**
 * SLUI-drawn stand-ins for the generic Source 2 particle textures the CS2 kill effects use. Each is an analytic
 * function fitted to the luminance profile measured on the game's texture (reference only; nothing is copied):
 * radial or axial falloffs, drawn pixel by pixel as white with alpha into an off-screen canvas once. The renderer
 * tints them with the team colour.
 */

export type ParticleTextureName =
  | "glow" // particle_glow_05: lum = exp(-r / 0.12), r in half-sizes (measured 0.84 / 0.52 / 0.21 / 0.03 at r 0.04 / 0.1 / 0.2 / 0.4)
  | "flare" // yellowflare: a hard bright core to r 0.2 with a faint skirt
  | "rays" // basic_flare_rays: a small core and thin radial rays fading as exp(-r / 0.25)
  | "lens" // particle_anamorphic_lens: a full-width line ~2 % of the size thick, 0.8 bright, tapering at the ends
  | "streakFlare" // particle_flare_007b: gaussian core exp(-(r / 0.13)^2) with one faint diagonal streak
  | "beam"; // soft_gradient + simple_lines_01: a flat band with two thin bright edges, fading along its length

const SIZE = 256;
const cache = new Map<ParticleTextureName, HTMLCanvasElement>();

/** Deterministic random numbers so the rays look the same every run. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100_000) / 100_000;
  };
}

/** Fills a canvas from `lum(u, v)` with u, v in -1..1 (centre 0). */
function paint(width: number, height: number, lum: (u: number, v: number) => number): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const ctx = element.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = ((x + 0.5) / width) * 2 - 1;
      const v = ((y + 0.5) / height) * 2 - 1;
      const value = Math.max(0, Math.min(1, lum(u, v)));
      const offset = (y * width + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(value * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return element;
}

function draw(name: ParticleTextureName): HTMLCanvasElement {
  switch (name) {
    case "glow":
      return paint(SIZE, SIZE, (u, v) => Math.exp(-Math.hypot(u, v) / 0.12));
    case "flare":
      return paint(64, 64, (u, v) => {
        const r = Math.hypot(u, v);
        return r < 0.16 ? 1 : 0.85 * Math.exp(-(r - 0.16) / 0.05) + 0.2 * Math.exp(-r / 0.25);
      });
    case "rays": {
      const next = random(7);
      const rays = Array.from({ length: 140 }, () => ({ angle: next() * Math.PI * 2, width: 0.004 + next() * 0.012, gain: 0.3 + next() * 0.7 }));
      return paint(SIZE, SIZE, (u, v) => {
        const r = Math.hypot(u, v);
        if (r > 1) return 0;
        const angle = Math.atan2(v, u);
        let ray = 0;
        for (const candidate of rays) {
          let delta = Math.abs(angle - candidate.angle);
          if (delta > Math.PI) delta = Math.PI * 2 - delta;
          const across = delta * r;
          if (across < candidate.width * 3) ray = Math.max(ray, candidate.gain * Math.exp(-((across / candidate.width) ** 2)));
        }
        return Math.exp(-r / 0.03) + 0.55 * ray * Math.exp(-r / 0.25);
      });
    }
    case "lens":
      return paint(SIZE, SIZE, (u, v) => 0.8 * Math.max(0, 1 - Math.abs(u) ** 2.5) * Math.exp(-((v / 0.022) ** 2)));
    case "streakFlare":
      return paint(SIZE, SIZE, (u, v) => {
        const core = Math.exp(-((Math.hypot(u, v) / 0.13) ** 2));
        const along = (u - v) / Math.SQRT2;
        const across = (u + v) / Math.SQRT2;
        const streak = 0.35 * Math.max(0, 1 - Math.abs(along)) * Math.exp(-((across / 0.01) ** 2));
        return core + streak;
      });
    case "beam":
      // Across (u): a flat 0.55 band to |u| 0.6 that falls off by 0.95, plus two thin bright edge lines;
      // along (v, -1 at the far end, 1 at the root): soft_gradient's 0.55 -> 0.05 fade.
      return paint(64, 256, (u, v) => {
        const across = Math.abs(u) < 0.6 ? 1 : Math.max(0, 1 - (Math.abs(u) - 0.6) / 0.35);
        const edges = Math.exp(-(((Math.abs(u) - 0.82) / 0.05) ** 2));
        const along = Math.max(0, (v + 1) / 2) ** 1.4;
        return (0.55 * across + 0.6 * edges) * along;
      });
  }
}

export function particleTexture(name: ParticleTextureName): HTMLCanvasElement {
  let texture = cache.get(name);
  if (!texture) {
    texture = draw(name);
    cache.set(name, texture);
  }
  return texture;
}
