import type {
  ConnectionStatus,
  HudAmmo,
  HudKillKind,
  HudSpectatingSnapshot,
  HudStatusSnapshot,
  Role,
  ScoreboardSnapshot,
  SlgoEvent,
} from "../../contracts/index.ts";
import type { RoundHudViewModel } from "../hud/model.ts";
import { avatarSource, DEFAULT_AVATAR_BY_SIDE, hudSideForRole } from "../hud/presentation.ts";
import { scoreboardAdr } from "../scoreboard/presentation.ts";

/** The sidecar instance the status belongs to; another one clears it. */
export type HudStatusSource = { serverId: string; instanceId: string };

export type HudStatusState = {
  source: HudStatusSource | null;
  /** Latest `hud.status` of that instance, or null before the first one. */
  status: HudStatusSnapshot | null;
  /** Latest `hud.spectating` of that instance, or null before the first one (an older plugin never sends it). */
  spectating: HudSpectatingSnapshot | null;
};

export const initialHudStatusState: HudStatusState = { source: null, status: null, spectating: null };

export type HudStatusAction = { type: "event"; event: SlgoEvent } | { type: "connection"; status: ConnectionStatus };

const sameSource = (source: HudStatusSource | null, serverId: string, instanceId: string) =>
  source !== null && source.serverId === serverId && source.instanceId === instanceId;

/** The events hudStatusReducer reads; App dispatches no others to it (each dispatch re-renders App). */
export const HUD_STATUS_EVENT_TYPES: ReadonlySet<SlgoEvent["type"]> = new Set<SlgoEvent["type"]>(["sidecar.baseline", "hud.status", "hud.spectating"]);

/**
 * Keeps the latest `hud.status` and `hud.spectating` of the baseline's instance; a reconnect to the same instance
 * keeps them until the replay.
 */
export function hudStatusReducer(state: HudStatusState, action: HudStatusAction): HudStatusState {
  // Only an ended instance drops the status; other drops keep it for a reconnect to the same instance.
  if (action.type === "connection") return action.status === "ended" && state !== initialHudStatusState ? initialHudStatusState : state;
  const { event } = action;
  if (event.type === "sidecar.baseline") {
    if (sameSource(state.source, event.server_id, event.instance_id)) return state;
    return { source: { serverId: event.server_id, instanceId: event.instance_id }, status: null, spectating: null };
  }
  if (!sameSource(state.source, event.server_id, event.instance_id)) return state;
  if (event.type === "hud.status") return { ...state, status: event.payload };
  if (event.type === "hud.spectating") return { ...state, spectating: event.payload };
  return state;
}

const NO_KILLS: readonly HudKillKind[] = [];

/** The watched player's spectator panel (CS2 `HudSpecplayer`): what the bottom HUD adds while the local player spectates. */
export type BottomHudSpectator = {
  name: string;
  avatarUrl: string;
  /** The side's default avatar, for an avatar URL that fails to load. */
  fallbackAvatarUrl: string;
  /** The scoreboard's 伤/局 for the team's current side; 0 before the first `scoreboard.snapshot`. */
  adr: number;
  /** Plugin-resolved label of the held item; null with empty hands. */
  itemName: string | null;
};

/** What the bottom HUD draws: the local player, or the player they watch while dead. */
export type BottomHudView = {
  /** Whose HUD it is; a new subject (a spectating target switch) redraws without kill or balance motion. */
  subjectId: string;
  role: Role;
  /** The subject's balance: `loadout.money` for the local player, `hud.spectating` `money` for a watched one. */
  balance: number;
  /** Held firearm; null leaves the right block empty (SCP, unarmed, Micro-HID, no `hud.status` yet). */
  ammo: HudAmmo | null;
  /** One kind per kill this round, in order. */
  kills: readonly HudKillKind[];
  /** Set while the local player watches someone. */
  spectator: BottomHudSpectator | null;
};

export type BottomHudInput = {
  hud: RoundHudViewModel;
  status: HudStatusSnapshot | null;
  spectating: HudSpectatingSnapshot | null;
  /** For the watched player's ADR; null before the first `scoreboard.snapshot`. */
  scoreboard: ScoreboardSnapshot | null;
  localPlayerId: string | null;
};

/**
 * The bottom HUD, or null (hidden) without a snapshot or a local player.
 * - Alive on the viewer team: the local player (null without a loadout, i.e. offline); ammo and kills from
 *   `hud.status`, balance from `match.snapshot`.
 * - Otherwise (dead, or a team-less observer): the player `hud.spectating` names, if they are in the roster, in their
 *   team's colours (the plugin only names a player this viewer may watch). Null when it names nobody.
 */
export function selectBottomHud({ hud, status, spectating, scoreboard, localPlayerId }: BottomHudInput): BottomHudView | null {
  if (!hud.hasSnapshot || localPlayerId === null) return null;
  const team = hud.teams.find((candidate) => candidate.relation === "viewer");
  const self = team?.relation === "viewer" ? team.players.find((candidate) => candidate.player_id === localPlayerId) : undefined;
  if (team && self?.is_alive) {
    if (!self.loadout) return null;
    return {
      subjectId: self.player_id,
      role: team.role,
      balance: self.loadout.money,
      ammo: status?.ammo ?? null,
      // A stable empty list: the view re-selects on every UI tick, and the kill list's identity marks a change.
      kills: status?.round_kills ?? NO_KILLS,
      spectator: null,
    };
  }
  return selectWatchedHud(hud, spectating, scoreboard);
}

/** The bottom HUD of the player `hud.spectating` names, or null when it names nobody or someone outside the roster. */
export function selectWatchedHud(hud: RoundHudViewModel, spectating: HudSpectatingSnapshot | null, scoreboard: ScoreboardSnapshot | null): BottomHudView | null {
  const target = spectating?.target ?? null;
  if (!hud.hasSnapshot || target === null) return null;
  for (const team of hud.teams) {
    const player = team.players.find((candidate) => candidate.player_id === target.player_id);
    if (!player) continue;
    const side = hudSideForRole(team.role);
    const stats = scoreboard?.players.find((candidate) => candidate.player_id === player.player_id)?.[team.role];
    return {
      subjectId: player.player_id,
      role: team.role,
      balance: target.money,
      ammo: target.ammo,
      kills: target.round_kills,
      spectator: {
        name: player.display_name,
        avatarUrl: avatarSource(player, side),
        fallbackAvatarUrl: DEFAULT_AVATAR_BY_SIDE[side],
        adr: stats ? scoreboardAdr(stats) : 0,
        itemName: target.item_name,
      },
    };
  }
  return null;
}
