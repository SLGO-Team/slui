import assert from "node:assert/strict";
import {
  canSendTeamCommand,
  createTeamCloseCommand,
  createTeamSelectCommand,
  initialTeamSelectState,
  TEAM_SELECT_COMMAND_TIMEOUT_MS,
  TEAM_SELECT_ERROR_MS,
  TEAM_SELECT_EVENT_TYPES,
  TEAM_SELECT_FALLBACK_ERROR,
  teamSelectReducer,
  visibleTeamMenu,
} from "../src/features/teamselect/model.ts";
import { closeCommandFor, commandForSide, selectTeamSelect, teamSelectErrorAt } from "../src/features/teamselect/presentation.ts";

const envelope = (type, payload, { serverId = "slgo-1", instanceId = "instance-1", sequence = 2 } = {}) => ({
  protocol_version: 0,
  schema_version: 1,
  event_id: `${type}-${sequence}`,
  server_id: serverId,
  instance_id: instanceId,
  round_id: null,
  sequence,
  type,
  payload,
});
const baseline = (options) => envelope("sidecar.baseline", { baseline: true }, { ...options, sequence: 1 });
const menu = (sessionId, forced = false, options) => envelope("team.menu", { menu: { session_id: sessionId, forced } }, options);
const closed = (options) => envelope("team.menu", { menu: null }, options);
const event = (e, receivedAtMs = 1_000) => ({ type: "event", event: e, receivedAtMs });
const result = (command, status, reason) => ({
  type: "command-result",
  result: { command_id: command.command_id, command_kind: command.kind, status, ...(reason === undefined ? {} : { reason }) },
  receivedAtMs: 2_000,
});
const run = (state, ...actions) => actions.reduce(teamSelectReducer, state);

const live = run(initialTeamSelectState, { type: "connection", status: "live" }, event(baseline()));

{
  // Source rules: only the baseline's instance; another instance clears the menu, a reconnect keeps it.
  assert.equal(run(initialTeamSelectState, { type: "connection", status: "live" }, event(menu("7"))).menu, null, "no menu before the baseline");
  const open = run(live, event(menu("7")));
  assert.deepEqual(open.menu, { session_id: "7", forced: false });
  assert.equal(run(open, event(menu("8", false, { instanceId: "other" }))).menu.session_id, "7", "another instance's frame is ignored");
  assert.equal(run(open, event(baseline())), open, "the same instance keeps it");
  assert.equal(run(open, event(baseline({ instanceId: "instance-2" }))).menu, null, "a new instance clears it");
  assert.equal(run(open, { type: "connection", status: "ended" }).menu, null, "an ended instance clears it");
  for (const status of ["not-in-game", "game-not-running"]) assert.equal(run(open, { type: "connection", status }).menu, null, `${status} ends the match`);
  const stale = run(open, { type: "connection", status: "stale" });
  assert.equal(stale.menu.session_id, "7", "a lost connection keeps the session for the replay");
  assert.equal(visibleTeamMenu(stale), null, "but nothing is drawn or sent until the stream is live again");
  assert.equal(visibleTeamMenu(run(stale, { type: "connection", status: "live" })).session_id, "7");
  assert.equal(run(open, event(closed())).menu, null, "menu: null closes it");
  const released = run(open, { type: "released" });
  assert.equal(visibleTeamMenu(released), null, "a disabled overlay lets the stale session go");
  assert.equal(visibleTeamMenu(run(released, event(menu("7")))).session_id, "7", "the replayed session shows again");
  assert.equal(run(released, { type: "released" }), released, "releasing nothing keeps the state");
  assert.ok(TEAM_SELECT_EVENT_TYPES.has("team.menu") && TEAM_SELECT_EVENT_TYPES.has("sidecar.baseline") && TEAM_SELECT_EVENT_TYPES.size === 2);
}

{
  // Close: hidden at once; the next session shows again; a refused close (forced) brings it back with the reason.
  const open = run(live, event(menu("7")));
  const close = createTeamCloseCommand("7");
  const closing = run(open, { type: "command", command: close, sentAtMs: 1_500 });
  assert.equal(visibleTeamMenu(closing), null, "Cancel hides the menu before the plugin answers");
  assert.equal(canSendTeamCommand(closing), false);
  const done = run(closing, result(close, "accepted"));
  assert.equal(done.pending, null);
  assert.equal(visibleTeamMenu(done), null, "still hidden until the plugin's menu: null");
  assert.equal(visibleTeamMenu(run(done, event(menu("8")))).session_id, "8", "a new session shows");
  const refused = run(closing, result(close, "rejected", "forced-menu"));
  assert.equal(visibleTeamMenu(refused).session_id, "7", "a refused close shows the menu again");
}

{
  // Select: one command at a time; accepted hides the menu, a refusal keeps it with the error for 5 s.
  const open = run(live, event(menu("7", true)));
  const join = createTeamSelectCommand("scp");
  const joining = run(open, { type: "command", command: join, sentAtMs: 1_500 });
  assert.equal(visibleTeamMenu(joining).session_id, "7", "the menu stays while the choice is pending");
  assert.equal(run(joining, { type: "command", command: createTeamSelectCommand("ntf"), sentAtMs: 1_600 }), joining, "a second click waits");
  assert.equal(visibleTeamMenu(run(joining, result(join, "accepted"))), null, "success hides the menu");
  const full = run(joining, result(join, "rejected", "SCP队伍人数已满。"));
  assert.equal(visibleTeamMenu(full).session_id, "7", "a refusal keeps the menu");
  assert.deepEqual(full.error, { text: "SCP队伍人数已满。", untilMs: 2_000 + TEAM_SELECT_ERROR_MS });
  assert.equal(teamSelectErrorAt(full.error, 2_000 + TEAM_SELECT_ERROR_MS - 1), "SCP队伍人数已满。");
  assert.equal(teamSelectErrorAt(full.error, 2_000 + TEAM_SELECT_ERROR_MS), null, "CS2's error panel hides after 5 s");
  assert.equal(run(joining, result(join, "failed")).error.text, TEAM_SELECT_FALLBACK_ERROR, "a refusal without text");
  assert.equal(run(full, { type: "command", command: createTeamSelectCommand("ntf"), sentAtMs: 2_100 }).error, null, "a new choice clears the error");
  assert.equal(run(joining, result({ command_id: "other", kind: "command.team.select" }, "accepted")), joining, "another command's result is ignored");
  assert.equal(run(joining, { type: "tick", nowMs: 1_500 + TEAM_SELECT_COMMAND_TIMEOUT_MS }).pending?.commandId, join.command_id);
  assert.equal(run(joining, { type: "tick", nowMs: 1_501 + TEAM_SELECT_COMMAND_TIMEOUT_MS }).pending, null, "an unanswered command frees the menu");
  assert.equal(run(joining, { type: "connection", status: "offline" }).pending, null, "a lost connection drops the pending command");
  assert.equal(run(live, { type: "command", command: join, sentAtMs: 1 }), live, "no command without a session");
}

{
  // View: NTF left, SCP right from the HUD teams; rows, subtitles, own-side click closes, forced has no close.
  const player = (id, name, online = true, avatar = null) => ({ player_id: id, display_name: name, avatar_url: avatar, is_online: online, is_alive: true, kills: 0 });
  const hud = [
    { role: "scp", relation: "opponent", players: [player("2", "Ana"), player("3", "Ben", false)] },
    { role: "ntf", relation: "viewer", players: [player("1", "23q3", true, "https://avatars.example/1.jpg")] },
  ];
  const open = run(live, event(menu("7")));
  const view = selectTeamSelect(open, hud);
  assert.deepEqual(view.sides.map((side) => side.role), ["ntf", "scp"]);
  assert.deepEqual(view.sides.map((side) => side.title), ["NTF", "SCP"]);
  assert.deepEqual(view.sides.map((side) => side.subtitle), ["1 玩家", "2 玩家"]);
  assert.equal(view.viewerRole, "ntf");
  assert.equal(view.sides[0].rows[0].avatarUrl, "https://avatars.example/1.jpg");
  assert.equal(view.sides[1].rows[0].avatarUrl, view.sides[1].rows[0].fallbackAvatarUrl, "a missing avatar shows the side's default");
  assert.deepEqual(view.sides[1].rows.map((row) => row.online), [true, false], "an offline seat gets CS2's bot row");
  assert.equal(commandForSide(view, "ntf").kind, "command.team.close", "clicking your own side only closes");
  assert.deepEqual({ ...commandForSide(view, "scp"), command_id: "x" }, { kind: "command.team.select", command_id: "x", team: "scp" });
  assert.equal(closeCommandFor(view).session_id, "7");
  assert.equal(closeCommandFor(selectTeamSelect(run(live, event(menu("9", true))), hud)), null, "a forced menu has no Cancel");
  const unassigned = selectTeamSelect(open, hud.map((team) => ({ ...team, relation: "opponent" })));
  assert.equal(unassigned.viewerRole, null);
  assert.equal(commandForSide(unassigned, "ntf").kind, "command.team.select", "an unassigned player joins either side");
  assert.equal(selectTeamSelect(open, null), null, "no match yet, no panel");
  assert.equal(selectTeamSelect(live, hud), null, "no session, no panel");
  const empty = selectTeamSelect(open, [{ role: "ntf", relation: "opponent", players: [] }, { role: "scp", relation: "opponent", players: [] }]);
  assert.deepEqual(empty.sides.map((side) => side.subtitle), ["0 玩家", "0 玩家"], "empty teams (the first-join capture)");
}

console.log("teamselect model smoke: source rules, close, select, pending, errors and view ok");
