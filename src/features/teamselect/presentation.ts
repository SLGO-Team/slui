import type { Role, TeamCommand } from "../../contracts/index.ts";
import { ROLE_COLORS } from "../../shared/roleColors.ts";
import type { HudTeamView } from "../hud/model.ts";
import { avatarSource, DEFAULT_AVATAR_BY_SIDE, hudSideForRole, type HudSide } from "../hud/presentation.ts";
import { SCOREBOARD_SIDE_NAMES } from "../scoreboard/presentation.ts";
import { createTeamCloseCommand, createTeamSelectCommand, visibleTeamMenu, type TeamSelectError, type TeamSelectState } from "./model.ts";

/** NTF plays CS2's T side (left), SCP the CT side (right), as on the Hint roster and the HUD. */
export const TEAM_SELECT_ORDER: readonly Role[] = ["ntf", "scp"];

/**
 * Top gradient of each half (`#BtnSelectTeam-*.team-select-button`): CS2 darkens the side colour to it. NTF wears
 * CS2's CT colour (`ct-color`), so it takes CT's gradient; SCP's is the T gradient's darkening applied to SCP red.
 */
export const TEAM_SELECT_GRADIENTS: Readonly<Record<Role, string>> = {
  ntf: "rgb(37 75 105)",
  scp: "rgb(85 27 32)",
};

export type TeamSelectRow = Readonly<{
  playerId: string;
  name: string;
  avatarUrl: string;
  fallbackAvatarUrl: string;
  /** CS2 draws humans in the team colour and bots grey; SLGO has no bots, so an offline seat gets the bot row. */
  online: boolean;
}>;

export type TeamSelectSideView = Readonly<{
  role: Role;
  side: HudSide;
  title: string;
  /** CS2 "{n} 玩家 - {m} 电脑玩家" without the bot part (SLGO has no bots). */
  subtitle: string;
  color: string;
  gradient: string;
  rows: readonly TeamSelectRow[];
}>;

/** The rosters the menu lists: the round HUD's teams (`match.snapshot`), or a debug scene's. */
export type TeamSelectTeam = Pick<HudTeamView, "role" | "relation" | "players">;

export type TeamSelectView = Readonly<{
  sessionId: string;
  /** Opened because the player joined without a team: no Cancel, Escape and M do nothing. */
  forced: boolean;
  /** The side the local player is on, or null while unassigned. */
  viewerRole: Role | null;
  sides: readonly [TeamSelectSideView, TeamSelectSideView];
  /** A command is waiting for its result; clicks do nothing meanwhile. */
  pending: boolean;
  error: TeamSelectError | null;
}>;

function sideView(role: Role, team: TeamSelectTeam | null): TeamSelectSideView {
  const side = hudSideForRole(role);
  const players = team?.players ?? [];
  return {
    role,
    side,
    title: SCOREBOARD_SIDE_NAMES[role],
    subtitle: `${players.length} 玩家`,
    color: ROLE_COLORS[role],
    gradient: TEAM_SELECT_GRADIENTS[role],
    rows: players.map((player) => ({
      playerId: player.player_id,
      name: player.display_name,
      avatarUrl: avatarSource(player, side),
      fallbackAvatarUrl: DEFAULT_AVATAR_BY_SIDE[side],
      online: player.is_online,
    })),
  };
}

/**
 * The team select panel, or null while the plugin has no session open for this player or no roster is known yet
 * (`teams` null: the round HUD has no `match.snapshot`).
 */
export function selectTeamSelect(state: TeamSelectState, teams: readonly TeamSelectTeam[] | null): TeamSelectView | null {
  const menu = visibleTeamMenu(state);
  if (menu === null || teams === null) return null;
  const teamFor = (role: Role) => teams.find((team) => team.role === role) ?? null;
  return {
    sessionId: menu.session_id,
    forced: menu.forced,
    viewerRole: teams.find((team) => team.relation === "viewer")?.role ?? null,
    sides: [sideView("ntf", teamFor("ntf")), sideView("scp", teamFor("scp"))],
    pending: state.pending !== null,
    error: state.error,
  };
}

/** CS2 `_SelectTeam`: clicking the side the player is already on only closes the menu; any other side joins it. */
export function commandForSide(view: TeamSelectView, role: Role): TeamCommand {
  return view.viewerRole === role ? createTeamCloseCommand(view.sessionId) : createTeamSelectCommand(role);
}

/** Cancel, Escape and M: a forced session has no way out but a choice. */
export function closeCommandFor(view: TeamSelectView): TeamCommand | null {
  return view.forced ? null : createTeamCloseCommand(view.sessionId);
}

/** Whether the error banner shows at a time. */
export function teamSelectErrorAt(error: TeamSelectError | null, nowMs: number): string | null {
  return error !== null && nowMs < error.untilMs ? error.text : null;
}
