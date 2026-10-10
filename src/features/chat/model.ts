import {
  createCommandId,
  type ChatMessage,
  type ChatNotice,
  type ChatNoticeSegment,
  type ChatScope,
  type ChatSendCommand,
  type CommandResult,
  type ConnectionStatus,
  type MatchSnapshot,
  type Role,
} from "../../contracts/index.ts";

/** Matches the plugin's ChatConstants.MAX_MESSAGE_LENGTH, counted in text elements. */
export const MAX_CHAT_LENGTH = 120;
/** Fallback when no command.result arrives; the sidecar normally answers `timeout` first. */
export const CHAT_COMMAND_TIMEOUT_MS = 10_000;
export const CHAT_HISTORY_LIMIT = 50;
/** Server message/notice ids remembered for de-duplication; well above the history limit. */
export const CHAT_SEEN_LIMIT = 256;
// Provisional until checked against CS2: the plugin's own message area keeps a
// line for 10s and fades it over 1s (ChatConstants.VISIBLE/FADE_DURATION_SECONDS).
export const CHAT_LINE_VISIBLE_MS = 10_000;
export const CHAT_LINE_FADE_MS = 1_000;

/** The plugin rejects spectator chat, so the input offers only these two scopes. */
export type ChatInputScope = "global" | "team";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Counts user-perceived characters, like the plugin's StringInfo.LengthInTextElements. */
export function chatLength(body: string): number {
  return Array.from(segmenter.segment(body)).length;
}

/** Cuts typing at the limit, like Panorama's TextEntry `maxchars`. */
export function clampChatDraft(text: string): string {
  const segments = Array.from(segmenter.segment(text));
  return segments.length <= MAX_CHAT_LENGTH ? text : segments.slice(0, MAX_CHAT_LENGTH).map((part) => part.segment).join("");
}

export function validateChatBody(body: string): string | null {
  const normalized = body.trim();
  if (!normalized) return "消息内容不能为空。";
  if (chatLength(normalized) > MAX_CHAT_LENGTH) return `消息最多允许 ${MAX_CHAT_LENGTH} 个字符。`;
  return null;
}

export function createChatCommand(body: string, scope: ChatInputScope): ChatSendCommand {
  return { kind: "command.chat.send", command_id: createCommandId("chat"), scope, body: body.trim() };
}

// Machine reason codes from the sidecar, the plugin and the local send path.
const FAILURE_TEXT: Readonly<Record<string, string>> = {
  "rate-limited": "发送过于频繁，请稍候。",
  timeout: "服务器未响应。",
  "plugin-unavailable": "游戏服务器暂不可用。",
  "player-not-in-game": "你不在游戏中。",
  "invalid-command": "消息无效。",
  "invalid-payload": "消息无效。",
  "internal-error": "服务器内部错误。",
  "connection-not-live": "未连接服务器。",
  disconnected: "连接已断开。",
};

/** Plugin reasons are already Chinese and shown as-is; known codes are translated, unknown codes are not shown raw. */
export function formatChatFailure(reason: string | undefined): string {
  if (!reason) return "发送失败。";
  return FAILURE_TEXT[reason] ?? (/^[a-z0-9-]+$/.test(reason) ? "发送失败。" : reason);
}

/**
 * Who wrote a player row, frozen when the row arrives (like CS2's text rows, a later
 * side swap does not recolour it). `slot` is the sender's position in their team in
 * the latest match.snapshot, which picks the dot colour; null when not in a team.
 */
export type ChatSender = { id: string; name: string; role: Role | null; slot: { role: Role; index: number } | null };

/**
 * A history row, in arrival (= sequence) order.
 * - `player`: a chat.message; `sender` null is the local echo of an accepted send,
 *   drawn as the local player until the server's copy (same `commandId`) replaces it.
 * - `notice`: a chat.notice from the plugin (money, joins, ...).
 * - `system`: a local send failure, as CS2 prints notices into the same history.
 */
export type ChatLine =
  | { id: string; kind: "player"; scope: ChatScope; sender: ChatSender | null; body: string; commandId: string | null; atMs: number }
  | { id: string; kind: "notice"; segments: ChatNoticeSegment[]; atMs: number }
  | { id: string; kind: "system"; text: string; atMs: number };
export type ChatPending = { commandId: string; scope: ChatInputScope; body: string; sentAtMs: number };
export type ChatSource = { serverId: string; instanceId: string };
/** Player order per team from the latest match.snapshot, for dot colours. */
export type ChatRoster = readonly { role: Role; playerIds: readonly string[] }[];

export type ChatInputState = {
  open: boolean;
  scope: ChatInputScope;
  /** Kept across closes except Esc and a successful send; a rejected message returns here. */
  draft: string;
  pending: ChatPending | null;
  /** Oldest first, at most CHAT_HISTORY_LIMIT rows. */
  lines: ChatLine[];
  /** The server instance the history belongs to; a different one starts a new history. */
  source: ChatSource | null;
  /** Line ids of the newest CHAT_SEEN_LIMIT server messages and notices. */
  seen: string[];
  roster: ChatRoster;
};

export const initialChatInputState: ChatInputState = {
  open: false, scope: "global", draft: "", pending: null, lines: [], source: null, seen: [], roster: [],
};

export type ChatCloseReason = "escape" | "blur" | "unavailable";

export type ChatInputAction =
  | { type: "open"; scope: ChatInputScope }
  | { type: "draft"; text: string }
  | { type: "toggle-scope" }
  | { type: "submit"; command: ChatSendCommand; nowMs: number }
  | { type: "close"; reason: ChatCloseReason }
  | { type: "command-result"; result: CommandResult; nowMs: number }
  | { type: "baseline"; source: ChatSource }
  | { type: "roster"; source: ChatSource; snapshot: MatchSnapshot }
  | { type: "message"; source: ChatSource; message: ChatMessage; nowMs: number }
  | { type: "notice"; source: ChatSource; notice: ChatNotice; nowMs: number }
  | { type: "connection"; status: ConnectionStatus; nowMs: number }
  | { type: "tick"; nowMs: number };

function appendLine(lines: ChatLine[], line: ChatLine): ChatLine[] {
  return [...lines, line].slice(-CHAT_HISTORY_LIMIT);
}

const sameSource = (a: ChatSource | null, b: ChatSource) => a !== null && a.serverId === b.serverId && a.instanceId === b.instanceId;

export function chatSender(message: ChatMessage, roster: ChatRoster): ChatSender {
  let slot: ChatSender["slot"] = null;
  for (const team of roster) {
    const index = team.playerIds.indexOf(message.sender_id);
    if (index >= 0) {
      slot = { role: team.role, index };
      break;
    }
  }
  return { id: message.sender_id, name: message.sender_name, role: message.role ?? null, slot };
}

/** Adds a server row once per id; rows of another instance are never mixed in. */
function receive(state: ChatInputState, source: ChatSource, line: ChatLine): ChatInputState | null {
  if (!sameSource(state.source, source) || state.seen.includes(line.id)) return null;
  return { ...state, seen: [...state.seen, line.id].slice(-CHAT_SEEN_LIMIT) };
}

function receiveMessage(state: ChatInputState, source: ChatSource, message: ChatMessage, nowMs: number): ChatInputState {
  const commandId = message.command_id ?? null;
  const line: ChatLine = { id: `message:${message.message_id}`, kind: "player", scope: message.scope,
    sender: chatSender(message, state.roster), body: message.body, commandId, atMs: nowMs };
  const next = receive(state, source, line);
  if (!next) return state;
  if (commandId !== null) {
    // One row per command: the server's copy takes the echo's place (and fade clock).
    const echo = next.lines.findIndex((row) => row.kind === "player" && row.sender === null && row.commandId === commandId);
    if (echo >= 0) return { ...next, lines: next.lines.map((row, index) => (index === echo ? { ...line, atMs: row.atMs } : row)) };
    if (next.pending?.commandId === commandId) return { ...next, pending: null, lines: appendLine(next.lines, line) };
  }
  return { ...next, lines: appendLine(next.lines, line) };
}

function fail(state: ChatInputState, pending: ChatPending, reason: string | undefined, nowMs: number): ChatInputState {
  return {
    ...state,
    pending: null,
    // Something typed since the send wins over the returned message.
    draft: state.draft.trim() ? state.draft : pending.body,
    lines: appendLine(state.lines, { id: `${pending.commandId}:failed`, kind: "system", text: `发送失败：${formatChatFailure(reason)}`, atMs: nowMs }),
  };
}

export function chatInputReducer(state: ChatInputState, action: ChatInputAction): ChatInputState {
  switch (action.type) {
    case "open":
      return state.open ? state : { ...state, open: true, scope: action.scope };
    case "draft":
      return state.open ? { ...state, draft: clampChatDraft(action.text) } : state;
    case "toggle-scope":
      return state.open ? { ...state, scope: state.scope === "global" ? "team" : "global" } : state;
    case "submit": {
      if (!state.open) return state;
      const { command, nowMs } = action;
      if (command.scope !== "global" && command.scope !== "team") return state;
      return {
        ...state,
        open: false,
        draft: "",
        pending: { commandId: command.command_id, scope: command.scope, body: command.body, sentAtMs: nowMs },
      };
    }
    case "close":
      if (!state.open) return state;
      return { ...state, open: false, draft: action.reason === "escape" ? "" : state.draft };
    case "command-result": {
      const { result, nowMs } = action;
      const pending = state.pending;
      if (result.command_kind !== "command.chat.send" || pending?.commandId !== result.command_id) return state;
      if (result.status === "accepted" || result.status === "duplicate") {
        // The server's chat.message normally arrived first and cleared `pending`;
        // otherwise echo the message until it does.
        return { ...state, pending: null, lines: appendLine(state.lines, { id: `echo:${pending.commandId}`, kind: "player",
          scope: pending.scope, sender: null, body: pending.body, commandId: pending.commandId, atMs: nowMs }) };
      }
      return fail(state, pending, result.reason, nowMs);
    }
    case "baseline":
      // Same instance (a reconnect): keep the history. Another server or instance: start over.
      return sameSource(state.source, action.source) ? state : { ...state, source: action.source, lines: [], seen: [], roster: [] };
    case "roster":
      return sameSource(state.source, action.source)
        ? { ...state, roster: action.snapshot.teams.map((team) => ({ role: team.role, playerIds: team.players.map((player) => player.player_id) })) }
        : state;
    case "message":
      return receiveMessage(state, action.source, action.message, action.nowMs);
    case "notice": {
      const line: ChatLine = { id: `notice:${action.notice.notice_id}`, kind: "notice", segments: action.notice.segments, atMs: action.nowMs };
      const next = receive(state, action.source, line);
      return next ? { ...next, lines: appendLine(next.lines, line) } : state;
    }
    case "connection": {
      if (action.status === "live") return state;
      // The history belonged to the ended instance; a pending send can no longer be answered.
      if (action.status === "ended") return initialChatInputState;
      const closed = state.open ? { ...state, open: false } : state;
      // A stale stream may still deliver the result; anything else has lost it.
      return closed.pending && action.status !== "stale" ? fail(closed, closed.pending, "disconnected", action.nowMs) : closed;
    }
    case "tick":
      return state.pending && action.nowMs - state.pending.sentAtMs >= CHAT_COMMAND_TIMEOUT_MS
        ? fail(state, state.pending, "timeout", action.nowMs)
        : state;
  }
}

/**
 * Rows on screen: the open panel shows the whole history; closed, rows linger
 * until their fade has finished. The fade itself is a CSS animation, see
 * chatLineFadeDelayMs.
 */
export function visibleChatLines(state: ChatInputState, nowMs: number): ChatLine[] {
  return state.open ? state.lines : state.lines.filter((line) => nowMs - line.atMs < CHAT_LINE_VISIBLE_MS + CHAT_LINE_FADE_MS);
}

/** Delay before a lingering row starts fading; negative once the fade is under way. */
export function chatLineFadeDelayMs(line: ChatLine, nowMs: number): number {
  return line.atMs + CHAT_LINE_VISIBLE_MS - nowMs;
}
