import assert from "node:assert/strict";
import {
  CHAT_COMMAND_TIMEOUT_MS,
  CHAT_HISTORY_LIMIT,
  CHAT_LINE_FADE_MS,
  CHAT_LINE_VISIBLE_MS,
  CHAT_SEEN_LIMIT,
  MAX_CHAT_LENGTH,
  chatInputReducer,
  chatLength,
  chatLineFadeDelayMs,
  clampChatDraft,
  createChatCommand,
  formatChatFailure,
  initialChatInputState,
  validateChatBody,
  visibleChatLines,
} from "../src/features/chat/model.ts";
import { CHAT_NOTICE_TONE_COLORS, resolveChatSelf, resolveChatSender } from "../src/features/chat/presentation.ts";
import { PLAYER_COLORS } from "../src/features/hud/presentation.ts";
import { ROLE_COLORS } from "../src/shared/roleColors.ts";

// Validation mirrors the plugin: trimmed, non-empty, at most 120 text elements.
assert.equal(validateChatBody("   "), "消息内容不能为空。");
assert.equal(validateChatBody("x".repeat(MAX_CHAT_LENGTH)), null);
assert.equal(validateChatBody("x".repeat(MAX_CHAT_LENGTH + 1)), `消息最多允许 ${MAX_CHAT_LENGTH} 个字符。`);
assert.equal(validateChatBody(`  ${"中".repeat(MAX_CHAT_LENGTH)}  `), null, "surrounding blanks do not count");
assert.equal(chatLength("👍🏽"), 1, "an emoji with a skin tone is one element, not four UTF-16 units");
assert.equal(chatLength("👨‍👩‍👧"), 1, "a ZWJ family is one element");
assert.equal(validateChatBody("👍".repeat(MAX_CHAT_LENGTH)), null, "emoji are counted as characters, not code units");
assert.equal(clampChatDraft("中".repeat(MAX_CHAT_LENGTH + 5)), "中".repeat(MAX_CHAT_LENGTH), "typing stops at the limit, like TextEntry maxchars");
assert.equal(clampChatDraft("👍🏽".repeat(MAX_CHAT_LENGTH + 1)), "👍🏽".repeat(MAX_CHAT_LENGTH), "the cut never splits a character");

const command = createChatCommand("  hello  ", "team");
assert.equal(command.kind, "command.chat.send");
assert.equal(command.body, "hello");
assert.equal(command.scope, "team");
assert.match(command.command_id, /^chat-/);

// Reason mapping: plugin Chinese as-is, known codes translated, unknown codes hidden.
assert.equal(formatChatFailure("发送过于频繁，请稍候。"), "发送过于频繁，请稍候。");
assert.equal(formatChatFailure("rate-limited"), "发送过于频繁，请稍候。");
assert.equal(formatChatFailure("player-not-in-game"), "你不在游戏中。");
assert.equal(formatChatFailure("some-new-code"), "发送失败。");
assert.equal(formatChatFailure(undefined), "发送失败。");

const reduce = (state, ...actions) => actions.reduce(chatInputReducer, state);

// Opening: the key decides the scope; a second open while open changes nothing.
let state = reduce(initialChatInputState, { type: "open", scope: "team" });
assert.equal(state.open, true);
assert.equal(state.scope, "team");
assert.equal(reduce(state, { type: "open", scope: "global" }).scope, "team", "Y/U while typing never switches scope");
state = reduce(state, { type: "toggle-scope" });
assert.equal(state.scope, "global");
assert.equal(reduce(initialChatInputState, { type: "draft", text: "x" }).draft, "", "a closed input ignores typing");

// Esc discards; blur and unavailability keep the draft.
state = reduce(state, { type: "draft", text: "rotate B" });
assert.equal(reduce(state, { type: "close", reason: "escape" }).draft, "");
const blurred = reduce(state, { type: "close", reason: "blur" });
assert.equal(blurred.open, false);
assert.equal(blurred.draft, "rotate B");
assert.equal(reduce(blurred, { type: "open", scope: "team" }).draft, "rotate B", "reopening restores the draft");
assert.equal(reduce(state, { type: "connection", status: "offline", nowMs: 0 }).draft, "rotate B");
assert.equal(reduce(state, { type: "connection", status: "offline", nowMs: 0 }).open, false, "leaving live closes the input");

assert.equal(reduce(state, { type: "draft", text: "x".repeat(MAX_CHAT_LENGTH + 1) }).draft.length, MAX_CHAT_LENGTH);

// Submit closes and clears at once; the result lands in the history.
const sent = createChatCommand("rotate B", "global");
state = reduce(state, { type: "submit", command: sent, nowMs: 1_000 });
assert.equal(state.open, false);
assert.equal(state.draft, "");
assert.deepEqual(state.lines, [], "nothing is shown until the server answers");
assert.equal(state.pending?.commandId, sent.command_id);
assert.equal(reduce(initialChatInputState, { type: "submit", command: sent, nowMs: 0 }).pending, null, "a closed input cannot submit");

// Results for other commands or kinds are ignored.
const accepted = { command_id: sent.command_id, command_kind: "command.chat.send", status: "accepted" };
assert.equal(reduce(state, { type: "command-result", result: { ...accepted, command_id: "other" }, nowMs: 1_100 }).pending?.commandId, sent.command_id);
assert.equal(reduce(state, { type: "command-result", result: { ...accepted, command_kind: "command.shop.purchase" }, nowMs: 1_100 }).pending?.commandId, sent.command_id);

// Accepted before the server's copy: the message is echoed as the player's own row.
const ok = reduce(state, { type: "command-result", result: accepted, nowMs: 1_100 });
assert.equal(ok.pending, null);
assert.deepEqual(ok.lines, [{ id: `echo:${sent.command_id}`, kind: "player", scope: "global", sender: null, body: "rotate B", commandId: sent.command_id, atMs: 1_100 }]);
assert.equal(ok.draft, "", "an accepted message is not restored");
assert.equal(reduce(state, { type: "command-result", result: { ...accepted, status: "duplicate" }, nowMs: 1_100 }).lines[0]?.sender, null, "duplicate means the first send went through");

// Closed, rows linger until their fade ends; open, the whole history shows.
assert.equal(visibleChatLines(ok, 1_100 + CHAT_LINE_VISIBLE_MS + CHAT_LINE_FADE_MS - 1).length, 1);
assert.deepEqual(visibleChatLines(ok, 1_100 + CHAT_LINE_VISIBLE_MS + CHAT_LINE_FADE_MS), []);
assert.equal(visibleChatLines(reduce(ok, { type: "open", scope: "team" }), 1_000_000).length, 1);
assert.equal(chatLineFadeDelayMs(ok.lines[0], 1_100), CHAT_LINE_VISIBLE_MS, "a new row waits the full visible time");
assert.equal(chatLineFadeDelayMs(ok.lines[0], 1_100 + CHAT_LINE_VISIBLE_MS + 300), -300, "a row closed mid-fade resumes where it was");

// Rejection returns the message as the draft and prints the reason as a notice row.
const rejected = reduce(state, { type: "command-result", result: { ...accepted, status: "rejected", reason: "发送过于频繁，请稍候。" }, nowMs: 1_200 });
assert.deepEqual(rejected.lines.map((line) => [line.kind, line.text]), [["system", "发送失败：发送过于频繁，请稍候。"]]);
assert.equal(rejected.draft, "rotate B");
const reopened = reduce(state, { type: "open", scope: "team" }, { type: "draft", text: "new text" });
assert.equal(reduce(reopened, { type: "command-result", result: { ...accepted, status: "failed", reason: "timeout" }, nowMs: 1_200 }).draft, "new text", "a newer draft is not overwritten");

// Losing the connection or never hearing back fails the pending send.
const lost = reduce(state, { type: "connection", status: "offline", nowMs: 1_300 });
assert.equal(lost.lines.at(-1)?.text, "发送失败：连接已断开。");
assert.equal(lost.draft, "rotate B");
assert.equal(reduce(state, { type: "connection", status: "stale", nowMs: 1_300 }).pending?.commandId, sent.command_id, "a stale stream may still answer");
assert.equal(reduce(state, { type: "tick", nowMs: 1_000 + CHAT_COMMAND_TIMEOUT_MS - 1 }).pending?.commandId, sent.command_id);
assert.equal(reduce(state, { type: "tick", nowMs: 1_000 + CHAT_COMMAND_TIMEOUT_MS }).lines.at(-1)?.text, "发送失败：服务器未响应。");

// History keeps the newest rows only.
let flood = initialChatInputState;
for (let index = 0; index < CHAT_HISTORY_LIMIT + 5; index += 1) {
  const command = createChatCommand(`m${index}`, "team");
  flood = reduce(flood, { type: "open", scope: "team" }, { type: "submit", command, nowMs: index },
    { type: "command-result", result: { command_id: command.command_id, command_kind: command.kind, status: "accepted" }, nowMs: index });
}
assert.equal(flood.lines.length, CHAT_HISTORY_LIMIT);
assert.equal(flood.lines[0].body, "m5");

// ===== Received history: chat.message / chat.notice =====
const source = { serverId: "slgo-local-7777", instanceId: "instance-1" };
const NOVA = "76561198000000001";
const ATLAS = "76561198000000002";
const ROOK = "76561198000000006";
const snapshot = {
  viewer_team_id: "team-a", state: "ActionPhase", round: 1, max_rounds: 15, phase_remaining_ms: 0, phase_paused: false,
  teams: [
    { team_id: "team-a", role: "ntf", display_name: "A", score: 0, players: [{ player_id: NOVA }, { player_id: ATLAS }] },
    { team_id: "team-b", role: "scp", display_name: "B", score: 0, players: [{ player_id: ROOK }] },
  ],
};
const message = (id, extra = {}) => ({ message_id: id, scope: "team", sender_id: ATLAS, sender_name: "Atlas", team_id: "team-a", role: "ntf", body: `body ${id}`, sent_at: "2026-09-29T08:00:00Z", ...extra });
const notice = (id) => ({ notice_id: id, segments: [{ text: "击杀奖励 ", tone: "default" }, { text: "+300$", tone: "money" }], sent_at: "2026-09-29T08:00:00Z" });
const live = reduce(initialChatInputState, { type: "baseline", source }, { type: "roster", source, snapshot });

// Only the current instance's events count; nothing is shown before a baseline.
assert.deepEqual(reduce(initialChatInputState, { type: "message", source, message: message("m0"), nowMs: 0 }).lines, []);
assert.deepEqual(reduce(live, { type: "message", source: { ...source, instanceId: "old" }, message: message("m0"), nowMs: 0 }).lines, []);

// Rows arrive in order; a repeated id is dropped.
let history = reduce(live,
  { type: "message", source, message: message("m1"), nowMs: 10 },
  { type: "notice", source, notice: notice("n1"), nowMs: 11 },
  { type: "message", source, message: message("m1"), nowMs: 12 },
  { type: "notice", source, notice: notice("n1"), nowMs: 13 },
  { type: "message", source, message: message("m2", { scope: "global", sender_id: ROOK, sender_name: "Rook", team_id: "team-b", role: "scp" }), nowMs: 14 });
assert.deepEqual(history.lines.map((line) => line.id), ["message:m1", "notice:n1", "message:m2"]);
assert.deepEqual(history.lines[1].segments.map((segment) => segment.tone), ["default", "money"]);

// Other players: same format, team colour by role, dot by their slot in the latest match.snapshot.
assert.deepEqual(history.lines[0].sender, { id: ATLAS, name: "Atlas", role: "ntf", slot: { role: "ntf", index: 1 } });
assert.deepEqual(resolveChatSender(history.lines[0].sender), { name: "Atlas", teamTag: "[NTF]", teamColor: ROLE_COLORS.ntf, dotColor: PLAYER_COLORS.t[1] });
assert.deepEqual(resolveChatSender(history.lines[2].sender), { name: "Rook", teamTag: "[SCP]", teamColor: ROLE_COLORS.scp, dotColor: PLAYER_COLORS.ct[0] });
assert.deepEqual(resolveChatSender({ id: "x", name: "Ghost", role: null, slot: null }), { name: "Ghost", teamTag: null, teamColor: "white", dotColor: "white" });
const self = resolveChatSelf({ role: "ntf", players: [{ player_id: NOVA, display_name: "Nova" }, { player_id: ATLAS, display_name: "Atlas" }] }, ATLAS);
assert.deepEqual(resolveChatSender(history.lines[0].sender), self, "a received own row looks exactly like the local echo");
assert.equal(CHAT_NOTICE_TONE_COLORS.money, "#4CAF50");
// The style is frozen on arrival: a later swap does not recolour old rows.
const swapped = reduce(history, { type: "roster", source, snapshot: { ...snapshot, teams: [snapshot.teams[1], snapshot.teams[0]] } });
assert.deepEqual(swapped.lines[0].sender.slot, { role: "ntf", index: 1 });

// Reconnect to the same instance keeps the history and the seen ids; the sidecar
// does not replay chat, but a repeat would still be dropped.
const reconnected = reduce(history, { type: "connection", status: "offline", nowMs: 20 }, { type: "baseline", source },
  { type: "message", source, message: message("m1"), nowMs: 21 });
assert.deepEqual(reconnected.lines.map((line) => line.id), ["message:m1", "notice:n1", "message:m2"]);
// Another instance (server restarted) or another server starts a new history.
const restarted = { ...source, instanceId: "instance-2" };
const fresh = reduce(history, { type: "baseline", source: restarted });
assert.deepEqual(fresh.lines, []);
assert.deepEqual(fresh.seen, []);
assert.deepEqual(fresh.roster, []);
assert.deepEqual(reduce(fresh, { type: "message", source: restarted, message: message("m1"), nowMs: 30 }).lines.map((line) => line.id), ["message:m1"], "ids are per instance");
assert.deepEqual(reduce(history, { type: "baseline", source: { ...source, serverId: "other" } }).lines, []);

// Own message, plugin order: chat.message (with command_id) before command.result.
const own = createChatCommand("rotate A", "team");
const ownMessage = message("m3", { sender_id: NOVA, sender_name: "Nova", body: "rotate A", command_id: own.command_id });
let mine = reduce(live, { type: "open", scope: "team" }, { type: "submit", command: own, nowMs: 100 },
  { type: "message", source, message: ownMessage, nowMs: 150 });
assert.equal(mine.pending, null, "the server's copy settles the send");
assert.deepEqual(mine.lines.map((line) => [line.id, line.sender?.name]), [["message:m3", "Nova"]]);
mine = reduce(mine, { type: "command-result", result: { command_id: own.command_id, command_kind: own.kind, status: "accepted" }, nowMs: 160 });
assert.equal(mine.lines.length, 1, "the later result adds no echo");
assert.equal(reduce(mine, { type: "tick", nowMs: 100 + CHAT_COMMAND_TIMEOUT_MS }).lines.length, 1, "no timeout after the message arrived");

// Own message, reverse order (fake plugin, or the message queued behind): echo, then replaced in place.
let echoed = reduce(live, { type: "open", scope: "team" }, { type: "submit", command: own, nowMs: 100 },
  { type: "command-result", result: { command_id: own.command_id, command_kind: own.kind, status: "accepted" }, nowMs: 140 },
  { type: "notice", source, notice: notice("n2"), nowMs: 145 });
assert.deepEqual(echoed.lines.map((line) => line.id), [`echo:${own.command_id}`, "notice:n2"]);
echoed = reduce(echoed, { type: "message", source, message: ownMessage, nowMs: 170 });
assert.deepEqual(echoed.lines.map((line) => line.id), ["message:m3", "notice:n2"], "one row per command, in the echo's place");
assert.equal(echoed.lines[0].atMs, 140, "the replacement keeps the echo's fade clock");
assert.equal(echoed.lines[0].sender.name, "Nova");
// A message carrying someone else's (or an unknown) command id is just a message.
assert.equal(reduce(live, { type: "message", source, message: message("m4", { command_id: "chat-other" }), nowMs: 0 }).lines.length, 1);

// De-duplication memory is bounded.
let many = live;
for (let index = 0; index < CHAT_SEEN_LIMIT + 10; index += 1) many = reduce(many, { type: "notice", source, notice: notice(`n${index}`), nowMs: index });
assert.equal(many.seen.length, CHAT_SEEN_LIMIT);
assert.equal(many.lines.length, CHAT_HISTORY_LIMIT);

console.log("chat model smoke passed");
