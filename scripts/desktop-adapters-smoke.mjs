import assert from "node:assert/strict";
import {
  createGameProcessSource, createOverlayStateSource, createSessionStatusPublisher, createSessionStatusSubscriber,
  DISABLED_OVERLAY, parseOverlayState, parseSessionStatus,
} from "../src/platform/desktop.ts";
import { SERVER_STATUS, serverStatus } from "../src/app/home/status.ts";

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
  const valid = { status: "live", steamId: "76561198000000001", detail: null };
  assert.deepEqual(parseSessionStatus(valid), valid);
  const waiting = { status: "not-in-game", steamId: "76561198000000001", detail: "Not playing on an SLGO server" };
  assert.deepEqual(parseSessionStatus(waiting), waiting, "the home window receives the waiting state");
  assert.deepEqual(serverStatus(waiting), SERVER_STATUS["not-in-game"]);
  assert.equal(serverStatus(waiting).tone, "pending", "waiting for a server is blue, not an error");
  assert.equal(serverStatus(waiting).retry, false);
  assert.equal(serverStatus(waiting).hint, "等待进入游戏服务器");
  for (const bad of [null, { ...valid, status: "online" }, { ...valid, steamId: "123" }, { ...valid, steamId: 7 }, { ...valid, detail: 1 }]) {
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

console.log("desktop adapters smoke: overlay state, game process and session status bridge ok");
