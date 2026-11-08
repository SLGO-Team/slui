import type { RelaunchState } from "../app/gameConditionsModel.ts";
import type { GameConditions } from "../platform/gameConditions.ts";

// Browser previews of the home window's game-condition banners: `?gameConditions=elevated|exclusive|both|unfocused`, with
// `&relaunch=busy|cancelled|failed` for the elevated banner's action states. Rust detects neither outside Tauri.
export type GameConditionsPreview = Readonly<{ conditions: GameConditions; relaunch: RelaunchState | null }>;

type PreviewConditions = Pick<GameConditions, "elevatedGame" | "exclusiveFullscreen" | "hidesWhenUnfocused">;

const CONDITIONS: Readonly<Record<string, PreviewConditions>> = {
  elevated: { elevatedGame: true, exclusiveFullscreen: false, hidesWhenUnfocused: false },
  exclusive: { elevatedGame: false, exclusiveFullscreen: true, hidesWhenUnfocused: false },
  both: { elevatedGame: true, exclusiveFullscreen: true, hidesWhenUnfocused: false },
  unfocused: { elevatedGame: false, exclusiveFullscreen: false, hidesWhenUnfocused: true },
};

const RELAUNCH: Readonly<Record<string, RelaunchState>> = {
  busy: { phase: "busy" },
  cancelled: { phase: "cancelled" },
  failed: { phase: "failed", reason: "Windows did not start SLUI elevated (error 2)" },
};

export function readGameConditionsPreview(search: string): GameConditionsPreview | null {
  const params = new URLSearchParams(search);
  const name = params.get("gameConditions");
  if (!name || !Object.prototype.hasOwnProperty.call(CONDITIONS, name)) return null;
  const relaunch = params.get("relaunch");
  return {
    conditions: { ...CONDITIONS[name], revision: 1 },
    relaunch: relaunch && Object.prototype.hasOwnProperty.call(RELAUNCH, relaunch) ? RELAUNCH[relaunch] : null,
  };
}
