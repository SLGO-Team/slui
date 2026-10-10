import type { HudAmmo, HudKillKind } from "../../contracts/index.ts";

/** CS2 low-clip state: the recording shows 6/30 red and 7/30 normal, so at or below 20 % of the clip. */
export const LOW_CLIP_FRACTION = 0.2;

export function isLowClip(ammo: HudAmmo): boolean {
  return ammo.clip <= ammo.clip_max * LOW_CLIP_FRACTION;
}

/** Fill of the clip bar under the clip number (`#AmmoClipBar`, anchored left); a chambered round never overfills it. */
export function clipBarFraction(ammo: HudAmmo): number {
  return Math.max(0, Math.min(1, ammo.clip / ammo.clip_max));
}

/** One fanned card: Panorama `translate3d(x, y)` then `rotateZ(deg)`, about the HUD circle centre. */
export type KillCardPose = { x: number; y: number; deg: number };

/** CS2 `.HUD--NumKills--N .hud-HA__kill-flagK` transforms (hudhealthammocenter.css), card 1 first. */
export const KILL_FAN: Readonly<Record<1 | 2 | 3 | 4 | 5, readonly KillCardPose[]>> = {
  1: [{ x: 0, y: 0, deg: 0 }],
  2: [{ x: -2, y: 2, deg: -6 }, { x: 2, y: 0, deg: 6 }],
  3: [{ x: -3, y: 4, deg: -12 }, { x: 0, y: 2, deg: 0 }, { x: 3, y: 0, deg: 12 }],
  4: [{ x: -5, y: 6, deg: -18 }, { x: -2, y: 4, deg: -6 }, { x: 2, y: 2, deg: 6 }, { x: 5, y: 0, deg: 18 }],
  5: [{ x: -7, y: 8, deg: -24 }, { x: -3, y: 6, deg: -12 }, { x: 0, y: 4, deg: 0 }, { x: 3, y: 2, deg: 12 }, { x: 7, y: 0, deg: 24 }],
};

/** CS2 shows kills 1-5 as a fanned hand of cards; from the sixth kill one counter card replaces it. */
export const MAX_FANNED_KILLS = 5;

export type KillCardView = {
  /** 1-based kill number; the React key, so a card keeps its element while the fan re-lays out. */
  index: number;
  kind: HudKillKind;
  pose: KillCardPose;
  /** The fifth card is CS2's ace (spade and skull, no number). */
  ace: boolean;
};

export type KillCardsView =
  | { mode: "none" }
  | { mode: "fan"; cards: KillCardView[] }
  | { mode: "counter"; count: number; kind: HudKillKind };

export function killCardsFor(kills: readonly HudKillKind[]): KillCardsView {
  const count = kills.length;
  if (count === 0) return { mode: "none" };
  if (count > MAX_FANNED_KILLS) return { mode: "counter", count, kind: kills[count - 1] };
  const poses = KILL_FAN[count as 1 | 2 | 3 | 4 | 5];
  return {
    mode: "fan",
    cards: kills.map((kind, index) => ({ index: index + 1, kind, pose: poses[index], ace: index + 1 === MAX_FANNED_KILLS })),
  };
}

/**
 * The odometer strip of every balance character (CS2 `DigitPanel`): padding, `$`, then the digits, top to
 * bottom; a character rolls straight from its old row to its new one.
 */
export const ODOMETER_SYMBOLS = [" ", "$", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/** CS2 pads the money panel to the width of "$16000"; longer amounts widen it. */
export const ODOMETER_MIN_CELLS = 6;

/** Strip row of each character of `$balance`, right-aligned in at least `ODOMETER_MIN_CELLS` cells (blank = 0). */
export function odometerRows(balance: number, cells = ODOMETER_MIN_CELLS): number[] {
  const text = `$${Math.max(0, Math.floor(balance))}`;
  const padded = text.padStart(Math.max(cells, text.length), " ");
  return [...padded].map((char) => ODOMETER_SYMBOLS.indexOf(char as typeof ODOMETER_SYMBOLS[number]));
}

/** Odometer cells for a balance: grows with the amount, never below CS2's six. */
export function odometerCells(balance: number): number {
  return Math.max(ODOMETER_MIN_CELLS, `$${Math.max(0, Math.floor(balance))}`.length);
}
