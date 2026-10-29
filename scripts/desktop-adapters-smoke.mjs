import assert from "node:assert/strict";
import {
  createGameProcessSource, createOverlayStateSource, createSessionStatusPublisher, createSessionStatusSubscriber,
  DISABLED_OVERLAY, parseOverlayState, parseSessionStatus,
} from "../src/platform/desktop.ts";
import { overlaySwitchNote, SERVER_STATUS, serverStatus } from "../src/app/home/status.ts";
import { steamAccount, steamTone } from "../src/app/home/steamAccount.ts";
import { createSteamProfileSource, EMPTY_STEAM_PROFILE, parseSteamProfile } from "../src/platform/steamProfile.ts";
import { createPageErrorLog, describeComponentStack, describePageError, MAX_PAGE_ERROR_LENGTH } from "../src/platform/pageErrors.ts";

// In-process bus that records emits and delivers to listeners, like two windows sharing app events.
function createFakeBus() {
  const listeners = new Map();
  const emitted = [];
  return {
    emitted,
    emit(event, payload, target) {
      emitted.push({ event, payload, target });
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    listen(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event).delete(listener);
    },
    count: (event) => listeners.get(event)?.size ?? 0,
  };
}

// Overlay state parsing rejects partial or mistyped payloads.
assert.deepEqual(parseOverlayState({ enabled: true, interactive: false }), { enabled: true, interactive: false });
for (const bad of [null, 1, {}, { enabled: "yes", interactive: false }, { enabled: true }]) assert.equal(parseOverlayState(bad), null);

// Tauri path: commands are the only writer; events update subscribers.
{
  const bus = createFakeBus();
  const calls = [];
  let state = { enabled: false, interactive: false };
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "set_overlay_enabled") {
      state = { enabled: args.enabled, interactive: false };
      bus.emit("slgo-overlay-state", state);
      return state;
    }
    if (command === "get_overlay_state") return state;
    throw new Error(command);
  };
  const source = createOverlayStateSource(bus, invoke);
  const seen = [];
  const unsubscribe = source.subscribe((next) => seen.push(next));
  assert.deepEqual(await source.get(), DISABLED_OVERLAY);
  assert.deepEqual(await source.setEnabled(true), { enabled: true, interactive: false });
  bus.emit("slgo-overlay-state", { enabled: "garbage" });
  assert.deepEqual(seen, [{ enabled: true, interactive: false }], "invalid events ignored");
  unsubscribe();
  assert.equal(bus.count("slgo-overlay-state"), 0, "unsubscribe removes listener");
  assert.deepEqual(calls.map(([command]) => command), ["get_overlay_state", "set_overlay_enabled"]);
}

// Browser preview path: state lives in the tab and is broadcast.
{
  const bus = createFakeBus();
  const source = createOverlayStateSource(bus, null);
  assert.deepEqual(await source.get(), DISABLED_OVERLAY);
  await source.setEnabled(true);
  assert.deepEqual(bus.emitted.at(-1), { event: "slgo-overlay-state", payload: { enabled: true, interactive: false }, target: undefined });
  assert.deepEqual(await source.get(), { enabled: true, interactive: false });
}

// Game process: only booleans pass; browser reports not running.
{
  const bus = createFakeBus();
  const source = createGameProcessSource(bus, async () => true);
  assert.equal(await source.get(), true);
  assert.equal(await createGameProcessSource(bus, null).get(), false);
  const seen = [];
  source.subscribe((running) => seen.push(running));
  bus.emit("slgo-game-running", false);
  bus.emit("slgo-game-running", "true");
  assert.deepEqual(seen, [false]);
}

// Session status bridge: validation, request/response and retry routing.
{
  const valid = { status: "live", steamId: "76561198000000001", detail: null, endReason: null };
  assert.deepEqual(parseSessionStatus(valid), valid);
  const waiting = { status: "not-in-game", steamId: "76561198000000001", detail: "Not playing on an SLGO server", endReason: null };
  assert.deepEqual(parseSessionStatus(waiting), waiting, "the home window receives the waiting state");
  assert.deepEqual(serverStatus(waiting), SERVER_STATUS["not-in-game"]);
  assert.equal(serverStatus(waiting).tone, "pending", "waiting for a server is blue, not an error");
  assert.equal(serverStatus(waiting).retry, false);
  assert.equal(serverStatus(waiting).hint, "等待进入游戏服务器");
  // A closed game: muted, says the session connects by itself once the game starts, no retry button.
  const closed = { ...valid, status: "game-not-running", detail: null };
  assert.deepEqual(parseSessionStatus(closed), closed, "the home window receives the closed-game state");
  assert.deepEqual(serverStatus(closed), { label: "未连接", tone: "muted", retry: false, hint: "启动游戏后自动连接" });
  // The switch note: off says auto-enable turns it on; on says the overlay waits for a live session.
  assert.equal(overlaySwitchNote(false, true, closed), "进入服务器后自动启用");
  assert.equal(overlaySwitchNote(false, false, closed), null, "a manual-only switch promises nothing");
  assert.equal(overlaySwitchNote(true, true, closed), "连接服务器后显示");
  assert.equal(overlaySwitchNote(true, true, null), "连接服务器后显示", "unknown is not live");
  assert.equal(overlaySwitchNote(true, false, { ...closed, status: "live" }), null);
  // An ended instance shows its reason; without one it reads as a restart.
  const ended = { ...valid, status: "ended", detail: "Server instance ended", endReason: "server-shutdown" };
  assert.deepEqual(parseSessionStatus(ended), ended);
  assert.equal(serverStatus(ended).label, "服务器已关闭");
  assert.equal(serverStatus(ended).retry, false, "the session reroutes by itself");
  assert.equal(serverStatus({ ...ended, endReason: "server-restart" }).label, "正在重启");
  assert.equal(serverStatus({ ...ended, endReason: "round-restart" }).label, "正在重启");
  assert.equal(serverStatus({ ...ended, endReason: null }).label, "正在重启");
  assert.equal(serverStatus({ ...ended, endReason: "plugin-disabled" }).label, "SLGO 已停用");
  assert.equal(serverStatus({ ...ended, endReason: "lost" }).label, "服务器失联");
  assert.equal(serverStatus({ ...ended, endReason: "server-stopped" }).label, "服务器已停止");
  for (const bad of [null, { ...valid, endReason: "a-future-reason" }, { ...valid, endReason: undefined }, { ...valid, status: "online" }, { ...valid, steamId: "123" }, { ...valid, steamId: 7 }, { ...valid, detail: 1 }]) {
    assert.equal(parseSessionStatus(bad), null);
  }
  const bus = createFakeBus();
  const publisher = createSessionStatusPublisher(bus);
  const subscriber = createSessionStatusSubscriber(bus);
  let retries = 0;
  publisher.onRequest(() => publisher.publish(valid));
  publisher.onRetry(() => { retries += 1; });
  const seen = [];
  subscriber.subscribe((snapshot) => seen.push(snapshot));
  subscriber.requestSnapshot();
  bus.emit("slgo-session-status", { status: "bogus", steamId: null, detail: null });
  subscriber.retry();
  assert.deepEqual(seen, [valid], "request answered once, invalid snapshot dropped");
  assert.equal(retries, 1);
  const targets = Object.fromEntries(bus.emitted.filter(({ target }) => target).map(({ event, target }) => [event, target]));
  assert.equal(targets["slgo-session-status"], "home");
  assert.equal(targets["slgo-session-status-request"], "overlay");
  assert.equal(targets["slgo-session-retry"], "overlay");
}

// Steam profile: Rust reads it from the local Steam client; every part may be missing.
{
  const AVATAR = "data:image/png;base64,iVBORw0KGgo=";
  const nova = { personaName: "Nova", avatarUrl: AVATAR };
  assert.deepEqual(parseSteamProfile(nova), nova);
  assert.deepEqual(parseSteamProfile(EMPTY_STEAM_PROFILE), EMPTY_STEAM_PROFILE);
  for (const bad of [null, "Nova", {}, { personaName: 7, avatarUrl: null }, { personaName: null },
    { personaName: null, avatarUrl: "https://avatars.steamstatic.com/a.jpg" },
    { personaName: null, avatarUrl: "data:image/svg+xml;base64,PHN2Zz4=" },
    { personaName: null, avatarUrl: "data:image/png;base64,\"onerror=\"" }]) {
    assert.equal(parseSteamProfile(bad), null, JSON.stringify(bad));
  }

  const calls = [];
  const source = createSteamProfileSource(async (command, args) => {
    calls.push([command, args]);
    return args.steamId === "76561198000000001" ? nova : { personaName: 1 };
  });
  assert.deepEqual(await source.get("76561198000000001"), nova);
  assert.deepEqual(calls, [["get_steam_profile", { steamId: "76561198000000001" }]], "the SteamID goes to Rust as steamId");
  await assert.rejects(source.get("76561198000000002"), /Invalid Steam profile/, "a malformed answer is an error, not an empty profile");
  assert.deepEqual(await createSteamProfileSource(null).get("76561198000000001"), EMPTY_STEAM_PROFILE, "browsers have no Steam client");

  const session = { status: "live", steamId: "76561198000000001", detail: null, endReason: null };
  assert.deepEqual(steamAccount(null, null), { kind: "loading" });
  assert.deepEqual(steamAccount({ ...session, steamId: null }, { steamId: "76561198000000001", profile: nova }), { kind: "signed-out" });
  assert.deepEqual(steamAccount(session, null), { kind: "signed-in", steamId: session.steamId, profile: null }, "reading");
  assert.deepEqual(steamAccount(session, { steamId: session.steamId, profile: nova }),
    { kind: "signed-in", steamId: session.steamId, profile: nova });
  assert.deepEqual(steamAccount(session, { steamId: "76561198000000002", profile: nova }),
    { kind: "signed-in", steamId: session.steamId, profile: null }, "another account's profile is never shown");
  assert.equal(steamTone(steamAccount(session, null)), "ok");
  assert.equal(steamTone(steamAccount({ ...session, steamId: null }, null)), "muted");
  assert.equal(steamTone(steamAccount(null, null)), "muted");
}

// Page errors: one line per error with the first frames, capped in length and in count.
{
  const error = new TypeError("boom");
  error.stack = ["TypeError: boom", "    at a (x.js:1:1)", "    at b (x.js:2:2)", "    at c", "    at d", "    at e", "    at f"].join("\n");
  assert.equal(describePageError(error), "TypeError: boom | at a (x.js:1:1) | at b (x.js:2:2) | at c | at d", "four frames on one line");
  assert.equal(describePageError("plain\nreason"), "plain reason", "a non-Error value is its text on one line");
  assert.equal(describePageError(new Error("x".repeat(2_000))).length, MAX_PAGE_ERROR_LENGTH, "long messages are cut");
  assert.equal(describeComponentStack("\n    at ShopPanel\n    at App\n"), " | components: at ShopPanel < at App");
  assert.equal(describeComponentStack(undefined), "");
  const lines = [];
  const log = createPageErrorLog((message) => lines.push(message), 2);
  for (let index = 0; index < 5; index += 1) log(`error ${index}`);
  assert.deepEqual(lines, ["error 0", "error 1", "page errors: more than 2, later ones not logged"], "a repeating error stops after the limit");
}

console.log("desktop adapters smoke: overlay state, game process, session status bridge and Steam profile ok");
