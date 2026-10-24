// A sidecar restart while the plugin instance keeps running: the plugin reconnects with the same instance_id and the
// new sidecar counts sequences from 0 again. The real connection (fake WebSocket) feeds the HUD, shop and minimap
// reducers as App does; each must sync on the new connection's baseline, and old or repeated frames stay dropped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const result = await build({
  stdin: { contents: `export { WebSocketSidecarConnection } from "./platform/connection.ts";
    export { HUD_EVENT_TYPES, initialRoundHudState, roundHudReducer, selectRoundHud } from "./features/hud/model.ts";
    export { SHOP_EVENT_TYPES, initialShopState, shopReducer, selectShop } from "./features/shop/model.ts";
    export { initialMinimapState, minimapReducer } from "./features/minimap/model.ts";`, resolveDir: resolve("src") },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
});
const { WebSocketSidecarConnection, HUD_EVENT_TYPES, initialRoundHudState, roundHudReducer, selectRoundHud,
  SHOP_EVENT_TYPES, initialShopState, shopReducer, selectShop, initialMinimapState, minimapReducer,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
  }
  send() {}
  close() { this.readyState = 3; }
  // Sidecar side.
  accept() { this.readyState = 1; this.onopen?.({}); }
  deliver(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  drop(code) { this.readyState = 3; this.onerror?.({}); this.onclose?.({ code, reason: "" }); }
}

const fixture = (name) => JSON.parse(readFileSync(resolve("packages/protocol/v0", `${name}.example.json`), "utf8"));
const match = fixture("match-snapshot");
const shopSnapshot = fixture("shop-snapshot");
const init = fixture("minimap-init");
const steamId = "76561198000000100";
const route = {
  protocolVersion: 0, identityMode: "local-steamid", steamId, serverId: match.server_id, instanceId: match.instance_id,
  sidecarEndpoint: "wss://localhost:7801/slgo/sidecar", sessionToken: "v0.token.signature",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
let events = 0;
const frame = (template, sequence, payload = {}) => ({ ...template, event_id: `evt-${++events}`,
  sequence, sent_at: new Date().toISOString(), payload: { ...template.payload, ...payload } });
const baseline = (sequence) => ({ ...frame(match, sequence), type: "sidecar.baseline", payload: { baseline: true } });

let socket = null;
const connection = new WebSocketSidecarConnection({ createSocket: (url) => (socket = new FakeWebSocket(url)) });
const receivedAtMs = 1_000;
let hud = initialRoundHudState, shop = initialShopState, minimap = initialMinimapState;
connection.subscribeStatus((status) => {
  hud = roundHudReducer(hud, { type: "connection", status });
  shop = shopReducer(shop, { type: "connection", status });
  minimap = minimapReducer(minimap, { type: "connection", status });
});
connection.subscribe((event) => {
  if (HUD_EVENT_TYPES.has(event.type)) hud = roundHudReducer(hud, { type: "event", event, receivedAtMs });
  if (SHOP_EVENT_TYPES.has(event.type)) shop = shopReducer(shop, { type: "event", event, receivedAtMs });
  minimap = minimapReducer(minimap, { type: "event", event, receivedAtMs });
});
async function connect() {
  const connecting = connection.connect(route, { steamId });
  const opened = socket;
  opened.accept();
  opened.deliver(baseline(1));
  await connecting;
  return opened;
}

// The first sidecar has handed out sequences up to 502 by the time it restarts.
const first = await connect();
first.deliver(frame(match, 500, { round: 9 }));
first.deliver(frame(shopSnapshot, 501, { balance: 1_000 }));
first.deliver(frame(init, 502));
assert.equal(selectRoundHud(hud, receivedAtMs).round, 9);
assert.equal(minimap.sequence, 502);
first.drop(1006);
assert.equal(connection.getStatus(), "offline");

// The restarted sidecar: same server_id and instance_id, sequences from 1 again.
const second = await connect();
second.deliver(frame(match, 2, { round: 10 }));
second.deliver(frame(shopSnapshot, 3, { balance: 2_500 }));
second.deliver(frame(init, 4));
const view = selectRoundHud(hud, receivedAtMs);
assert.equal(view.availability, "live", "the HUD syncs on the restarted sidecar's baseline");
assert.equal(view.round, 10, "the HUD takes the new sidecar's snapshot");
assert.equal(hud.sequence, 2);
assert.equal(selectShop(shop, receivedAtMs).availability, "live");
assert.equal(selectShop(shop, receivedAtMs).balance, 2_500, "the shop takes the new sidecar's snapshot");
assert.equal(minimap.sequence, 4, "the minimap takes the new sidecar's init");
assert.notEqual(minimap.init, null);

// Order and replay protection stay: a repeated sequence on the new connection, a late frame from the dead socket.
second.deliver(frame(match, 2, { round: 11 }));
first.deliver(frame(match, 503, { round: 12 }));
second.deliver(frame(shopSnapshot, 1, { balance: 0 }));
assert.equal(connection.getStatus(), "live", "an old frame does not disturb the live connection");
assert.equal(selectRoundHud(hud, receivedAtMs).round, 10);
assert.equal(selectShop(shop, receivedAtMs).balance, 2_500);
// The reducers drop old sequences on their own too.
assert.strictEqual(roundHudReducer(hud, { type: "event", event: frame(match, 2, { round: 11 }), receivedAtMs }), hud);
assert.strictEqual(shopReducer(shop, { type: "event", event: frame(shopSnapshot, 3, { balance: 0 }), receivedAtMs }), shop);
assert.strictEqual(minimapReducer(minimap, { type: "event", event: frame(init, 4), receivedAtMs }), minimap);

await connection.disconnect();
console.log("sidecar restart smoke passed");
