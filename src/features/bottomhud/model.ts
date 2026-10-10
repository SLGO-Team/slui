import type { ConnectionStatus, HudAmmo, HudKillKind, HudStatusSnapshot, Role, SlgoEvent } from "../../contracts/index.ts";
import type { RoundHudViewModel } from "../hud/model.ts";

/** The sidecar instance the status belongs to; another one clears it. */
export type HudStatusSource = { serverId: string; instanceId: string };

export type HudStatusState = {
  source: HudStatusSource | null;
  /** Latest `hud.status` of that instance, or null before the first one. */
  status: HudStatusSnapshot | null;
};

export const initialHudStatusState: HudStatusState = { source: null, status: null };

export type HudStatusAction = { type: "event"; event: SlgoEvent } | { type: "connection"; status: ConnectionStatus };

const sameSource = (source: HudStatusSource | null, serverId: string, instanceId: string) =>
  source !== null && source.serverId === serverId && source.instanceId === instanceId;

/** Keeps the latest `hud.status` of the baseline's instance; a reconnect to the same instance keeps it until the replay. */
export function hudStatusReducer(state: HudStatusState, action: HudStatusAction): HudStatusState {
  // Only an ended instance drops the status; other drops keep it for a reconnect to the same instance.
  if (action.type === "connection") return action.status === "ended" && state !== initialHudStatusState ? initialHudStatusState : state;
  const { event } = action;
  if (event.type === "sidecar.baseline") {
    if (sameSource(state.source, event.server_id, event.instance_id)) return state;
    return { source: { serverId: event.server_id, instanceId: event.instance_id }, status: null };
  }
  if (event.type !== "hud.status" || !sameSource(state.source, event.server_id, event.instance_id)) return state;
  return { ...state, status: event.payload };
}

const NO_KILLS: readonly HudKillKind[] = [];

/** What the bottom HUD draws for the local player. */
export type BottomHudView = {
  role: Role;
  /** `loadout.money` of the local player's `match.snapshot` entry. */
  balance: number;
  /** Held firearm; null leaves the right block empty (SCP, unarmed, Micro-HID, no `hud.status` yet). */
  ammo: HudAmmo | null;
  /** One kind per kill this round, in order. */
  kills: readonly HudKillKind[];
};

/**
 * The bottom HUD of the local player, or null (hidden) without a snapshot, without a viewer team, when the
 * player is not on it or has no loadout (offline), and while they are dead (user decision 2026-10-07: no
 * spectator panel). Ammo and kills come from `hud.status`, balance and life from `match.snapshot`.
 */
export function selectBottomHud(hud: RoundHudViewModel, status: HudStatusSnapshot | null, localPlayerId: string | null): BottomHudView | null {
  if (!hud.hasSnapshot || localPlayerId === null) return null;
  const team = hud.teams.find((candidate) => candidate.relation === "viewer");
  if (!team || team.relation !== "viewer") return null;
  const player = team.players.find((candidate) => candidate.player_id === localPlayerId);
  if (!player || !player.is_alive || !player.loadout) return null;
  return {
    role: team.role,
    balance: player.loadout.money,
    ammo: status?.ammo ?? null,
    // A stable empty list: the view re-selects on every UI tick, and the kill list's identity marks a change.
    kills: status?.round_kills ?? NO_KILLS,
  };
}
