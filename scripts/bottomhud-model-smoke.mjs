import assert from "node:assert/strict";
import { hudStatusReducer, initialHudStatusState, selectBottomHud } from "../src/features/bottomhud/model.ts";
import {
  KILL_FAN,
  clipBarFraction,
  isLowClip,
  killCardsFor,
  odometerCells,
  odometerRows,
} from "../src/features/bottomhud/presentation.ts";
import { createHudSceneFrame } from "../src/mocks/hudScenes.ts";
import { parseHudStatus } from "../src/contracts/index.ts";

const envelope = (type, payload, { serverId = "slgo-1", instanceId = "instance-1", sequence = 2 } = {}) => ({
  protocol_version: 0,
  schema_version: 1,
  event_id: `${type}-${sequence}`,
  server_id: serverId,
  instance_id: instanceId,
  round_id: "round-1",
  sequence,
  type,
  sent_at: "2026-10-07T12:00:00.000Z",
  payload,
});
const baseline = (options) => envelope("sidecar.baseline", { baseline: true }, { ...options, sequence: 1 });
const status = { ammo: { clip: 23, clip_max: 30, reserve: 90, reserve_icon: "bullet" }, round_kills: ["default", "grenade"] };

{
  // Reducer: only the baseline's instance; a reconnect keeps the status, another instance clears it.
  let state = hudStatusReducer(initialHudStatusState, { type: "event", event: envelope("hud.status", status) });
  assert.equal(state.status, null, "no status before the baseline");
  state = hudStatusReducer(state, { type: "event", event: baseline() });
  state = hudStatusReducer(state, { type: "event", event: envelope("hud.status", status) });
  assert.deepEqual(state.status, status);
  assert.equal(hudStatusReducer(state, { type: "event", event: baseline() }), state, "same instance keeps it");
  assert.equal(hudStatusReducer(state, { type: "event", event: envelope("hud.status", status, { instanceId: "other" }) }).status, status, "another instance's frame is ignored");
  assert.equal(hudStatusReducer(state, { type: "event", event: baseline({ instanceId: "instance-2" }) }).status, null, "a new instance clears it");
}

{
  // Selector: the local player of the viewer team, alive and with a loadout; ammo and kills from hud.status.
  const self = { player_id: "76561198000000001", display_name: "Nova", is_online: true, is_alive: true, kills: 2, loadout: { money: 4250 } };
  const hudWith = (player, relation = "viewer") => ({
    hasSnapshot: true,
    teams: [{ relation, role: "ntf", players: [player] }, { relation: "opponent", role: "scp", players: [] }],
  });
  const view = selectBottomHud(hudWith(self), status, self.player_id);
  assert.deepEqual(view, { role: "ntf", balance: 4250, ammo: status.ammo, kills: status.round_kills });
  assert.deepEqual(selectBottomHud(hudWith(self), null, self.player_id), { role: "ntf", balance: 4250, ammo: null, kills: [] }, "before hud.status: balance only");
  assert.equal(selectBottomHud(hudWith({ ...self, is_alive: false }), status, self.player_id), null, "hidden while dead");
  assert.equal(selectBottomHud(hudWith({ ...self, loadout: null }), status, self.player_id), null, "no loadout (offline)");
  assert.equal(selectBottomHud(hudWith(self), status, "76561198000000002"), null, "not on the viewer team");
  assert.equal(selectBottomHud(hudWith(self, "opponent"), status, self.player_id), null, "spectator: no viewer team");
  assert.equal(selectBottomHud({ hasSnapshot: false }, status, self.player_id), null);
  assert.equal(selectBottomHud(hudWith(self), status, null), null);
}

{
  // Low clip at or below 20 % (recording: 6/30 red, 7/30 normal); the bar never overfills.
  const ammo = (clip, clip_max = 30) => ({ clip, clip_max, reserve: 0, reserve_icon: "bullet" });
  assert.equal(isLowClip(ammo(6)), true);
  assert.equal(isLowClip(ammo(7)), false);
  assert.equal(isLowClip(ammo(0)), true);
  assert.equal(clipBarFraction(ammo(15)), 0.5);
  assert.equal(clipBarFraction(ammo(31)), 1, "a chambered round does not overfill the bar");
}

{
  // Kill cards: CS2 fan transforms for 1-5, the ace on the fifth, one counter card from the sixth.
  assert.deepEqual(killCardsFor([]), { mode: "none" });
  const three = killCardsFor(["default", "grenade", "shock"]);
  assert.equal(three.mode, "fan");
  assert.deepEqual(three.cards.map((card) => card.pose), KILL_FAN[3]);
  assert.deepEqual(three.cards.map((card) => card.kind), ["default", "grenade", "shock"]);
  assert.deepEqual(KILL_FAN[5].map((pose) => pose.deg), [-24, -12, 0, 12, 24]);
  const five = killCardsFor(Array(5).fill("default"));
  assert.deepEqual(five.cards.map((card) => card.ace), [false, false, false, false, true]);
  assert.deepEqual(killCardsFor([...Array(5).fill("default"), "shock"]), { mode: "counter", count: 6, kind: "shock" });
}

{
  // Odometer: right-aligned in at least CS2's six cells ("$16000"); blank, then "$", then digits.
  assert.deepEqual(odometerRows(16000), [1, 3, 8, 2, 2, 2]);
  assert.deepEqual(odometerRows(500), [0, 0, 1, 7, 2, 2]);
  assert.deepEqual(odometerRows(0), [0, 0, 0, 0, 1, 2]);
  assert.equal(odometerCells(65535), 6);
  assert.equal(odometerCells(123456), 7, "a longer amount widens the panel");
  assert.equal(odometerRows(123456, odometerCells(123456)).length, 7);
}

{
  // Bottom-HUD mock scenes: valid hud.status at any moment, the right counts at the right times.
  for (const scene of ["bottom-kills", "bottom-fire", "bottom-balance", "bottom-dead", "none"]) {
    for (const role of ["ntf", "scp"]) {
      for (const at of [0, 700, 4_300, 5_600, 7_000, 12_000, 21_000]) {
        assert.equal(parseHudStatus(createHudSceneFrame(scene, role, at).status).ok, true, `${scene} ${role} ${at}`);
      }
    }
  }
  assert.equal(createHudSceneFrame("bottom-kills", "ntf", 21_000).status.round_kills.length, 14);
  assert.equal(createHudSceneFrame("bottom-kills", "scp", 3_500).status.ammo, null, "SCPs hold no firearm");
  assert.equal(createHudSceneFrame("bottom-fire", "ntf", 4_200).status.ammo.clip, 5);
  assert.deepEqual(createHudSceneFrame("bottom-fire", "ntf", 6_000).status.ammo, { clip: 40, clip_max: 40, reserve: 80, reserve_icon: "bullet" }, "reloaded");
  assert.equal(createHudSceneFrame("bottom-balance", "ntf", 9_100).self.money, 0);
  assert.equal(createHudSceneFrame("bottom-dead", "ntf", 0).self.alive, false);
  assert.deepEqual(createHudSceneFrame("none", "ntf", 0).self, { money: null, alive: true });
}

console.log("bottomhud model smoke: ok");
