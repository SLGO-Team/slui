import type { ChatNoticeTone, Role } from "../../contracts/index.ts";
import { ROLE_COLORS } from "../../shared/roleColors.ts";
import { PLAYER_COLORS, hudSideForRole } from "../hud/presentation.ts";
import type { ChatInputScope, ChatSender } from "./model.ts";

// CS2 resolves these in C++ (#SFUI_Settings_Chat_Say, #SFUI_Settings_Chat_ButtonLabel
// and the history row format); the values are read from 1920x1080-equivalent
// screenshots of the Chinese client.
export const CHAT_PLACEHOLDER: Readonly<Record<ChatInputScope, string>> = { global: "全局聊天", team: "队内聊天" };
export const CHAT_SEND_LABEL = "发送";
export const CHAT_GLOBAL_TAG = "[ALL]";
export const CHAT_TEAM_FALLBACK_TAG = "[TEAM]";
export const CHAT_FALLBACK_SELF_NAME = "我";

// Plugin notices keep the plugin's own message-area colours
// (SLGO UIConstants.Colors: White, MoneyGreen, NeutralGray).
export const CHAT_NOTICE_TONE_COLORS: Readonly<Record<ChatNoticeTone, string>> = {
  default: "white",
  money: "#4CAF50",
  muted: "#A9A9A9",
};

/** How a player row is labelled and coloured: name, team tag, team colour and slot colour dot. */
export type ChatRowStyle = { name: string; teamTag: string | null; teamColor: string; dotColor: string };

type ViewerTeam = { role: Role; players: readonly { player_id: string; display_name: string }[] };

// CS2 tags team rows with the side ([T]/[CT]); SLGO shows its own team role, and
// colours the tag and name with its team colours where CS2 uses side colours.
const teamTag = (role: Role) => `[${role.toUpperCase()}]`;

function slotColor(role: Role, index: number): string {
  const colors = PLAYER_COLORS[hudSideForRole(role)];
  return colors[index % colors.length];
}

/** The local player, for the echo of a send the server has not published yet. */
export function resolveChatSelf(team: ViewerTeam | null, steamId: string | null): ChatRowStyle {
  if (!team) return { name: CHAT_FALLBACK_SELF_NAME, teamTag: null, teamColor: "white", dotColor: "white" };
  const index = team.players.findIndex((player) => player.player_id === steamId);
  return {
    name: index >= 0 ? team.players[index].display_name : CHAT_FALLBACK_SELF_NAME,
    teamTag: teamTag(team.role),
    teamColor: ROLE_COLORS[team.role],
    dotColor: index >= 0 ? slotColor(team.role, index) : "white",
  };
}

/** Any player's row, the local player's included, formatted exactly like the echo. */
export function resolveChatSender(sender: ChatSender): ChatRowStyle {
  return {
    name: sender.name,
    teamTag: sender.role ? teamTag(sender.role) : null,
    teamColor: sender.role ? ROLE_COLORS[sender.role] : "white",
    dotColor: sender.slot ? slotColor(sender.slot.role, sender.slot.index) : "white",
  };
}
