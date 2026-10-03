// Generates the bundled shop UI sounds (public/assets/sounds/shop/*.wav) by
// deterministic synthesis: filtered noise transients plus decaying metallic
// partials. Theme packs may replace them; see src/features/shop/audio.ts.
// Usage: node scripts/generate-shop-sounds.mjs
import { mkdir, writeFile } from "node:fs/promises";

const SAMPLE_RATE = 44_100;
const OUT = new URL("../public/assets/sounds/shop/", import.meta.url);

function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xffffffff) * 2 - 1;
  };
}

// RBJ band-pass biquad (constant 0 dB peak gain).
function bandPass(input, frequency, q) {
  const w = (2 * Math.PI * frequency) / SAMPLE_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const [b0, b2, a1, a2] = [alpha / a0, -alpha / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0];
  const output = new Float64Array(input.length);
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  for (let i = 0; i < input.length; i += 1) {
    const y = b0 * input[i] + b2 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, input[i], y1, y];
    output[i] = y;
  }
  return output;
}

/** Adds a noise burst band-passed around `frequency`, starting at `at` seconds. */
function noiseBurst(buffer, { at, frequency, q, decay, gain, seed }) {
  const noise = rng(seed);
  const start = Math.round(at * SAMPLE_RATE);
  const raw = new Float64Array(buffer.length - start).map((_, i) => noise() * Math.exp(-i / SAMPLE_RATE / decay));
  const filtered = bandPass(raw, frequency, q);
  for (let i = 0; i < filtered.length; i += 1) buffer[start + i] += filtered[i] * gain;
}

/** Adds a sine partial with a 1 ms attack and exponential decay. */
function partial(buffer, { at, frequency, decay, gain }) {
  const start = Math.round(at * SAMPLE_RATE);
  for (let i = 0; start + i < buffer.length; i += 1) {
    const t = i / SAMPLE_RATE;
    buffer[start + i] += Math.sin(2 * Math.PI * frequency * t) * Math.min(1, t / 0.001) * Math.exp(-t / decay) * gain;
  }
}

function render(durationSeconds, layers) {
  const buffer = new Float64Array(Math.round(durationSeconds * SAMPLE_RATE));
  for (const [kind, options] of layers) (kind === "noise" ? noiseBurst : partial)(buffer, options);
  // Normalize to -1 dBFS and fade the last 5 ms so clips never end on a step.
  const peak = buffer.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  const fade = Math.round(0.005 * SAMPLE_RATE);
  return buffer.map((value, i) => (value / peak) * 0.89 * Math.min(1, (buffer.length - 1 - i) / fade));
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32_767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// Hover/select: a light tick with a short glassy ring.
const select = render(0.3, [
  ["noise", { at: 0, frequency: 9_000, q: 1.2, decay: 0.002, gain: 1, seed: 11 }],
  ["partial", { at: 0, frequency: 7_650, decay: 0.045, gain: 0.35 }],
  ["partial", { at: 0, frequency: 12_900, decay: 0.03, gain: 0.18 }],
]);

// Unavailable: a dry, muted double click.
const unavailable = render(0.03, [
  ["noise", { at: 0, frequency: 6_500, q: 2, decay: 0.0025, gain: 1, seed: 23 }],
  ["noise", { at: 0.009, frequency: 4_800, q: 2, decay: 0.002, gain: 0.7, seed: 29 }],
]);

// Purchase: a soft pre-click, then a bright metallic latch at 80 ms.
function purchase(variant) {
  const detune = [1, 1.035, 0.97][variant];
  return render([0.16, 0.4, 0.3][variant], [
    ["noise", { at: 0, frequency: 5_200 * detune, q: 3, decay: 0.004, gain: 0.25, seed: 41 + variant }],
    ["noise", { at: 0.08, frequency: 7_400 * detune, q: 1.5, decay: 0.006, gain: 1, seed: 53 + variant }],
    ["partial", { at: 0.08, frequency: 6_300 * detune, decay: 0.05 + variant * 0.02, gain: 0.3 }],
    ["partial", { at: 0.08, frequency: 9_850 * detune, decay: 0.035 + variant * 0.015, gain: 0.2 }],
    ["partial", { at: 0.082, frequency: 15_600 * detune, decay: 0.02, gain: 0.08 }],
  ]);
}

await mkdir(OUT, { recursive: true });
const files = {
  "select.wav": select,
  "unavailable.wav": unavailable,
  "purchase-1.wav": purchase(0),
  "purchase-2.wav": purchase(1),
  "purchase-3.wav": purchase(2),
};
for (const [name, samples] of Object.entries(files)) {
  await writeFile(new URL(name, OUT), wav(samples));
  console.log(name, `${Math.round((samples.length / SAMPLE_RATE) * 1000)}ms`);
}
