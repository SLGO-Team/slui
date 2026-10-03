import type { MatchPlayerLoadout } from "../../contracts";
import type { HudGeneratorPulse, HudPlayerView, HudTeamView, HudViewerPlayerView, RoundHudViewModel } from "./model";
import { overlayScaleForViewport } from "../../shared/overlay.ts";
import { SHOP_FALLBACK_ICONS } from "../shop/presentation.ts";

export const HUD_DESIGN_WIDTH = 1920;
export const HUD_DESIGN_HEIGHT = 1080;

/** @deprecated use overlayScaleForViewport; retained for existing callers. */
export const hudScaleForViewport = overlayScaleForViewport;

export type HudSide = "ct" | "t";
export type HudPlayerState = "alive" | "dead" | "offline";
export type HudPresentationVariant = "compact" | "detailed";

export type TopHudEquipmentIcon = {
  label: string;
  src: string;
};

export type TopHudArmor = "light" | "combat" | "heavy";

export type TopHudPlayerMeta = {
  money?: number;
  weapon?: TopHudEquipmentIcon;
  utility?: readonly TopHudEquipmentIcon[];
  armor?: TopHudArmor;
  hasC4?: boolean;
  hasDefuser?: boolean;
};

export type TopHudPlayerMetaById = Readonly<Partial<Record<string, TopHudPlayerMeta>>>;

/**
 * Keycard blink period per generator tier, from CS2 BombPlantedPulse__Slow/Medium/Fast
 * (bombDet keyframes, hudteamcounter.css).
 */
export const HUD_GENERATOR_PULSE_SECONDS: Readonly<Record<HudGeneratorPulse, number>> = {
  slow: 0.8,
  medium: 0.5,
  fast: 0.3,
};

function equipmentIcon(itemId: string): TopHudEquipmentIcon | null {
  const src = SHOP_FALLBACK_ICONS[itemId];
  return src ? { label: itemId, src } : null;
}

/**
 * The equipment summary of one teammate, from the snapshot loadout. Item ids without an
 * icon (Jailbird, Radio, ...) are skipped rather than drawn with a placeholder.
 */
export function loadoutToPlayerMeta(loadout: MatchPlayerLoadout): TopHudPlayerMeta {
  const weapon = loadout.primary_item_id === null ? null : equipmentIcon(loadout.primary_item_id);
  const utility = loadout.utility_item_ids
    .map(equipmentIcon)
    .filter((icon): icon is TopHudEquipmentIcon => icon !== null);
  return {
    money: loadout.money,
    ...(weapon ? { weapon } : {}),
    utility,
    ...(loadout.armor ? { armor: loadout.armor } : {}),
    hasC4: loadout.has_commander_keycard,
    hasDefuser: loadout.has_generator_upgrade,
  };
}

/** Equipment summaries for the viewer's team; the opponent team never carries a loadout. */
export function topHudPlayerMetaForHud(hud: RoundHudViewModel): TopHudPlayerMetaById {
  if (!hud.hasSnapshot) return {};
  const meta: Record<string, TopHudPlayerMeta> = {};
  for (const team of hud.teams) {
    if (team.relation !== "viewer") continue;
    for (const player of team.players) {
      if (player.loadout) meta[player.player_id] = loadoutToPlayerMeta(player.loadout);
    }
  }
  return meta;
}

/**
 * Detailed during the buy phase and round end, for a spectator (no viewer team), and while the local
 * player is dead; compact otherwise. The local player is found by SteamID64: the session identity is
 * the SteamID the sidecar authorized, and the plugin fills player_id with SteamID64.
 */
export function hudVariantFor(hud: RoundHudViewModel, localSteamId: string | null): HudPresentationVariant {
  if (!hud.hasSnapshot) return "compact";
  if (hud.state === "BuyPhase" || hud.state === "RoundEnd") return "detailed";
  const viewerTeam = hud.teams.find((team) => team.relation === "viewer");
  if (!viewerTeam) return "detailed";
  const self = localSteamId === null ? undefined : viewerTeam.players.find((player) => player.player_id === localSteamId);
  return self && !self.is_alive ? "detailed" : "compact";
}

export const DEFAULT_AVATAR_BY_SIDE: Readonly<Record<HudSide, string>> = {
  ct: "/assets/hud/avatar-ct.svg",
  t: "/assets/hud/avatar-terrorist.png",
};

export const PLAYER_COLORS: Readonly<Record<HudSide, readonly string[]>> = {
  ct: ["#c03699", "#88cef5", "#f8f62d", "#ff9b25", "#1da284"],
  t: ["#1da284", "#f8f62d", "#ff9b25", "#c03699", "#88cef5"],
};

/**
 * Every player's CS2-style slot colour (the five teammate colours): the side's palette, indexed by the
 * player's position in the match.snapshot team list. The top HUD counter, the chat dot and the radar all
 * use this, so one player keeps one colour everywhere.
 */
export function playerSlotColors(teams: readonly Pick<HudTeamView, "role" | "players">[]): Readonly<Record<string, string>> {
  const colors: Record<string, string> = {};
  for (const team of teams) {
    const palette = PLAYER_COLORS[hudSideForRole(team.role)];
    team.players.forEach((player, index) => { colors[player.player_id] = palette[index % palette.length]; });
  }
  return colors;
}

export function resolveHudTeams(hud: Extract<RoundHudViewModel, { hasSnapshot: true }>): { left: HudTeamView; right: HudTeamView } {
  return {
    left: hud.teams.find((team) => team.teamId === "team-a") ?? hud.teams[0],
    right: hud.teams.find((team) => team.teamId === "team-b") ?? hud.teams[1],
  };
}

export function hudSideForRole(role: HudTeamView["role"]): HudSide {
  // SLGO roles use their gameplay semantics: NTF attacks (T), SCP defends (CT).
  return role === "ntf" ? "t" : "ct";
}

export function hudPlayerState(player: HudPlayerView): HudPlayerState {
  if (!player.is_online) return "offline";
  return player.is_alive ? "alive" : "dead";
}

/** Older plugins send no caps; their contract scaled health and shield to 100. */
const LEGACY_VITAL_MAX = 100;

function vitalPercent(value: number, max: number | null): number {
  const cap = max ?? LEGACY_VITAL_MAX;
  if (cap <= 0) return 0;
  return Math.min(100, Math.max(0, (value / cap) * 100));
}

export function hudHealthPercent(player: HudViewerPlayerView): number | null {
  if (!player.is_online || !player.is_alive) return 0;
  if (player.health === null) return null;
  return vitalPercent(player.health, player.max_health);
}

export function hudShieldPercent(player: HudViewerPlayerView): number | null {
  if (!player.is_online || !player.is_alive) return 0;
  if (player.shield === null) return null;
  return vitalPercent(player.shield, player.max_shield);
}

/** An alive SCP-079's aux power bar, which replaces its health and shield bars; null for everyone else. */
export function hudAuxPower(player: HudViewerPlayerView): { percent: number; value: number } | null {
  if (!player.is_online || !player.is_alive || player.aux === null) return null;
  return { percent: vitalPercent(player.aux.power, player.aux.max), value: player.aux.power };
}

export function avatarSource(player: HudPlayerView, side: HudSide): string {
  return player.avatar_url?.trim() || DEFAULT_AVATAR_BY_SIDE[side];
}
