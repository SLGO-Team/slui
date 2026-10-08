/**
 * The kill "spectrum" CS2 draws with a particle system (ui_hud_kill_streaks_base): needles along the strokes,
 * wide at the line and sharp at the tip, whose bases blur into one glow over a soft fog mound; they stay put from
 * frame to frame (no audio-visualiser bounce; the shape only grows, widens and fades), a glow behind the cards and
 * sparks rising above them. Recreated as a canvas drawn every animation frame from the time since the kill (recording,
 * research file "Kill burst"):
 *
 * kills 2-4  a one-sided haze mound around the circle that grows with the kill count, sparks 70-1000ms
 * kill 5     phase A (0-1s): the biggest mound, widening along the strokes; phase B (1-2s): it settles low and
 *            wide; phase C (2.0-2.7s): a flash, a mirrored spindle of bars above and below the line with a glow
 *            and tall streaks over the cards, then a thin waveform that fades by 3.0s
 *
 * Pure: `spectrumFrame` gives the envelopes for a moment, `drawKillSpectrum` paints them; the component only
 * owns the canvas and the clock.
 */

/** Canvas box around the circle centre, in 1080p canvas pixels. */
export const SPECTRUM_WIDTH = 640;
export const SPECTRUM_HEIGHT = 240;
/** The stroke line inside the canvas (the circle centre). */
export const SPECTRUM_LINE_Y = 160;
/** Column pitch of the haze outline and of the hair lines (recording: lines ~3px apart). */
const BAR_PITCH = 3;

/** One envelope of bars: peak height (px) at the centre and the gaussian half-width (px). */
type Lobe = { amp: number; sigma: number };

export type SpectrumFrame = {
  /** Bars rising above the line. */
  up: Lobe;
  /** Bars hanging below the line (only the kill-5 flash mirrors them). */
  down: Lobe;
  /** Soft glow behind the bars: opacity 0-1, horizontal and vertical radius. */
  glow: { alpha: number; rx: number; ry: number };
  /** Tall streaks over the cards (kill-5 flash), peak height. */
  streaks: number;
};

const NONE: SpectrumFrame = { up: { amp: 0, sigma: 1 }, down: { amp: 0, sigma: 1 }, glow: { alpha: 0, rx: 1, ry: 1 }, streaks: 0 };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
/** 0 before `start`, 1 after `end`, smooth in between. */
const ramp = (t: number, start: number, end: number) => {
  const x = clamp01((t - start) / (end - start));
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

/** How long a kill's spectrum lasts (ms). */
export function spectrumDurationMs(count: number): number {
  if (count === 5) return 3_000;
  if (count >= 2 && count <= 4) return 1_100;
  return 0;
}

/** Envelopes `t` ms after kill number `count` (2-5; others draw nothing). */
export function spectrumFrame(count: number, t: number): SpectrumFrame {
  if (count < 2 || count > 5 || t < 0 || t >= spectrumDurationMs(count)) return NONE;
  if (count < 5) {
    // Kills 2-4: the mound grows with the count; up 60-240ms, holds, gone by 1.1s.
    const level = ramp(t, 60, 240) * (1 - ramp(t, 650, 1_100));
    const amp = [0, 0, 20, 32, 46][count] * level;
    const sigma = [0, 0, 48, 56, 66][count];
    return { up: { amp, sigma }, down: { amp: 0, sigma: 1 }, glow: { alpha: 0.9 * level, rx: sigma * 1.6, ry: amp * 0.85 + 6 }, streaks: 0 };
  }
  // Kill 5, phases A/B: the big mound, then low and wide until the flash.
  const rise = ramp(t, 60, 260);
  const settle = ramp(t, 900, 1_700);
  const beforeFlash = 1 - ramp(t, 1_960, 2_020);
  const moundAmp = lerp(62, 22, settle) * rise * beforeFlash;
  const moundSigma = lerp(lerp(62, 92, ramp(t, 200, 900)), 135, settle);
  // Phase C: the flash at 2.0s, peak to ~2.25s, gone by 2.7s, a thin waveform left until 3.0s.
  const flash = ramp(t, 1_990, 2_050) * (1 - ramp(t, 2_250, 2_700));
  const tail = ramp(t, 2_500, 2_650) * (1 - ramp(t, 2_750, 3_000));
  const flashSigma = lerp(70, 105, ramp(t, 2_000, 2_300));
  const flashAmp = 40 * flash + 7 * tail;
  const flashLobeSigma = flash > 0 ? flashSigma : 135;
  return {
    up: flashAmp > moundAmp ? { amp: flashAmp, sigma: flashLobeSigma } : { amp: moundAmp, sigma: moundSigma },
    down: { amp: 36 * flash + 6 * tail, sigma: flashLobeSigma },
    glow: {
      alpha: Math.max(0.95 * rise * beforeFlash * (1 - 0.5 * settle), flash),
      rx: flash > 0.05 ? lerp(125, 165, ramp(t, 2_000, 2_300)) : moundSigma * 1.5,
      ry: flash > 0.05 ? 32 : moundAmp * 0.9 + 8,
    },
    streaks: Math.max(62 * flash, 34 * ramp(t, 900, 1_300) * beforeFlash),
  };
}

/** Rising sparks: a fixed set per kill, spawned 80-450ms after it (kills 2-5). */
export type Spark = { x: number; y: number; bornMs: number; lifeMs: number; rise: number; size: number; phase: number };

export function sparksFor(count: number, random: () => number): Spark[] {
  if (count < 2 || count > 5) return [];
  return Array.from({ length: [0, 0, 14, 22, 30, 44][count] }, () => ({
    // Over the fan, mostly left of the column (which covers the right).
    x: -58 + random() * 80,
    y: -16 - random() * 36,
    bornMs: 70 + random() * 450,
    lifeMs: 450 + random() * 550,
    rise: 40 + random() * (count === 5 ? 110 : 70),
    size: 1.1 + random() * 1.1,
    phase: random() * Math.PI * 2,
  }));
}

/** Deterministic pseudo-random numbers (the same kill always draws the same spectrum). */
export function seededRandom(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100_000) / 100_000;
  };
}

/** Per-column phases, drift speeds and heights of the hair-line texture. */
export type BarSeeds = { phase: Float32Array; speed: Float32Array; weight: Float32Array };

export function barSeedsFor(random: () => number): BarSeeds {
  const count = Math.ceil(SPECTRUM_WIDTH / BAR_PITCH) + 1;
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const weight = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    phase[index] = random() * Math.PI * 2;
    speed[index] = 0.8 + random() * 1.6;
    weight[index] = 0.18 + 0.82 * random() ** 1.6;
  }
  return { phase, speed, weight };
}

/** Height factor (0-1) of column `index` at `t` ms: a fixed jagged comb with a slow drift (no flicker). */
function comb(seeds: BarSeeds, index: number, t: number): number {
  return seeds.weight[index] * (0.88 + 0.12 * Math.sin(seeds.speed[index] * t / 1000 + seeds.phase[index]));
}

export type SpectrumColors = { core: string; glow: string };

/** Blur of the spike layer and of its bloom, in canvas pixels (recording: soft edges, merged bases). */
const SPIKE_BLUR = 0.7;
const FOG_BLUR = 9;
const BLOOM_BLUR = 4;
/** Base width of one spike: wider than the pitch, so neighbours overlap into one glow at the line. */
const SPIKE_BASE = 3.8;

/** A spike from the line: wide base, sharp tip (`direction` -1 up, 1 down). */
function spike(ctx: CanvasRenderingContext2D, x: number, base: number, height: number, width: number, direction: -1 | 1) {
  const tip = base + direction * height;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, base);
  // Concave flanks: the width stays at the base, the rest is a needle.
  ctx.quadraticCurveTo(x - width * 0.04, base + direction * height * 0.18, x, tip);
  ctx.quadraticCurveTo(x + width * 0.04, base + direction * height * 0.18, x + width / 2, base);
  ctx.closePath();
  ctx.fill();
}

/**
 * Paints one moment of a kill's spectrum into a context already scaled to canvas pixels
 * (`SPECTRUM_WIDTH` x `SPECTRUM_HEIGHT`).
 */
export function drawKillSpectrum(
  ctx: CanvasRenderingContext2D,
  layer: CanvasRenderingContext2D,
  ratio: number,
  count: number,
  t: number,
  seeds: BarSeeds,
  sparks: readonly Spark[],
  colors: SpectrumColors,
): void {
  ctx.clearRect(0, 0, SPECTRUM_WIDTH, SPECTRUM_HEIGHT);
  layer.clearRect(0, 0, SPECTRUM_WIDTH, SPECTRUM_HEIGHT);
  const frame = spectrumFrame(count, t);
  const cx = SPECTRUM_WIDTH / 2;
  const cy = SPECTRUM_LINE_Y;
  ctx.globalCompositeOperation = "lighter";

  if (frame.glow.alpha > 0.01) {
    // A wide soft haze, then a brighter inner mound; only above the line unless the flash mirrors the bars.
    for (const [scaleX, scaleY, alpha] of [[1.4, 1.35, 0.6], [0.85, 0.9, 0.75]] as const) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(frame.glow.rx * scaleX, frame.glow.ry * scaleY);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, colors.core);
      gradient.addColorStop(0.5, colors.glow);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = frame.glow.alpha * alpha;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      if (frame.down.amp > 0.5) ctx.arc(0, 0, 1, 0, Math.PI * 2);
      else ctx.rect(-1, -1, 2, 1);
      ctx.fill();
      ctx.restore();
    }
  }

  const columns = Math.floor(SPECTRUM_WIDTH / BAR_PITCH) + 1;
  // Spikes go to a separate layer that is blurred as a whole: their bases overlap into one soft glow at the
  // line, only the needle tips stay apart, and no edge is crisp.
  const drawLobe = (lobe: Lobe, direction: -1 | 1) => {
    if (lobe.amp < 0.5) return;
    const reach = Math.min(cx - 2, lobe.sigma * 2.6);
    const fade = layer.createLinearGradient(0, cy, 0, cy + direction * lobe.amp * 1.2);
    fade.addColorStop(0, colors.core);
    fade.addColorStop(0.3, colors.glow);
    fade.addColorStop(1, "rgba(0,0,0,0)");
    layer.fillStyle = fade;
    // The fog the needles grow out of: a smooth mound about half their height, heavily blurred.
    const fog = ctx.createLinearGradient(0, cy, 0, cy + direction * lobe.amp * 0.7);
    fog.addColorStop(0, colors.core);
    fog.addColorStop(0.4, colors.glow);
    fog.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.filter = `blur(${FOG_BLUR * ratio}px)`;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = fog;
    ctx.beginPath();
    ctx.moveTo(cx - reach, cy);
    for (let x = -reach; x <= reach; x += BAR_PITCH) {
      ctx.lineTo(cx + x, cy + direction * lobe.amp * 0.65 * Math.exp(-((x / (lobe.sigma * 1.1)) ** 2)));
    }
    ctx.lineTo(cx + reach, cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    for (let index = 0; index < columns; index += 1) {
      const x = index * BAR_PITCH - cx;
      if (Math.abs(x) > reach) continue;
      const envelope = Math.exp(-((x / lobe.sigma) ** 2));
      const height = lobe.amp * envelope * comb(seeds, index, t) * 1.5;
      if (height < 1) continue;
      layer.globalAlpha = 0.55 + 0.45 * seeds.weight[index];
      spike(layer, index * BAR_PITCH, cy, height, SPIKE_BASE * (0.7 + 0.3 * envelope), direction);
    }
  };
  drawLobe(frame.up, -1);
  drawLobe(frame.down, 1);

  if (frame.streaks > 0.5) {
    // Tall needles rising over the fan.
    for (let index = 0; index < 30; index += 1) {
      const x = -42 + index * 2.9;
      const height = 40 + frame.streaks * comb(seeds, (index * 7) % seeds.weight.length, t) * Math.exp(-((x / 40) ** 2));
      const gradient = layer.createLinearGradient(0, cy, 0, cy - height - 30);
      gradient.addColorStop(0, colors.core);
      gradient.addColorStop(0.55, colors.glow);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      layer.globalAlpha = 0.5;
      layer.fillStyle = gradient;
      spike(layer, cx + x, cy, height + 30, 2.4, -1);
    }
  }
  layer.globalAlpha = 1;

  // Bloom first (wide blur), then the softly blurred spikes over it.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = `blur(${BLOOM_BLUR * ratio}px)`;
  ctx.globalAlpha = 0.4;
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.filter = `blur(${SPIKE_BLUR * ratio}px)`;
  ctx.globalAlpha = 1;
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
  ctx.globalCompositeOperation = "lighter";

  for (const spark of sparks) {
    const age = t - spark.bornMs;
    if (age < 0 || age > spark.lifeMs) continue;
    const life = age / spark.lifeMs;
    // Rises fast, slows down, twinkles, fades out.
    const y = cy + spark.y - spark.rise * (1 - (1 - life) ** 2);
    const alpha = (life < 0.15 ? life / 0.15 : 1 - (life - 0.15) / 0.85) * (0.65 + 0.35 * Math.sin(age / 40 + spark.phase));
    ctx.globalAlpha = clamp01(alpha) * 0.35;
    ctx.fillStyle = colors.glow;
    ctx.beginPath();
    ctx.arc(cx + spark.x, y, spark.size * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = clamp01(alpha);
    ctx.fillStyle = colors.core;
    ctx.beginPath();
    ctx.arc(cx + spark.x, y, spark.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
