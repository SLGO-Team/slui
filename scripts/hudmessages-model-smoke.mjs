import assert from "node:assert/strict";
import { parseHudMessages } from "../packages/protocol/src/index.ts";
import { createHudSceneFrame, HUD_SCENES } from "../src/mocks/hudScenes.ts";
import {
  formatHudCountdown,
  hudMessagesReducer,
  initialHudMessagesState,
  selectMessageZone,
} from "../src/features/hudmessages/model.ts";

// Message zone (`hud.messages` alert and hint slots): appearance, replacement, expiry, countdown,
// flash, replays and instance changes.

let sequence = 0;
const envelope = (type, payload, instance = "instance-a") => ({
  protocol_version: 0,
  schema_version: 1,
  event_id: `${type}-${++sequence}`,
  server_id: "server-a",
  instance_id: instance,
  sequence,
  type,
  sent_at: "2026-10-06T12:00:00.000Z",
  payload,
});
const baseline = (instance = "instance-a") => envelope("sidecar.baseline", { baseline: true }, instance);
const message = (overrides = {}) => ({
  message_id: "1",
  key: "SFUI_Notice_YouDroppedWeapon",
  text: "您已扔掉 E-11 SR",
  tone: "default",
  visible_remaining_ms: 6_000,
  countdown_remaining_ms: null,
  ...overrides,
});
const board = (slots = {}, instance) => envelope("hud.messages", { progress: null, alert: null, hint_high: null, hint_low: null, ...slots }, instance);
const reduce = (state, event, receivedAtMs) => hudMessagesReducer(state, { type: "event", event, receivedAtMs });

// Every board below is a valid protocol payload.
const timeout = message({
  message_id: "10",
  key: "CSGO_Notice_Alert_Timeout",
  text: "NTF 队暂停还剩 {time_remaining}",
  tone: "info",
  visible_remaining_ms: null,
  countdown_remaining_ms: 58_000,
});
for (const slots of [{ hint_low: message() }, { alert: timeout }, {}]) assert.equal(parseHudMessages(board(slots).payload).ok, true);

// Countdown format: m:ss rounded up, like the plugin's HudMessageCatalog.FormatTimeRemaining.
assert.equal(formatHudCountdown(58_000), "0:58");
assert.equal(formatHudCountdown(57_001), "0:58");
assert.equal(formatHudCountdown(57_000), "0:57");
assert.equal(formatHudCountdown(61_000), "1:01");
assert.equal(formatHudCountdown(1), "0:01");
assert.equal(formatHudCountdown(0), "0:00");
assert.equal(formatHudCountdown(-5), "0:00");

// Nothing before a baseline, and nothing from another instance.
assert.equal(reduce(initialHudMessagesState, board({ hint_low: message() }), 1_000), initialHudMessagesState);
let state = reduce(initialHudMessagesState, baseline(), 1_000);
assert.equal(reduce(state, board({ hint_low: message() }, "instance-b"), 1_000), state);

// Appear: one slot, from its receive time; the other slots stay empty.
state = reduce(state, board({ hint_low: message() }), 10_000);
let zone = selectMessageZone(state, 10_000);
assert.equal(zone.alert, null);
assert.equal(zone.hintHigh, null);
assert.ok(zone.hintLow);
assert.equal(zone.hintLow.slot, "hint_low");
assert.equal(zone.hintLow.text, "您已扔掉 E-11 SR");
assert.equal(zone.hintLow.shownAtMs, 10_000);
assert.equal(zone.hintLow.expiresAtMs, 16_000);
assert.equal(zone.hintLow.flash, null);
const firstId = zone.hintLow.id;

// Replacement while showing: the text swaps in place, same mount, new lifetime.
state = reduce(state, board({ hint_low: message({ message_id: "2", key: "SLGO_Notice_Got_Commander_Keycard", text: "你捡起了指挥官钥匙卡。", tone: "gold" }) }), 12_000);
zone = selectMessageZone(state, 12_000);
assert.equal(zone.hintLow.id, firstId, "a replacement never re-runs the enter animation");
assert.equal(zone.hintLow.text, "你捡起了指挥官钥匙卡。");
assert.equal(zone.hintLow.tone, "gold");
assert.equal(zone.hintLow.shownAtMs, 10_000);
assert.equal(zone.hintLow.expiresAtMs, 18_000);

// Local expiry: hidden once its own lifetime runs out, without a clearing frame.
assert.ok(selectMessageZone(state, 17_999).hintLow);
assert.equal(selectMessageZone(state, 18_000).hintLow, null);
// A late replay of the expired message stays hidden...
let replayed = reduce(state, board({ hint_low: message({ message_id: "2", visible_remaining_ms: 300 }) }), 18_100);
assert.equal(selectMessageZone(replayed, 18_100).hintLow, null);
// ...a new message is a new appearance (enter animation again).
replayed = reduce(replayed, board({ hint_low: message({ message_id: "3" }) }), 19_000);
zone = selectMessageZone(replayed, 19_000);
assert.ok(zone.hintLow);
assert.notEqual(zone.hintLow.id, firstId);
assert.equal(zone.hintLow.shownAtMs, 19_000);

// Clearing frame: hidden at once; a replay of the cleared message stays hidden.
let cleared = reduce(state, board({}), 13_000);
assert.equal(selectMessageZone(cleared, 13_000).hintLow, null);
cleared = reduce(cleared, board({ hint_low: message({ message_id: "2", visible_remaining_ms: 4_000 }) }), 13_500);
assert.equal(selectMessageZone(cleared, 13_500).hintLow, null);
// A message that already ran out when it arrives never shows.
assert.equal(selectMessageZone(reduce(cleared, board({ hint_low: message({ message_id: "4", visible_remaining_ms: 0 }) }), 14_000), 14_000).hintLow, null);

// Countdown: {time_remaining} drawn locally as m:ss from the interpolated value; rewrites keep the mount.
state = reduce(reduce(initialHudMessagesState, baseline(), 0), board({ alert: timeout }), 20_000);
zone = selectMessageZone(state, 20_000);
assert.equal(zone.alert.text, "NTF 队暂停还剩 0:58");
assert.equal(zone.alert.expiresAtMs, null);
assert.equal(selectMessageZone(state, 20_999).alert.text, "NTF 队暂停还剩 0:58");
assert.equal(selectMessageZone(state, 21_000).alert.text, "NTF 队暂停还剩 0:57");
// The countdown stops at 0:00 and the alert waits for the clearing frame.
assert.equal(selectMessageZone(state, 90_000).alert.text, "NTF 队暂停还剩 0:00");
const alertId = zone.alert.id;
state = reduce(state, board({ alert: { ...timeout, message_id: "11", countdown_remaining_ms: 56_900 } }), 21_100);
zone = selectMessageZone(state, 21_100);
assert.equal(zone.alert.id, alertId);
assert.equal(zone.alert.text, "NTF 队暂停还剩 0:57");
assert.equal(zone.alert.flash, null, "only match point and final round flash");

// Flash: match point and final round play CS2's FlashAnim; a key change restarts it, a rewrite does not.
const matchPoint = message({ message_id: "20", key: "SFUI_Notice_Alert_Match_Point", text: "赛点", tone: "match_point", visible_remaining_ms: 5_000 });
state = reduce(reduce(initialHudMessagesState, baseline(), 0), board({ alert: matchPoint }), 30_000);
zone = selectMessageZone(state, 30_000);
assert.deepEqual(zone.alert.flash, { id: `${zone.alert.id.split("-").at(-1)}-30000`, startedAtMs: 30_000 });
assert.equal(zone.alert.expiresAtMs, 35_000);
const flashId = zone.alert.flash.id;
state = reduce(state, board({ alert: { ...matchPoint, message_id: "21", visible_remaining_ms: 4_000 } }), 31_000);
assert.equal(selectMessageZone(state, 31_000).alert.flash.id, flashId);
state = reduce(state, board({ alert: { ...matchPoint, message_id: "22", key: "SFUI_Notice_Alert_Final_Round", text: "最终局", tone: "final_round" } }), 32_000);
zone = selectMessageZone(state, 32_000);
assert.notEqual(zone.alert.flash.id, flashId);
assert.equal(zone.alert.flash.startedAtMs, 32_000);
// The flash tone only matters in the alert slot.
state = reduce(state, board({ hint_high: { ...matchPoint, message_id: "23" } }), 32_100);
assert.equal(selectMessageZone(state, 32_100).hintHigh.flash, null);

// Instances: a reconnect to the same instance keeps the board, another instance clears it.
const kept = reduce(state, baseline(), 33_000);
assert.equal(kept, state);
const switched = reduce(state, baseline("instance-b"), 33_000);
zone = selectMessageZone(switched, 33_000);
assert.equal(zone.alert, null);
assert.equal(zone.hintHigh, null);
assert.equal(zone.hintLow, null);

// Every mock scene frame is a valid payload, and the all-slots scene fills every message-zone slot.
for (const scene of HUD_SCENES) {
  for (const elapsedMs of [0, 1_500, 4_000, 9_000]) {
    const frame = createHudSceneFrame(scene, "ntf", elapsedMs);
    assert.equal(parseHudMessages(frame.messages).ok, true, `${scene} at ${elapsedMs}ms`);
  }
}
const allSlots = reduce(reduce(initialHudMessagesState, baseline(), 0), board(createHudSceneFrame("all-slots", "ntf", 0).messages), 40_000);
zone = selectMessageZone(allSlots, 40_000);
assert.ok(zone.alert && zone.hintHigh && zone.hintLow);
assert.equal(allSlots.slots.progress.message.key, "SLGO_Progress_Generator_Shutdown");

console.log("hudmessages model smoke passed");
