import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import {
  SHOP_COMMAND_TIMEOUT_MS,
  SHOP_STALE_AFTER_MS,
  createFulfillCommand,
  createPurchaseCommand,
  createRefundAllCommand,
  createRefundCommand,
  createRequestCommand,
  initialShopState,
  isShopItemPurchaseBlocked,
  selectShop,
  shopReducer,
  hasTimedShopCommand,
  sameShopTime,
} from "../src/features/shop/model.ts";
import { SHOP_PIP_FALLBACK_COLOR, SHOP_PREVIEW_IMAGES, allocateShopColumnWidths, groupShopItems, groupShopRequests, shopOwnerPipColors, shopWashForRole } from "../src/features/shop/presentation.ts";
import {
  DEFAULT_SHOP_DEBUG_OPTIONS,
  createShopDebugState,
  readShopDebugOptions,
} from "../src/mocks/shopDebug.ts";
import { mockScp079ShopSnapshot, mockScpShopSnapshot, mockShopSnapshotFor } from "../src/mocks/provider.ts";
import { shopKeyInputs } from "../src/features/shop/diagnostics.ts";

const baseline = { protocol_version: 0, schema_version: 1, event_id: "b", server_id: "s", instance_id: "i", sequence: 1, type: "sidecar.baseline", payload: { baseline: true } };
const snapshot = {
  protocol_version: 0, schema_version: 1, event_id: "shop", server_id: "s", instance_id: "i", sequence: 2, type: "shop.snapshot", sent_at: new Date(1_000).toISOString(),
  payload: { balance: 100, window_open: true, items: [{ item_id: "armor", name: "Armor", price: 50, quantity: 1, purchasable: true }] },
};
let state = shopReducer(initialShopState, { type: "connection", status: "live" });
state = shopReducer(state, { type: "event", event: baseline, receivedAtMs: 1_000 });
state = shopReducer(state, { type: "event", event: snapshot, receivedAtMs: 1_000 });
const command = createPurchaseCommand("armor");
state = shopReducer(state, { type: "command", command, sentAtMs: 1_000 });
state = shopReducer(state, { type: "command", command, sentAtMs: 1_001 });
assert.equal(Object.keys(state.pending).length, 1, "same command id must create one pending record");
{
  // An in-flight purchase blocks a repeat without making the item look unavailable.
  const [inFlight] = selectShop(state, 1_000).items;
  assert.equal(inFlight.commandState, "pending");
  assert.equal(inFlight.disabled, true, "in-flight command blocks a repeat purchase");
  assert.equal(inFlight.unavailable, false, "in-flight command is not drawn as unavailable");
  assert.equal(hasTimedShopCommand(state), true, "the clock ticks the reducer while a command can time out");
  assert.equal(sameShopTime(selectShop(state, 1_000), selectShop(state, 4_000)), true, "still live: App keeps the view");
  assert.equal(sameShopTime(selectShop(state, 1_000), selectShop(state, 1_000 + SHOP_STALE_AFTER_MS + 1)), false, "stale");
}
state = shopReducer(state, { type: "tick", nowMs: 1_000 + SHOP_COMMAND_TIMEOUT_MS + 1 });
assert.equal(state.pending[command.command_id]?.state, "timedOut", "timeout keeps pending for late result");
assert.equal(hasTimedShopCommand(state), false, "a timed-out command no longer needs the clock");
state = shopReducer(state, { type: "command-result", result: { command_id: command.command_id, command_kind: command.kind, status: "duplicate" } });
assert.equal(state.pending[command.command_id], undefined, "late result retires pending record");
assert.equal(state.commands[command.command_id]?.state, "success", "duplicate is accepted");
assert.equal(selectShop(state, 1_000).items[0].commandState, "success");
state = shopReducer(state, { type: "connection", status: "offline" });
assert.equal(selectShop(state, 1_000).hasSnapshot, true, "offline keeps last authority");
{
  // The server shut down: the ended instance takes the shop with it.
  const ended = shopReducer(state, { type: "connection", status: "ended" });
  assert.equal(selectShop(ended, 1_000).hasSnapshot, false, "an ended instance drops the shop");
  assert.equal(selectShop(ended, 1_000).availability, "disconnected");
  assert.equal(ended.serverId, null);
  for (const status of ["not-in-game", "game-not-running"]) {
    const over = shopReducer(state, { type: "connection", status });
    assert.equal(selectShop(over, 1_000).hasSnapshot, false, `${status} ends the match`);
    assert.equal(selectShop(over, 1_000).availability, "disconnected");
  }
}

// Owning an item is display-only: a held but still purchasable item (second flashbang) is buyable
// from both the click and the number-key path; only the plugin's purchasable flag blocks it.
{
  const ownedSnapshot = {
    ...snapshot,
    event_id: "shop-owned",
    sequence: 3,
    payload: {
      balance: 1_000,
      window_open: true,
      items: [
        { item_id: "GrenadeFlash", name: "闪光弹", price: 200, quantity: 1, owned_quantity: 1, category_id: "grenades", purchasable: true, unavailable_reason: null },
        { item_id: "Scp173", name: "SCP-173", price: 1_950, quantity: 0, owned_quantity: 1, category_id: "scp-mid", purchasable: false, unavailable_reason: "你已经是 SCP-173 了" },
      ],
    },
  };
  let ownedState = shopReducer(initialShopState, { type: "connection", status: "live" });
  ownedState = shopReducer(ownedState, { type: "event", event: baseline, receivedAtMs: 1_000 });
  ownedState = shopReducer(ownedState, { type: "event", event: ownedSnapshot, receivedAtMs: 1_000 });
  const [flash, role] = selectShop(ownedState, 1_000).items;
  assert.equal(isShopItemPurchaseBlocked(flash), false, "a held but purchasable item stays buyable");
  assert.equal(isShopItemPurchaseBlocked(role), true, "a non-purchasable item is blocked");
}

assert.deepEqual(allocateShopColumnWidths(5), [171, 171, 209, 228, 171], "default five-column widths preserve the NTF/CS2 layout");
assert.deepEqual(allocateShopColumnWidths(5, "ntf"), [171, 171, 209, 228, 171], "NTF five-column widths remain unchanged");
assert.deepEqual(allocateShopColumnWidths(5, "scp"), [171, 209, 228, 171, 171], "SCP widths swap the danger and high-risk slots");
assert.equal(shopWashForRole("scp"), "#d94652", "SCP shop wash must use the HUD faction red");
assert.equal(shopWashForRole("ntf"), "rgb(150, 200, 250)", "NTF shop wash must remain the existing blue");
const grouped = groupShopItems([
  { item_id: "unknown", name: "Unknown", price: 1, quantity: null, category_id: "missing", purchasable: true },
], [{ id: "equipment", label: "装备", order: 1 }, { id: "grenades", label: "投掷物", order: 2 }]);
assert.equal(grouped[1].items[0].item_id, "unknown", "unmatched plugin category falls back to final column");
assert.equal(selectShop(createShopDebugState({ ...DEFAULT_SHOP_DEBUG_OPTIONS, availability: "restarted" }, 1_000), 1_000).availability, "restarted");
assert.equal(selectShop(createShopDebugState({ ...DEFAULT_SHOP_DEBUG_OPTIONS, availability: "baseline-required" }, 1_000), 1_000).availability, "baseline-required");

const parsed079 = readShopDebugOptions("?shopRole=079&shopOpen=1&shopAvailability=live&shopState=standard");
assert.equal(parsed079.role, "scp079", "legacy 079 role URL should normalize to scp079");
assert.equal(parsed079.open, true, "shop debug URL should restore visibility");
const parsedStandard = readShopDebugOptions("?shopRole=scp");
assert.equal(parsedStandard.role, "scp", "standard SCP role should be selectable from URL");
const debug079 = selectShop(createShopDebugState({ ...DEFAULT_SHOP_DEBUG_OPTIONS, role: "scp079" }, 1_000), 1_000);
assert.equal(debug079.hasSnapshot, true, "079 debug scenario should build a reducer snapshot");
assert.deepEqual(debug079.categories?.map((category) => category.id), ["scp-equipment", "scp-low", "scp-mid", "scp-power"], "079 debug scenario should expose server-defined equipment and power categories");
assert.equal(debug079.items.some((item) => item.category_id === "scp-health" || item.category_id === "scp-shield"), false, "079 debug scenario should omit health and shield categories");
const debugScp = selectShop(createShopDebugState(DEFAULT_SHOP_DEBUG_OPTIONS, 1_000), 1_000);
assert.equal(debugScp.items.some((item) => item.item_id === "Scp049"), true, "standard SCP debug scenario should use the SCP fixture");
assert.deepEqual(
  mockScpShopSnapshot.categories?.map((category) => category.label),
  ["装备", "危险", "高危", "生命", "护盾"],
  "standard SCP categories should use the product labels without the upgrade suffix",
);
assert.equal(mockScpShopSnapshot.categories?.some((category) => category.id === "scp-high"), false, "the empty high category should be removed after moving SCP-096");

const scpItems = new Map(mockScpShopSnapshot.items.map((item) => [item.item_id, item]));
assert.deepEqual(
  ["Scp049", "Scp0492", "Scp3114"].map((id) => scpItems.get(id)?.category_id),
  ["scp-low", "scp-low", "scp-low"],
  "low SCP roles must come from the low category",
);
assert.deepEqual(
  ["Scp173", "Scp939", "Scp106", "Scp079"].map((id) => scpItems.get(id)?.category_id),
  ["scp-mid", "scp-mid", "scp-mid", "scp-mid"],
  "mid SCP roles must come from the mid category",
);
assert.equal(scpItems.get("Scp096")?.category_id, "scp-mid", "SCP-096 must be in the high-risk tier");
assert.equal(scpItems.get("Scp079")?.price, 2700, "SCP-079 role price must match plugin constants");
assert.equal(scpItems.get("HealthUpgrade3")?.price, 1000, "health upgrade price must match plugin");
assert.equal(scpItems.get("ShieldUpgrade3")?.price, 1600, "shield upgrade price must match plugin");
assert.equal(scpItems.get("GeneratorInteractionUpgrade")?.category_id, "scp-equipment", "generator destruction upgrade must use the equipment category");
assert.equal(scpItems.get("GeneratorInteractionUpgrade")?.icon_url, "/assets/icons/wire-cutters.svg", "generator destruction upgrade must use the CS2 defuse kit icon");
assert.deepEqual(
  mockScp079ShopSnapshot.categories?.map((category) => category.label),
  ["装备", "危险", "高危", "电力升级"],
  "SCP-079 receives server-defined equipment and power categories",
);
assert.equal(mockScp079ShopSnapshot.items.some((item) => item.category_id === "scp-health"), false, "079 snapshot must omit health upgrades");
assert.equal(mockScp079ShopSnapshot.items.some((item) => item.category_id === "scp-shield"), false, "079 snapshot must omit shield upgrades");
assert.equal(mockScp079ShopSnapshot.items.filter((item) => item.category_id === "scp-power").length, 3, "079 power category contains levels II-IV");
assert.equal(mockShopSnapshotFor("team-a").categories?.[0]?.id, "equipment", "NTF provider remains the default for team A");
assert.equal(mockShopSnapshotFor("team-b").categories?.[0]?.id, "scp-equipment", "team B provider selects SCP snapshot");
assert.equal(mockShopSnapshotFor("team-b", "scp079").categories?.at(-1)?.id, "scp-power", "079 provider selects power snapshot");
// Player clock skew: sent_at is on the server clock, so a local clock a minute ahead or
// behind must neither mark the shop stale nor refuse purchases (2026-10-03 汐纳 report).
for (const skewMs of [60_000, -60_000]) {
  const receivedAtMs = 100_000;
  const skewed = { ...snapshot, sequence: 2, sent_at: new Date(receivedAtMs - skewMs).toISOString() };
  let skewState = shopReducer(initialShopState, { type: "connection", status: "live" });
  skewState = shopReducer(skewState, { type: "event", event: baseline, receivedAtMs });
  skewState = shopReducer(skewState, { type: "event", event: skewed, receivedAtMs });
  const fresh = selectShop(skewState, receivedAtMs + 1_000);
  assert.equal(fresh.availability, "live", `skew ${skewMs} ms keeps a fresh snapshot live`);
  assert.equal(fresh.items[0].disabled, false, `skew ${skewMs} ms keeps the item buyable`);
  assert.equal(selectShop(skewState, receivedAtMs + SHOP_STALE_AFTER_MS + 1).availability, "stale", "age still counts from local receipt");
}
// Teammate requests: R / right-click toggles a request, a request-area click fulfils one.
{
  const requestEvent = (sequence, payload) => ({ ...snapshot, event_id: `shop-req-${sequence}`, sequence, payload });
  const request = (id, purchasable = true, category = "roles") => ({ request_id: id, requester_player_id: "7656119800000000" + id, requester_name: `P${id}`, item_id: "Scp173", name: "SCP-173", category_id: category, price: 1950, purchasable, unavailable_reason: purchasable ? null : "资金不足" });
  let live = shopReducer(initialShopState, { type: "connection", status: "live" });
  live = shopReducer(live, { type: "event", event: baseline, receivedAtMs: 1_000 });
  live = shopReducer(live, { type: "event", event: requestEvent(2, { balance: 2000, window_open: true, items: [
    { item_id: "Scp173", name: "SCP-173", price: 1950, quantity: 1, purchasable: true, requestable: true, requested: false },
    { item_id: "HealthUpgrade1", name: "生命强化 I", price: 250, quantity: 1, purchasable: true, requestable: false },
  ], requests: [request("1"), request("2", false)] }), receivedAtMs: 1_000 });
  const view = selectShop(live, 1_000);
  assert.equal(view.canRequest, true, "a requestable item opens requesting");
  assert.equal(view.requests.length, 2);
  assert.equal(view.requests[0].disabled, false);
  assert.equal(view.requests[1].unavailable, true, "an unaffordable request is drawn unavailable");

  // A request goes out for any card once requesting is open; the plugin refuses out-of-scope items itself.
  const toggle = createRequestCommand("HealthUpgrade1");
  let next = shopReducer(live, { type: "command", command: toggle, sentAtMs: 1_000 });
  assert.equal(next.pending[toggle.command_id]?.target, "request:HealthUpgrade1");
  assert.equal(selectShop(next, 1_000).items[1].requestPending, true);
  assert.equal(selectShop(next, 1_000).items[1].disabled, false, "a pending request never blocks buying the item");
  const again = createRequestCommand("HealthUpgrade1");
  assert.equal(shopReducer(next, { type: "command", command: again, sentAtMs: 1_001 }).pending[again.command_id], undefined, "one toggle per item in flight");
  next = shopReducer(next, { type: "command-result", result: { command_id: toggle.command_id, command_kind: toggle.kind, status: "rejected", reason: "生命强化 I 不支持请求队友购买" } });
  assert.equal(selectShop(next, 1_000).failureReason, "生命强化 I 不支持请求队友购买", "a refused request fills the failure banner");
  assert.equal(shopReducer(live, { type: "command", command: createRequestCommand("Missing"), sentAtMs: 1_000 }).pending, live.pending, "unknown items are not requested");

  // Fulfilment: only a request the viewer can pay; in flight it blocks a repeat.
  const fulfil = createFulfillCommand("1");
  next = shopReducer(live, { type: "command", command: fulfil, sentAtMs: 1_000 });
  assert.equal(selectShop(next, 1_000).requests[0].commandState, "pending");
  assert.equal(selectShop(next, 1_000).requests[0].disabled, true);
  assert.equal(selectShop(next, 1_000).requests[0].unavailable, false, "in flight is not unavailable");
  next = shopReducer(next, { type: "command-result", result: { command_id: fulfil.command_id, command_kind: fulfil.kind, status: "rejected", reason: "该请求正在被其他队友处理" } });
  assert.equal(selectShop(next, 1_000).failureReason, "该请求正在被其他队友处理");
  assert.equal(selectShop(next, 1_000).requests[0].disabled, false, "a refused fulfilment can be retried");
  const unaffordable = createFulfillCommand("2");
  assert.equal(shopReducer(live, { type: "command", command: unaffordable, sentAtMs: 1_000 }).pending[unaffordable.command_id], undefined, "an unaffordable request is not sent");
  assert.equal(shopReducer(live, { type: "command", command: createFulfillCommand("9"), sentAtMs: 1_000 }).pending, live.pending, "a vanished request is not sent");

  // Without requestable items (NTF, mode off, older plugin) nothing is requested and no area is drawn.
  let closed = shopReducer(initialShopState, { type: "connection", status: "live" });
  closed = shopReducer(closed, { type: "event", event: baseline, receivedAtMs: 1_000 });
  closed = shopReducer(closed, { type: "event", event: snapshot, receivedAtMs: 1_000 });
  assert.equal(selectShop(closed, 1_000).canRequest, false);
  assert.deepEqual(selectShop(closed, 1_000).requests, []);
  const refused = createRequestCommand("armor");
  assert.equal(shopReducer(closed, { type: "command", command: refused, sentAtMs: 1_000 }).pending[refused.command_id], undefined);

  // Listers follow the item columns; an unknown column means the last one.
  const listers = groupShopRequests([request("1", true, "scp-mid"), request("2", true, "elsewhere"), request("3", true, null)], [{ id: "scp-low", width: 209 }, { id: "scp-mid", width: 228 }, { id: "scp-health", width: 171 }]);
  assert.deepEqual(listers.map((lister) => lister.requests.map((entry) => entry.request_id)), [[], ["1"], ["2", "3"]]);
  assert.deepEqual(listers.map((lister) => lister.width), [209, 228, 171]);

  // Debug scenes reachable by URL.
  assert.equal(readShopDebugOptions("?shopRequests=payer").requests, "payer");
  assert.equal(readShopDebugOptions("?shopRequests=bogus").requests, "none");
  const payer = selectShop(createShopDebugState({ ...DEFAULT_SHOP_DEBUG_OPTIONS, requests: "payer" }, 1_000), 1_000);
  assert.equal(payer.requests.length, 3);
  assert.equal(payer.requests.some((entry) => entry.unavailable), true, "the payer scene has an unaffordable request");
  const requester = selectShop(createShopDebugState({ ...DEFAULT_SHOP_DEBUG_OPTIONS, requests: "requester" }, 1_000), 1_000);
  assert.equal(requester.items.find((item) => item.item_id === "Scp939")?.requested, true);
  assert.equal(requester.canRequest, true);
}

// Refunds: the plugin marks what is refundable; the undo button and Backspace send `refund`, Delete `refund_all`.
{
  const refundEvent = (sequence, payload) => ({ ...snapshot, event_id: `shop-refund-${sequence}`, sequence, payload });
  let live = shopReducer(initialShopState, { type: "connection", status: "live" });
  live = shopReducer(live, { type: "event", event: baseline, receivedAtMs: 1_000 });
  live = shopReducer(live, { type: "event", event: refundEvent(2, { balance: 100, window_open: true, has_refundable: true, items: [
    { item_id: "GunE11SR", name: "E-11 SR", price: 3100, quantity: null, purchasable: false, unavailable_reason: "你已经拥有 E-11 SR", refundable: true },
    { item_id: "GrenadeFlash", name: "闪光弹", price: 200, quantity: 1, purchasable: true },
  ] }), receivedAtMs: 1_000 });
  let view = selectShop(live, 1_000);
  assert.equal(view.refundsSupported, true);
  assert.equal(view.canRefundAll, true);
  assert.equal(view.items[0].refundable, true);
  assert.equal(view.items[0].unavailable, true, "an owned refundable card stays unpurchasable");

  const refund = createRefundCommand("GunE11SR");
  let next = shopReducer(live, { type: "command", command: refund, sentAtMs: 1_000 });
  assert.equal(next.pending[refund.command_id]?.target, "refund:GunE11SR");
  assert.equal(selectShop(next, 1_000).items[0].refundPending, true);
  assert.equal(selectShop(next, 1_000).items[0].commandState, "idle", "a refund never marks the purchase state");
  const repeat = createRefundCommand("GunE11SR");
  assert.equal(shopReducer(next, { type: "command", command: repeat, sentAtMs: 1_000 }).pending[repeat.command_id], undefined, "a refund in flight blocks a repeat");
  next = shopReducer(next, { type: "command-result", result: { command_id: refund.command_id, command_kind: refund.kind, status: "rejected" } });
  assert.equal(selectShop(next, 1_000).failureReason, null, "a silent refusal leaves the banner empty");
  assert.equal(selectShop(next, 1_000).items[0].refundPending, false);
  const overflow = createRefundCommand("GunE11SR");
  next = shopReducer(next, { type: "command", command: overflow, sentAtMs: 1_000 });
  next = shopReducer(next, { type: "command-result", result: { command_id: overflow.command_id, command_kind: overflow.kind, status: "rejected", reason: "退款后背包将超出容量" } });
  assert.equal(selectShop(next, 1_000).failureReason, "退款后背包将超出容量", "a refusal with a reason fills the banner");
  const notRefundable = createRefundCommand("GrenadeFlash");
  assert.equal(shopReducer(live, { type: "command", command: notRefundable, sentAtMs: 1_000 }).pending[notRefundable.command_id], undefined, "a card that is not refundable sends nothing");

  const all = createRefundAllCommand();
  next = shopReducer(live, { type: "command", command: all, sentAtMs: 1_000 });
  assert.equal(next.pending[all.command_id]?.target, "refund-all");
  assert.equal(selectShop(next, 1_000).canRefundAll, false, "refund all in flight waits for its result");

  // Nothing refundable: the button stays (CS2 always shows it) but sends nothing.
  const empty = shopReducer(live, { type: "event", event: refundEvent(3, { balance: 100, window_open: true, has_refundable: false, items: [{ item_id: "GrenadeFlash", name: "闪光弹", price: 200, quantity: 1, purchasable: true }] }), receivedAtMs: 1_000 });
  view = selectShop(empty, 1_000);
  assert.equal(view.refundsSupported, true);
  assert.equal(view.canRefundAll, false);
  const idle = createRefundAllCommand();
  assert.equal(shopReducer(empty, { type: "command", command: idle, sentAtMs: 1_000 }).pending[idle.command_id], undefined);

  // A closed window or a stale shop refunds nothing either.
  const shut = shopReducer(live, { type: "event", event: refundEvent(4, { balance: 100, window_open: false, has_refundable: true, items: [{ item_id: "GunE11SR", name: "E-11 SR", price: 3100, quantity: null, purchasable: false, refundable: true }] }), receivedAtMs: 1_000 });
  assert.equal(selectShop(shut, 1_000).canRefundAll, false);
  assert.equal(selectShop(live, 1_000 + SHOP_STALE_AFTER_MS + 1).canRefundAll, false);

  // An older plugin (no field): no refund UI at all.
  let legacy = shopReducer(initialShopState, { type: "connection", status: "live" });
  legacy = shopReducer(legacy, { type: "event", event: baseline, receivedAtMs: 1_000 });
  legacy = shopReducer(legacy, { type: "event", event: snapshot, receivedAtMs: 1_000 });
  assert.equal(selectShop(legacy, 1_000).refundsSupported, false);
  assert.equal(selectShop(legacy, 1_000).canRefundAll, false);

  // Debug scenes.
  assert.equal(readShopDebugOptions("?shopRefunds=some").refunds, "some");
  assert.equal(readShopDebugOptions("?shopRefunds=bogus").refunds, "none");
  const none = selectShop(createShopDebugState(DEFAULT_SHOP_DEBUG_OPTIONS, 1_000), 1_000);
  assert.equal(none.refundsSupported, false, "the default scene is a plugin without refunds");
  const some = selectShop(createShopDebugState({ ...DEFAULT_SHOP_DEBUG_OPTIONS, refunds: "some" }, 1_000), 1_000);
  assert.deepEqual(some.items.filter((item) => item.refundable).map((item) => item.item_id), ["Scp173", "HealthUpgrade1"]);
  assert.equal(some.canRefundAll, true);
  const ntf = selectShop(createShopDebugState({ ...DEFAULT_SHOP_DEBUG_OPTIONS, refunds: "some" }, 1_000, mockShopSnapshotFor("team-a", "scp")), 1_000);
  assert.deepEqual(ntf.items.filter((item) => item.refundable).map((item) => item.item_id).sort(), ["ArmorHeavy", "GrenadeFlash", "GunE11SR"]);
  const rejected = selectShop(createShopDebugState({ ...DEFAULT_SHOP_DEBUG_OPTIONS, refunds: "rejected" }, 1_000), 1_000);
  assert.equal(rejected.failureReason, "退款后背包将超出容量");
}
// Preview images resolve to bundled files, and the bundled folder holds no image the shop never shows
// (they ship inside slui.exe; a renamed or re-encoded file must update SHOP_PREVIEW_IMAGES with it).
{
  const previews = Object.values(SHOP_PREVIEW_IMAGES);
  for (const href of previews) assert.ok(existsSync(new URL(`../public${href}`, import.meta.url)), `${href} is bundled`);
  const bundled = readdirSync(new URL("../public/assets/shop-items/", import.meta.url)).filter((name) => !name.endsWith(".md"))
    .map((name) => `/assets/shop-items/${name}`).sort();
  assert.deepEqual(bundled, [...new Set(previews)].sort(), "every bundled shop image is a preview image");
}

console.log("shop model smoke: ok");

// Teammate-inventory pips: one per holder in team slot order, coloured by the HUD slot colour.
{
  const colors = { a: "#c03699", b: "#88cef5", c: "#f8f62d" };
  assert.deepEqual(shopOwnerPipColors({ owner_player_ids: ["c", "a"] }, colors, "b"), ["#c03699", "#f8f62d"], "pips follow team slot order");
  assert.deepEqual(shopOwnerPipColors({ owner_player_ids: ["a", "a"] }, colors, "b"), ["#c03699"], "a holder draws one pip");
  assert.deepEqual(shopOwnerPipColors({ owner_player_ids: ["x"] }, colors, "b"), [SHOP_PIP_FALLBACK_COLOR], "an unknown holder draws white");
  assert.deepEqual(shopOwnerPipColors({ owner_player_ids: [], owned_quantity: 2 }, colors, "b"), [], "owner ids win over owned_quantity");
  assert.deepEqual(shopOwnerPipColors({ owned_quantity: 1 }, colors, "b"), ["#88cef5"], "an older plugin only reports the viewer");
  assert.deepEqual(shopOwnerPipColors({ owned_quantity: 0 }, colors, "b"), [], "nothing held, no pip");
  assert.deepEqual(shopOwnerPipColors({ owned_quantity: 1 }, colors, null), [SHOP_PIP_FALLBACK_COLOR], "unknown viewer draws white");
  const owned = mockScpShopSnapshot.items.find((item) => item.item_id === "Scp173");
  assert.deepEqual(owned?.owner_player_ids, ["76561198000000006"], "mock owners come from the mock loadouts");
}

// Diagnostics: the shop key's inputs name the session, snapshot, window, availability and the snapshot's age.
{
  const frame = { receivedAtMs: 10_000 };
  assert.equal(shopKeyInputs("live", { hasSnapshot: true, windowOpen: false, availability: "live", frame }, 12_340),
    "session live, snapshot true, window open false, availability live, snapshot age 2.3s");
  assert.equal(shopKeyInputs("connecting", { hasSnapshot: false, windowOpen: false, availability: "baseline-required", frame: null }, 0),
    "session connecting, snapshot false, window open false, availability baseline-required, snapshot age none");
  assert.match(shopKeyInputs("live", { hasSnapshot: true, windowOpen: true, availability: "live", frame }, 9_000), /snapshot age 0\.0s$/, "a clock step back never shows a negative age");
}
