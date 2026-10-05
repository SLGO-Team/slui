/**
 * MVP strip checker background, measured frame by frame from a 60 fps in-game recording (the CS2
 * banner scene is not reproduced; SLUI draws the squares). A grid of 17 px squares on a 19.32 px pitch
 * (5 rows, centred on the strip); a lighting wave climbs one row every 468 ms (bottom row first, a full
 * cycle every 2.34 s), slightly later towards the right. On each pass a square lights with a 60 % chance
 * at a random level: rises over 350 ms, holds until 1 s, fades out linearly until 1.95 s. Squares near
 * the strip ends light brighter. The wave is locked to the strip's entrance and stops 9 s after it.
 */

/** Strip size in canvas CSS pixels (`.winpanel-mvp`). */
export const CHECKER_WIDTH = 640;
export const CHECKER_HEIGHT = 90;
/** The strip (and the checker clock) starts this long after the panel mounts; matches WinPanel.css. */
export const WIN_PANEL_MVP_DELAY_MS = 990;
/** Debug stills draw the checker at this time after the strip entrance. */
export const CHECKER_STILL_MS = 3_300;

const PITCH = 19.32;
export const CHECKER_SQUARE_SIZE = 17;
const ROWS = 5;
const PERIOD_MS = 2_340;
const ROW_STEP_MS = 468;
/** Rise start of the bottom row's first pass after the strip entrance. */
const BOTTOM_ROW_ONSET_MS = 1_885;
/** Left-to-right lag of the wave. */
const LAG_MS_PER_PX = 0.35;
/** Per-square, per-pass onset jitter (+-). */
const JITTER_MS = 120;
const RISE_MS = 350;
const HOLD_END_MS = 1_000;
const DECAY_END_MS = 1_950;
/** The checker disappears at once this long after the strip entrance. */
export const CHECKER_RUN_MS = 9_000;
const LIT_CHANCE = 0.6;
const WEAK_CHANCE = 0.3;
const WEAK_LEVEL = 0.5;
/** Accent opacity of a fully lit square in the middle of the strip. */
const LIT_ALPHA = 0.26;
/** Squares farther than this from the centre light brighter, up to `EDGE_GAIN` 40 px farther out. */
const EDGE_START_PX = 195;
const EDGE_GAIN = 1.65;

export type CheckerSquare = {
  column: number;
  /** 0 is the top row. */
  row: number;
  x: number;
  y: number;
};

/** Every square that overlaps the strip; a gap sits on the vertical centre line, a square on the horizontal one. */
export function checkerSquares(): CheckerSquare[] {
  const squares: CheckerSquare[] = [];
  const centreX = CHECKER_WIDTH / 2;
  const centreY = CHECKER_HEIGHT / 2;
  const half = Math.ceil(centreX / PITCH);
  for (let row = 0; row < ROWS; row++) {
    const y = centreY + (row - (ROWS - 1) / 2) * PITCH - CHECKER_SQUARE_SIZE / 2;
    for (let column = -half; column < half; column++) {
      const x = centreX + column * PITCH + (PITCH - CHECKER_SQUARE_SIZE) / 2;
      if (x + CHECKER_SQUARE_SIZE <= 0 || x >= CHECKER_WIDTH) continue;
      squares.push({ column, row, x, y });
    }
  }
  return squares;
}

/** FNV-1a of the result id: one fixed pattern per result, so replays and stills draw the same squares. */
export function checkerSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic value in [0, 1) for a square, a pass and a purpose. */
function random(seed: number, square: CheckerSquare, pass: number, salt: number): number {
  let h = seed ^ Math.imul(square.column + 1_000, 0x9e3779b1) ^ Math.imul(square.row + 7, 0x85ebca6b)
    ^ Math.imul(pass + 100_000, 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

function edgeGain(square: CheckerSquare): number {
  const distance = Math.abs(square.x + CHECKER_SQUARE_SIZE / 2 - CHECKER_WIDTH / 2);
  const ramp = Math.min(1, Math.max(0, (distance - EDGE_START_PX) / 40));
  return 1 + (EDGE_GAIN - 1) * ramp;
}

/** Peak opacity of a square on one pass; 0 when it stays dark. */
function passLevel(seed: number, square: CheckerSquare, pass: number): number {
  if (random(seed, square, pass, 0) >= LIT_CHANCE) return 0;
  const level = random(seed, square, pass, 1) < WEAK_CHANCE ? WEAK_LEVEL : 1;
  const variation = 0.88 + 0.24 * random(seed, square, pass, 2);
  return LIT_ALPHA * edgeGain(square) * level * variation;
}

/** Brightness envelope of one pass, `elapsedMs` after its rise starts. */
export function checkerEnvelope(elapsedMs: number): number {
  if (elapsedMs <= 0 || elapsedMs >= DECAY_END_MS) return 0;
  if (elapsedMs < RISE_MS) {
    const p = elapsedMs / RISE_MS;
    return p * p * (3 - 2 * p);
  }
  if (elapsedMs <= HOLD_END_MS) return 1;
  return 1 - (elapsedMs - HOLD_END_MS) / (DECAY_END_MS - HOLD_END_MS);
}

/** Accent opacity of `square` `stripMs` after the strip entrance (0 before it and after the checker stops). */
export function checkerAlpha(seed: number, square: CheckerSquare, stripMs: number): number {
  if (stripMs < 0 || stripMs >= CHECKER_RUN_MS) return 0;
  const rowFromBottom = ROWS - 1 - square.row;
  const lag = LAG_MS_PER_PX * (square.x + CHECKER_SQUARE_SIZE / 2 - CHECKER_WIDTH / 2);
  const firstOnset = BOTTOM_ROW_ONSET_MS + rowFromBottom * ROW_STEP_MS + lag;
  const pass = Math.floor((stripMs - firstOnset) / PERIOD_MS);
  let alpha = 0;
  for (let p = pass - 1; p <= pass + 1; p++) {
    const onset = firstOnset + p * PERIOD_MS + (random(seed, square, p, 3) * 2 - 1) * JITTER_MS;
    const envelope = checkerEnvelope(stripMs - onset);
    if (envelope > 0) alpha = Math.max(alpha, envelope * passLevel(seed, square, p));
  }
  return alpha;
}

/** The exit shows the checker again as a still random pattern while the strip flashes white and collapses. */
export function checkerExitAlpha(seed: number, square: CheckerSquare): number {
  return passLevel(seed, square, -1_000);
}
