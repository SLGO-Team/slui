import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export * from "./src/mocks/provider.ts"; export * from "./src/mocks/minimapFixtures.ts";'
    + ' export { resolveMinimapSync } from "./src/features/minimap/resolver.ts";', resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { createMockProvider, createMinimapFrame, createMockMinimapInit, resolveMinimapSync, mockMinimapInit, readMinimapPreviewOptions, defaultMinimapPreviewOptions } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const preset = readMinimapPreviewOptions("?minimapPreset=cs2-reference&minimapZone=Entrance&minimapLife=dead&minimapMotion=0&minimapSpectate=1");
assert.equal(preset.mapScale, 0.25); assert.equal(preset.orientation, "heading-up");
assert.equal(preset.zone, "Entrance"); assert.equal(preset.life, "dead");
assert.equal(preset.motion, false); assert.equal(preset.spectate, 1);
const configured = readMinimapPreviewOptions("?minimapAlwaysCentered=0&minimapOrientation=fixed&minimapMapBlend=false&minimapBlurBackground=0"
  + "&minimapBackgroundAlpha=0.2&minimapHudScale=1.3&minimapMapScale=0.5&minimapAlternateMapScale=0.9"
  + "&minimapSquareWithScoreboard=false&minimapForceSquare=1&minimapDynamicZoom=true&minimapAlternateZoomActive=1");
for (const [key, expected] of Object.entries({ alwaysCentered: false, orientation: "fixed", mapBlend: false, blurBackground: false,
  backgroundAlpha: 0.2, hudScale: 1.3, mapScale: 0.5, alternateMapScale: 0.9,
  squareWithScoreboard: false, forceSquare: true, dynamicZoom: true, alternateZoomActive: true })) assert.equal(configured[key], expected, key);
const invalid = readMinimapPreviewOptions("?minimapMapScale=NaN&minimapBackgroundAlpha=Infinity&minimapHudScale=&minimapAlternateMapScale=4&minimapAlwaysCentered=bad");
assert.equal(invalid.mapScale, 0.7); assert.equal(invalid.backgroundAlpha, 0.63);
assert.equal(invalid.hudScale, 1); assert.equal(invalid.alternateMapScale, 1); assert.equal(invalid.alwaysCentered, true);
assert.equal(defaultMinimapPreviewOptions.mapScale, 0.7, "reference preset does not overwrite application defaults");
assert.equal(readMinimapPreviewOptions("?minimapDynamicTargets=far").dynamicTargets, "far");
assert.equal(readMinimapPreviewOptions("?minimapKeycard=carried").keycard, "carried");
assert.equal(readMinimapPreviewOptions("?minimapKeycard=dropped").keycard, "dropped");
assert.equal(readMinimapPreviewOptions("?minimapKeycard=planted").keycard, "planted");
assert.equal(readMinimapPreviewOptions("?minimapKeycard=lost").keycard, "lost");
assert.equal(readMinimapPreviewOptions("?minimapKeycard=other").keycard, "none");
assert.equal(readMinimapPreviewOptions("").bombsites, true);
assert.equal(readMinimapPreviewOptions("?minimapBombsites=0").bombsites, false);
// Mock bombsites mirror the plugin's default generator rooms: A = SCP-939, B = the warhead (HczNuke), inside their rooms.
{
  for (const seed of [1062329959, 142007]) {
    const init = createMockMinimapInit(seed);
    const geometry = resolveMinimapSync(init);
    assert.deepEqual(init.bombsites.map((site) => site.label), ["A", "B"], `seed ${seed}: A and B`);
    for (const [site, name] of [[init.bombsites[0], "Hcz939"], [init.bombsites[1], "HczWarhead"]]) {
      const room = geometry.roomById.get(site.room_id);
      assert.equal(room.name, name);
      assert.equal(site.zone, room.zone);
      assert.ok(Math.abs(site.x - room.position.x) < 7.5 && Math.abs(site.z - room.position.z) < 7.5, `${name} site lies inside its 15x15 cell`);
    }
  }
  assert.deepEqual(createMockMinimapInit(1062329959, "map-demo-1", false).bombsites, []);
  assert.deepEqual(mockMinimapInit.bombsites, createMockMinimapInit().bombsites);
}
const distantFrame = createMinimapFrame(mockMinimapInit, undefined, undefined, { ...defaultMinimapPreviewOptions, motion: false, dynamicTargets: "far" });
const distantEnemy = distantFrame.positions.find((position) => position.visibility === "spotted-by-teammate" && position.zone === distantFrame.viewpoint.zone);
assert.ok(Math.hypot(distantEnemy.x - distantFrame.viewpoint.x, distantEnemy.z - distantFrame.viewpoint.z) > 55,
  "dynamic visual fixture provides a real in-zone target beyond the ordinary zoom radius");
for (const viewerId of ["76561198000000002", "76561198000000010"]) {
  const positions = createMinimapFrame(mockMinimapInit, viewerId).positions;
  assert.equal(new Set(positions.map((position) => position.player_id)).size, positions.length);
}
const identity = { steamId: "76561198000000001" };
const route = {
  steamId: identity.steamId, identityMode: "device-signature", serverId: "slgo-demo",
  instanceId: "instance-demo-1", sidecarEndpoint: "wss://mock.sidecar.invalid/slgo",
  sessionToken: "fixture", expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (const team of ["team-a", "team-b"]) {
  const connection = createMockProvider(team);
  const events = [];
  const diagnostics = [];
  const off = connection.subscribe((event) => events.push(event));
  const offDiagnostic = connection.subscribeDiagnostic((diagnostic) => diagnostics.push(diagnostic));
  const latest = () => events.findLast((event) => event.type === "minimap.positions");
  try {
    await connection.connect(route, identity);
    assert.equal(connection.getStatus(), "live");
    {
      // hud.messages / round.result flow through the parsed stream; the scripted scene replaces the empty resync state.
      const latestOf = (type) => events.findLast((event) => event.type === type);
      assert.deepEqual(latestOf("hud.messages").payload, { progress: null, alert: null, hint_high: null, hint_low: null });
      assert.deepEqual(latestOf("round.result").payload, { panel: null });
      const viewerRole = team === "team-a" ? "ntf" : "scp";
      connection.configureHudScene("win-mvp-kills");
      const panel = latestOf("round.result").payload.panel;
      assert.equal(panel.winner_team, viewerRole);
      assert.equal(panel.title.outcome, "won");
      assert.equal(panel.mvp.reason_text, "最多击杀MVP（3杀）");
      // Debug captures pin a scene moment (hudSceneAt): a new run of the same scene at that time.
      connection.configureHudScene("win-mvp-kills", 2_000);
      const pinned = latestOf("round.result").payload.panel;
      assert.equal(pinned.visible_remaining_ms, 5_000);
      assert.notEqual(pinned.result_id, panel.result_id);
      connection.configureHudScene("timeout");
      assert.equal(latestOf("round.result").payload.panel, null, "a message scene clears the panel");
      assert.equal(latestOf("hud.messages").payload.alert.countdown_remaining_ms > 57_000, true);
      connection.configureHudScene("none");
      assert.equal(latestOf("hud.messages").payload.alert, null);
    }
    assert.equal(latest().payload.viewer.player_id, identity.steamId);
    assert.equal(latest().payload.viewer.team_id, team);
    assert.equal(latest().payload.positions.filter((p) => p.visibility === "self").length, 1);
    const first = latest();
    await wait(240);
    assert.ok(events.filter((event) => event.type === "minimap.positions").length >= 3);
    assert.notEqual(latest().payload.viewpoint.x, first.payload.viewpoint.x);
    const beforePreferences = latest();
    const beforePreferencesInit = connection.getMinimapInit();
    connection.configureMinimap({ mapScale: 0.25, orientation: "heading-up", hudScale: 1.3, dynamicZoom: true, alternateZoomActive: true });
    assert.strictEqual(latest(), beforePreferences, "presentation settings must not publish an extra authority frame");
    assert.strictEqual(connection.getMinimapInit(), beforePreferencesInit, "presentation settings never regenerate geometry");
    connection.configureMinimap({ life: "dead", motion: false });
    const dead = latest();
    assert.equal(dead.payload.viewer.is_alive, false);
    assert.equal(dead.payload.positions.some((p) => p.visibility === "self" || p.visibility === "spotted-by-self"), false);
    assert.equal(dead.payload.positions.filter((p) => p.visibility === "spotted-by-teammate").length, 2);
    connection.configureMinimap({ spectate: 1 });
    assert.notEqual(latest().payload.viewpoint.player_id, dead.payload.viewpoint.player_id);
    assert.equal(latest().payload.visibility_revision, dead.payload.visibility_revision);
    assert.deepEqual(latest().payload.positions.map((p) => p.player_id), dead.payload.positions.map((p) => p.player_id));
    connection.configureMinimap({ life: "no-viewpoint" });
    assert.equal(latest().payload.viewpoint, null);
    assert.equal(latest().payload.positions.length, 4);
    const beforeCs2 = latest();
    connection.configureMinimap({ lastKnown: true, deaths: true });
    const cs2 = latest();
    assert.ok(cs2.payload.visibility_revision > beforeCs2.payload.visibility_revision, "status changes need a new revision");
    assert.equal(cs2.payload.positions.filter((p) => p.status === "last-known" && p.visibility.startsWith("spotted-")).length, 1);
    assert.equal(cs2.payload.positions.filter((p) => p.status === "dead" && p.visibility === "teammate").length, 1);
    assert.ok(cs2.payload.positions.every((p) => p.status !== "live" || p.status_age_ms === 0));
    connection.configureMinimap({ lastKnown: false, deaths: false });
    const beforeKeycard = latest();
    connection.configureMinimap({ keycard: "carried" });
    const carried = latest();
    assert.ok(carried.payload.visibility_revision > beforeKeycard.payload.visibility_revision, "a keycard holder change needs a new revision");
    const holders = carried.payload.positions.filter((p) => p.has_commander_keycard);
    assert.equal(holders.length, 1, "the NTF side sees its holder, the SCP side its spotted NTF holder");
    assert.ok(holders.every((p) => p.role === "ntf" && p.status === "live"));
    assert.equal(carried.payload.commander_keycard, null);
    connection.configureMinimap({ keycard: "dropped" });
    const dropped = latest().payload;
    assert.ok(dropped.commander_keycard?.status === "live" && dropped.positions.every((p) => !p.has_commander_keycard), "a dropped card has no holder");
    connection.configureMinimap({ keycard: "planted" });
    assert.equal(latest().payload.commander_keycard?.state, "planted");
    connection.configureMinimap({ keycard: "lost" });
    const lost = latest().payload.commander_keycard;
    assert.ok(lost?.status === "last-known" && lost.status_age_ms < 8000, "a card no longer seen fades over 8 s");
    connection.configureMinimap({ keycard: "none" });
    const initsBefore = events.filter((event) => event.type === "minimap.init").length;
    assert.equal(events.findLast((event) => event.type === "minimap.init").payload.bombsites.length, 2, "the streamed init carries A and B");
    connection.configureMinimap({ bombsites: false });
    const noSites = events.findLast((event) => event.type === "minimap.init");
    assert.equal(events.filter((event) => event.type === "minimap.init").length, initsBefore + 1, "changing bombsites sends a new init");
    assert.deepEqual(noSites.payload.bombsites, []);
    assert.equal(latest().payload.map_id, noSites.payload.map_id, "a complete frame follows the new init");
    connection.configureMinimap({ bombsites: true });
    assert.equal(connection.getMinimapInit().bombsites.length, 2);
    connection.configureMinimap({ enemies: false });
    assert.equal(latest().payload.positions.length, 2);
    const oldInit = connection.getMinimapInit();
    connection.rebuildMinimap();
    assert.notEqual(connection.getMinimapInit().map_id, oldInit.map_id);
    assert.notEqual(connection.getMinimapInit().seed, oldInit.seed);
    assert.notDeepEqual(connection.getMinimapInit().bombsites, oldInit.bombsites, "a rebuilt map recomputes its bombsites");
    connection.configureMinimap({ paused: true });
    const beforePause = latest();
    const hudCount = events.filter((event) => event.type === "match.snapshot").length;
    await wait(1100);
    assert.equal(latest(), beforePause);
    assert.ok(events.filter((event) => event.type === "match.snapshot").length > hudCount);
    connection.invalidateMinimap("invalid");
    assert.equal(diagnostics.at(-1).kind, "invalid-payload");
    assert.equal(connection.getStatus(), "live");
    assert.equal("payload" in diagnostics.at(-1), false);
    await connection.disconnect();
    const disconnectedCount = events.length;
    await wait(160);
    assert.equal(events.length, disconnectedCount);
    await connection.connect(route, identity);
    assert.equal(connection.getStatus(), "live");
    assert.equal(latest().payload.map_id, connection.getMinimapInit().map_id);
    assert.ok(events.every((event) => event.type !== "minimap.positions" || event.payload.positions.every((p) => p.room_id && p.y === -100)));
  } finally {
    off(); offDiagnostic(); await connection.disconnect();
  }
}
{
  // The mock answers chat like the plugin, so the preview shows success and rejection.
  const connection = createMockProvider("team-a");
  const results = [];
  const off = connection.subscribe((event) => { if (event.type === "command.result") results.push(event.payload); });
  try {
    await connection.connect(route, identity);
    const chat = (id, body = "hi") => connection.send({ kind: "command.chat.send", command_id: id, scope: "team", body });
    await chat("mock-chat-1");
    await chat("mock-chat-2");
    await chat("mock-chat-3", "x".repeat(121));
    await wait(200);
    assert.deepEqual(results.map((result) => [result.command_id, result.status]),
      [["mock-chat-1", "accepted"], ["mock-chat-2", "rejected"], ["mock-chat-3", "rejected"]]);
    assert.equal(results[1].reason, "发送过于频繁，请稍候。");
    assert.equal(results[2].reason, "消息最多允许 120 个字符。");
    await chat("mock-chat-4");
    await connection.disconnect();
    await wait(200);
    assert.equal(results.length, 3, "no result arrives after the stream ends");
  } finally {
    off(); await connection.disconnect();
  }
}
console.log("Minimap realtime provider smoke passed (11 URL controls/preset, keycard holder/drop, bombsites, configuration stream isolation, two teams, full frames, death, spectating, removal, pause, rebuild, reconnect).");
