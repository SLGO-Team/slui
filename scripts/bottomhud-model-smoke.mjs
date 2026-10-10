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
import { createKillParticles, KILL_PARTICLE_SECONDS } from "../src/features/bottomhud/particles/render.ts";
import { MASK_SECONDS } from "../src/features/bottomhud/particles/systems.ts";
import { LINE_Y, srgbToLinear } from "../src/features/bottomhud/particles/engine.ts";
import { particleTexture } from "../src/features/bottomhud/particles/textures.ts";
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

{
  // Kill particles, drawn into a recording stand-in for the WebGL panel renderer.
  const draws = [];
  const recorder = {
    quad: (texture, corners, paint, blend = "add") => draws.push({ texture, corners, paint, blend }),
    sprite: (texture, x, y, radius, rotation, paint, blend = "add") => draws.push({ texture, x, y, radius, paint, blend }),
  };
  /** The draws of the frame `t` seconds after kill `count`, stepped at 60 Hz from the kill as the component does. */
  const frameAt = (count, t, seed = 7) => {
    const paint = createKillParticles(count, seed);
    for (let frame = 0; frame <= Math.round(t * 60); frame += 1) {
      draws.length = 0;
      paint(recorder, frame / 60);
    }
    return draws.map((draw) => ({ ...draw }));
  };
  const count = (draws, texture) => draws.filter((draw) => draw.texture === texture).length;

  // killid: 3 initial particles and the instantaneous one at 0 s, the continuous emitter's single one at 0.125 s.
  assert.equal(count(frameAt(1, 0.05), "beam"), 4, "four beams at the kill");
  assert.equal(count(frameAt(1, 0.2), "beam"), 5, "a fifth at 0.125 s");
  assert.equal(count(frameAt(1, 0.4), "beam"), 5, "none at the end of the 0.25 s emission");
  assert.equal(count(frameAt(1, 0.4), "raysTrail"), 5, "every beam particle draws its ray layer");

  // Occluders: opaque black, alpha-blended, gone at 2.0 s; kill 5's starbursts outlive them.
  const ace = frameAt(5, 0.6);
  const masks = ace.filter((draw) => draw.blend === "alpha" && draw.texture !== "crack");
  assert.ok(masks.length > 0 && masks.every((draw) => draw.paint.color.every((channel) => channel === 0) && draw.paint.alpha === 1));
  assert.equal(count(ace, "white"), 1, "the motion band");
  const [motion] = ace.filter((draw) => draw.texture === "white");
  assert.ok(motion.corners[0][1] > LINE_Y && motion.corners[0][1] < LINE_Y + 2, "the motion rope sits 4 units nearer the camera: its top just under the line");
  // Renderers decode colour attributes from sRGB (m_bGammaCorrectVertexColors, on by default).
  assert.deepEqual(srgbToLinear([1, 0, 1]), [1, 0, 1]);
  assert.ok(Math.abs(srgbToLinear([155 / 255, 0, 0])[0] - 0.328) < 0.002, "pale blue's red decodes to a third");
  assert.ok(count(frameAt(4, 0.6), "disc") > count(frameAt(3, 0.6), "disc"), "kills 4 and 5 add the cards mask");
  const late = frameAt(5, MASK_SECONDS + 0.1);
  assert.equal(late.filter((draw) => draw.blend === "alpha" && draw.texture !== "crack").length, 0, "the masks are gone");
  assert.ok(count(late, "rays") > 0, "the radiate starbursts are still alive");
  // The cards mask is a trail, never wider than long: 47.25 units across at most, not radius 30 x 2.
  const [cards] = ace.filter((draw) => draw.texture === "disc" && draw.corners);
  assert.ok(Math.abs(cards.corners[1][0] - cards.corners[0][0]) <= 2 * 47.25 * 2.006 + 1e-6, "cards mask width");

  // Deterministic per seed, empty once the effect is over.
  assert.deepEqual(frameAt(3, 0.5, 11), frameAt(3, 0.5, 11), "the same kill draws the same particles");
  assert.equal(frameAt(5, KILL_PARTICLE_SECONDS + 0.1).length, 0, "nothing after the effect");
}

{
  // Particle textures: RGBA, linear; warm basic_flare / yellowflare, white elsewhere.
  const texel = (name, u, v) => {
    const { width, height, data } = particleTexture(name);
    const offset = (Math.floor(((v + 1) / 2) * (height - 1)) * width + Math.floor(((u + 1) / 2) * (width - 1))) * 4;
    return [...data.slice(offset, offset + 4)];
  };
  for (const name of ["glow05", "glow04", "flare", "rays", "raysTrail", "raysRing", "raysFaintRing", "lens", "streakFlare", "beam", "crack", "smoke", "disc", "white"]) {
    const { width, height, data } = particleTexture(name);
    assert.equal(data.length, width * height * 4, name);
    assert.ok(data.every((value) => Number.isFinite(value) && value >= 0), `${name} is finite and non-negative`);
  }
  const [red, green, blue] = texel("rays", 0.1, 0);
  assert.ok(red > green && green > blue, "basic_flare's falloff is orange");
  const glow = texel("glow05", 0.1, 0);
  assert.ok(glow[0] === glow[1] && glow[1] === glow[2], "particle_glow_05 is white");
  assert.ok(texel("raysRing", 0, 0)[0] < texel("rays", 0, 0)[0] * 0.3, "the ring layer dims the flare's core");
}

console.log("bottomhud model smoke: ok");
