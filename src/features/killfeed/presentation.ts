import { HUD_KILLFEED_WEAPONS, type HudKillfeedWeapon, type Role } from "../../contracts/index.ts";
import { ROLE_COLORS } from "../../shared/roleColors.ts";

export type KillfeedPlayerView = { name: string; color: string };

const SVG = "/assets/slui-svg";
/** CS2 `icon_suicide` (skull and crossbones, SLUI-drawn after the 1080p capture). */
export const KILLFEED_SUICIDE_ICON = "/assets/killfeed/suicide.svg";
/** CS2 `icon_headshot` (head, entry hole and exit trail, SLUI-drawn after the 1080p capture). */
export const KILLFEED_HEADSHOT_ICON = "/assets/killfeed/headshot.svg";
/** Fallback for weapons without artwork: the plain skull, so it never reads as a suicide's skull and crossbones. */
export const KILLFEED_SKULL_ICON = "/assets/hud/skull.svg";

/**
 * Weapons that have SLUI artwork (the shop's white silhouettes). Every other id draws the plain skull: the user
 * decided (2026-10-18) not to draw weapons the shop does not sell; adding art later only touches this table.
 */
export const KILLFEED_WEAPON_ICONS: Readonly<Partial<Record<HudKillfeedWeapon, string>>> = {
  com15: `${SVG}/GunCOM15.svg`,
  com18: `${SVG}/GunCOM18.svg`,
  fsp9: `${SVG}/GunFSP9.svg`,
  crossvec: `${SVG}/GunCrossvec.svg`,
  e11sr: `${SVG}/GunE11SR.svg`,
  ak: `${SVG}/GunAK.svg`,
  logicer: `${SVG}/GunLogicer.svg`,
  frmg0: `${SVG}/GunFRMG0.svg`,
  micro_hid: `${SVG}/MicroHID.svg`,
  grenade_he: `${SVG}/GrenadeHE.svg`,
  scp049: `${SVG}/Scp049.svg`,
  scp0492: `${SVG}/Scp0492.svg`,
  scp096: `${SVG}/Scp096.svg`,
  scp106: `${SVG}/Scp106.svg`,
  scp173: `${SVG}/Scp173.svg`,
  scp939: `${SVG}/Scp939.svg`,
  scp3114: `${SVG}/Scp3114.svg`,
};

/** Weapon ids drawn with the fallback skull. */
export const KILLFEED_FALLBACK_WEAPONS: readonly HudKillfeedWeapon[] = HUD_KILLFEED_WEAPONS.filter((weapon) => KILLFEED_WEAPON_ICONS[weapon] === undefined);

export function killfeedWeaponIcon(weapon: HudKillfeedWeapon): string {
  return KILLFEED_WEAPON_ICONS[weapon] ?? KILLFEED_SKULL_ICON;
}

/** CS2 `FadedColor`, for a player without a side. */
export const KILLFEED_UNASSIGNED_COLOR = "#888888";

/**
 * Name colours. NTF takes CS2's own killfeed blue (`CTColor` #6f9ce6; the 1080p capture reads 114/156/216 through
 * JPEG), which is also NTF's colour everywhere in SLGO. SCP keeps the SLGO red (user decision 2026-10-18), not
 * CS2's `TColor` gold.
 */
export const KILLFEED_TEAM_COLORS: Readonly<Record<Role, string>> = {
  ntf: "#6f9ce6",
  scp: ROLE_COLORS.scp,
};

export function killfeedNameColor(team: Role | null): string {
  return team === null ? KILLFEED_UNASSIGNED_COLOR : KILLFEED_TEAM_COLORS[team];
}
