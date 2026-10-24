import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HUD_EVENT_TYPES, initialRoundHudState, roundHudReducer } from "../src/features/hud/model.ts";
import { initialWinPanelState, WIN_PANEL_EVENT_TYPES, winPanelReducer } from "../src/features/winpanel/model.ts";
import { HUD_MESSAGES_EVENT_TYPES, hudMessagesReducer, initialHudMessagesState } from "../src/features/hudmessages/model.ts";
import { HUD_STATUS_EVENT_TYPES, hudStatusReducer, initialHudStatusState } from "../src/features/bottomhud/model.ts";
import { initialKillfeedState, KILLFEED_EVENT_TYPES, killfeedReducer } from "../src/features/killfeed/model.ts";
import { initialScoreboardState, SCOREBOARD_EVENT_TYPES, scoreboardReducer } from "../src/features/scoreboard/model.ts";
import { initialShopState, SHOP_EVENT_TYPES, shopReducer } from "../src/features/shop/model.ts";
import { initialTeamSelectState, TEAM_SELECT_EVENT_TYPES, teamSelectReducer } from "../src/features/teamselect/model.ts";

// App dispatches an event only to the reducers whose *_EVENT_TYPES list its type (a dispatch re-renders App,
// and minimap positions arrive at 15 Hz). Every reducer must ignore every other event type, so the lists are
// exactly what the reducers read.

// Every type in the protocol's SlgoEvent union, read from its source so a new type is covered too.
const protocol = readFileSync(new URL("../packages/protocol/src/index.ts", import.meta.url), "utf8");
const union = protocol.slice(protocol.indexOf("export type SlgoEvent ="), protocol.indexOf(";", protocol.indexOf("export type SlgoEvent =")));
const aliasTypes = Object.fromEntries([...protocol.matchAll(/export type (\w+Event) = ProtocolEnvelope<[^,]+, "([a-z.]+)">/g)].map(([, name, type]) => [name, type]));
const eventTypes = [...union.matchAll(/\|\s*(?:ProtocolEnvelope<[^,]+, "([a-z.]+)">|(\w+Event)\b)/g)].map(([, inline, alias]) => inline ?? aliasTypes[alias]);
assert.ok(eventTypes.length >= 15, `parsed ${eventTypes.length} event types`);
assert.ok(eventTypes.every((type) => typeof type === "string" && type.length > 0), `unresolved event types: ${eventTypes}`);
assert.ok(eventTypes.includes("minimap.positions") && eventTypes.includes("sidecar.baseline"));

let sequence = 0;
const event = (type, instance = "instance-a") => ({
  protocol_version: 0,
  schema_version: 1,
  event_id: `${type}-${++sequence}`,
  server_id: "server-a",
  instance_id: instance,
  sequence,
  type,
  sent_at: new Date(1_000).toISOString(),
  payload: type === "sidecar.baseline" ? { baseline: true } : {},
});

const reducers = [
  ["round HUD", roundHudReducer, initialRoundHudState, HUD_EVENT_TYPES, true],
  ["win panel", winPanelReducer, initialWinPanelState, WIN_PANEL_EVENT_TYPES, true],
  ["hud messages", hudMessagesReducer, initialHudMessagesState, HUD_MESSAGES_EVENT_TYPES, true],
  ["hud status", hudStatusReducer, initialHudStatusState, HUD_STATUS_EVENT_TYPES, false],
  ["killfeed", killfeedReducer, initialKillfeedState, KILLFEED_EVENT_TYPES, true],
  ["scoreboard", scoreboardReducer, initialScoreboardState, SCOREBOARD_EVENT_TYPES, true],
  ["shop", shopReducer, initialShopState, SHOP_EVENT_TYPES, true],
  ["team select", teamSelectReducer, initialTeamSelectState, TEAM_SELECT_EVENT_TYPES, true],
];

for (const [name, reducer, initial, types, timed] of reducers) {
  assert.ok(types.has("sidecar.baseline"), `${name} reads the baseline`);
  for (const type of types) assert.ok(eventTypes.includes(type), `${name} lists ${type}, which is no protocol event`);
  const action = (evt) => timed ? { type: "event", event: evt, receivedAtMs: 1_000 } : { type: "event", event: evt };
  let state = reducer(initial, { type: "connection", status: "live" });
  state = reducer(state, action(event("sidecar.baseline")));
  assert.notEqual(state, initial, `${name} takes the baseline`);
  for (const type of eventTypes.filter((candidate) => !types.has(candidate))) {
    assert.equal(reducer(state, action(event(type))), state, `${name} ignores ${type}`);
  }
}

console.log(`event routing smoke passed (${eventTypes.length} event types, ${reducers.length} reducers)`);
