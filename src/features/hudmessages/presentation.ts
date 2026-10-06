import type { RoundHudViewModel } from "../hud/model.ts";
import type { HudProgressViewer } from "./model.ts";

/**
 * The local player for the progress card: their team's role and the generator upgrade from their
 * match.snapshot loadout (only the viewer's team carries loadouts). Null without a viewer team; a player
 * not found (or without a loadout) has no upgrade.
 */
export function progressViewerFromHud(hud: RoundHudViewModel, playerId: string | null): HudProgressViewer | null {
  if (!hud.hasSnapshot) return null;
  const team = hud.teams.find((candidate) => candidate.relation === "viewer");
  if (!team || team.relation !== "viewer") return null;
  const player = team.players.find((candidate) => candidate.player_id === playerId);
  return { role: team.role, hasGeneratorUpgrade: player?.loadout?.has_generator_upgrade === true };
}
