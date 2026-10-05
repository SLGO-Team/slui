import type { Role, RoundResultOutcome } from "../../contracts/index.ts";
import { ROLE_COLORS } from "../../shared/roleColors.ts";
import { DEFAULT_AVATAR_BY_SIDE, hudSideForRole } from "../hud/presentation.ts";
import type { RoundHudViewModel } from "../hud/model.ts";

/** CS2 `negativeColor`: title, bars and chevrons when the viewer's team lost. */
export const WIN_PANEL_LOSS_COLOR = "#DB4437";
/** A draw has no winner: neutral white text on the neutral fill. */
export const WIN_PANEL_NEUTRAL_COLOR = "rgb(226, 226, 226)";

/**
 * Translucent title-box fills. CS2 tints the box with the winning side (`winPanelBgColorT/CT`); in
 * the captures it reads as a dark, slightly tinted grey (CT: navy, T: olive), and a lost round turns
 * it neutral. SLGO tints by the winner's team colour instead of the CS2 side.
 */
export const WIN_PANEL_TITLE_FILLS: Readonly<Record<Role | "neutral", string>> = {
  ntf: "rgba(28, 42, 60, 0.7)",
  scp: "rgba(60, 30, 34, 0.7)",
  neutral: "rgba(54, 54, 56, 0.7)",
};

/**
 * MVP strip base under the checker squares: a dark shade of the winner colour, as the CS2 captures
 * show (CT blue strip `rgb(27, 78, 110)` for the colour NTF shares with CS2 CT).
 */
export const WIN_PANEL_MVP_FILLS: Readonly<Record<Role | "neutral", string>> = {
  ntf: "rgba(24, 74, 106, 0.94)",
  scp: "rgba(96, 24, 32, 0.94)",
  neutral: "rgba(50, 50, 52, 0.94)",
};

/** Every colour of the panel; the component sets them as CSS variables on its root. */
export type WinPanelColors = {
  /** Title text, side bars and chevrons. */
  accent: string;
  /** Title box fill. */
  fill: string;
  /** MVP chip, name, music-kit row and checker squares: always the winner colour (CS2 `--Win--T/CT`). */
  mvpAccent: string;
  /** MVP strip base. */
  mvpFill: string;
};

/**
 * Colours per outcome (parent PRD R2): `won` and `observer` use the winner's team colour and a
 * team-tinted fill, `lost` the loss red on a neutral fill, `draw` neutral. SCP's colour is close to
 * the loss red, so an SCP win and loss differ by text and fill only (user decision 2026-10-05).
 */
export function winPanelColors(outcome: RoundResultOutcome, winner: Role | null): WinPanelColors {
  const mvpAccent = winner === null ? WIN_PANEL_NEUTRAL_COLOR : ROLE_COLORS[winner];
  const mvpFill = WIN_PANEL_MVP_FILLS[winner ?? "neutral"];
  if (outcome === "lost") return { accent: WIN_PANEL_LOSS_COLOR, fill: WIN_PANEL_TITLE_FILLS.neutral, mvpAccent, mvpFill };
  if (outcome === "draw" || winner === null) {
    return { accent: WIN_PANEL_NEUTRAL_COLOR, fill: WIN_PANEL_TITLE_FILLS.neutral, mvpAccent, mvpFill };
  }
  return { accent: ROLE_COLORS[winner], fill: WIN_PANEL_TITLE_FILLS[winner], mvpAccent, mvpFill };
}

/** Avatar and team of every player in the latest match.snapshot, by SteamID64. */
export type WinPanelRoster = Readonly<Record<string, { avatarUrl: string | null; role: Role }>>;

export function winPanelRosterFromHud(hud: RoundHudViewModel): WinPanelRoster {
  if (!hud.hasSnapshot) return {};
  const roster: Record<string, { avatarUrl: string | null; role: Role }> = {};
  for (const team of hud.teams) {
    for (const player of team.players) roster[player.player_id] = { avatarUrl: player.avatar_url?.trim() || null, role: team.role };
  }
  return roster;
}

/**
 * The MVP's Steam avatar from the roster and the side default of the top HUD. The side follows the
 * MVP's team in the snapshot, else the winner (the MVP is on the winning team); CT without either.
 */
export function winPanelMvpAvatar(playerId: string, winner: Role | null, roster: WinPanelRoster): { avatarUrl: string | null; fallbackAvatarUrl: string } {
  const entry = roster[playerId];
  const role = entry?.role ?? winner;
  return {
    avatarUrl: entry?.avatarUrl ?? null,
    fallbackAvatarUrl: DEFAULT_AVATAR_BY_SIDE[role === null ? "ct" : hudSideForRole(role)],
  };
}
