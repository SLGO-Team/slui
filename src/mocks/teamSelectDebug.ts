import type { Role } from "../contracts/index.ts";
import type { HudPlayerView } from "../features/hud/model.ts";
import type { TeamSelectTeam } from "../features/teamselect/presentation.ts";
import type { MockTeamMenuOptions } from "./minimapProvider.ts";

/**
 * Debug team select scenes, by URL (`?teamSelect=ntf|scp|forced`), matching the user's three captures: in a match
 * (`ntf` / `scp`: the local player plus four offline seats on NTF, five on SCP) and the first join (`forced`: both
 * teams empty, no Cancel). `teamSelectHover=ntf|scp` starts with that side highlighted for captures (the mouse still
 * moves it), `teamSelectReject=ntf|scp` makes the mock plugin refuse that side (CS2's "...队伍人数已满。"),
 * `teamSelectFade=1` keeps the opening fade the captures skip.
 */
export const TEAM_SELECT_DEBUG_SCENES = ["ntf", "scp", "forced"] as const;
export type TeamSelectDebugScene = (typeof TEAM_SELECT_DEBUG_SCENES)[number];

export type TeamSelectDebugOptions = Readonly<{
  scene: TeamSelectDebugScene;
  reject: Role | null;
  hover: Role | null;
  fade: boolean;
}>;

const isScene = (value: string | null): value is TeamSelectDebugScene => (TEAM_SELECT_DEBUG_SCENES as readonly (string | null)[]).includes(value);
const isRole = (value: string | null): value is Role => value === "ntf" || value === "scp";

export function readTeamSelectDebugOptions(search = window.location.search): TeamSelectDebugOptions | null {
  const params = new URLSearchParams(search);
  const scene = params.get("teamSelect");
  if (!isScene(scene)) return null;
  const reject = params.get("teamSelectReject");
  const hover = params.get("teamSelectHover");
  return { scene, reject: isRole(reject) ? reject : null, hover: isRole(hover) ? hover : null, fade: params.get("teamSelectFade") === "1" };
}

export function teamMenuOptionsFor(options: TeamSelectDebugOptions): MockTeamMenuOptions {
  return { forced: options.scene === "forced", reject: options.reject };
}

/** The side a capture starts hovered (CS2 highlights the half under the mouse). */
export function teamSelectDebugHover(options: TeamSelectDebugOptions): Role | null {
  return options.hover;
}

const player = (id: number, name: string, online: boolean): HudPlayerView => ({
  player_id: `7656119800000${String(id).padStart(4, "0")}`,
  display_name: name,
  avatar_url: null,
  is_online: online,
  is_alive: true,
  kills: 0,
});

// The captures' bots are offline seats here (SLGO has no bots, so they get CS2's bot row); the names stay.
const NTF_ROSTER: readonly HudPlayerView[] = [
  player(1, "23q3", true),
  player(2, "韦斯利", false),
  player(3, "柯林", false),
  player(4, "大尧", false),
  player(5, "阿多尼斯", false),
];
const SCP_ROSTER: readonly HudPlayerView[] = [
  player(6, "阿苏尔", false),
  player(7, "尤赖", false),
  player(8, "乌尔里克", false),
  player(9, "Ferris", false),
  player(10, "欧文", false),
];

export function teamSelectDebugTeams(options: TeamSelectDebugOptions): readonly TeamSelectTeam[] {
  if (options.scene === "forced") {
    return [{ role: "ntf", relation: "opponent", players: [] }, { role: "scp", relation: "opponent", players: [] }];
  }
  return [
    { role: "ntf", relation: "viewer", players: [...NTF_ROSTER] },
    { role: "scp", relation: "opponent", players: [...SCP_ROSTER] },
  ];
}
