import assert from "node:assert/strict";
import {
  SHOP_COMMAND_TIMEOUT_MS,
  SHOP_STALE_AFTER_MS,
  createPurchaseCommand,
  initialShopState,
  isShopItemPurchaseBlocked,
  selectShop,
  shopReducer,
} from "../src/features/shop/model.ts";
import { SHOP_PIP_FALLBACK_COLOR, allocateShopColumnWidths, groupShopItems, shopOwnerPipColors, shopWashForRole } from "../src/features/shop/presentation.ts";
import {
  DEFAULT_SHOP_DEBUG_OPTIONS,
  createShopDebugState,
  readShopDebugOptions,
} from "../src/mocks/shopDebug.ts";
import { mockScp079ShopSnapshot, mockScpShopSnapshot, mockShopSnapshotFor } from "../src/mocks/provider.ts";

const baseline = { protocol_version: 0, schema_version: 1, event_id: "b", server_id: "s", instance_id: "i", sequence: 1, type: "sidecar.baseline", payload: { baseline: true } };
const snapshot = {
  protocol_version: 0, schema_version: 1, event_id: "shop", server_id: "s", instance_id: "i", sequence: 2, type: "shop.snapshot", sent_at: new Date(1_000).toISOString(),
  payload: { balance: 100, window_open: true, items: [{ item_id: "armor", name: "Armor", price: 50, quantity: 1, purchasable: true }] },
};
let state = shopReducer(initialShopState, { type: "connection", status: "live" });
state = shopReducer(state, { type: "event", event: baseline, receivedAtMs: 1_000 });
state = shopReducer(state, { type: "event", event: snapshot, receivedAtMs: 1_000 });
const command = createPurchaseCommand("armor");
state = shopReducer(state, { type: "purchase", command, sentAtMs: 1_000 });
state = shopReducer(state, { type: "purchase", command, sentAtMs: 1_001 });
assert.equal(Object.keys(state.pending).length, 1, "same command id must create one pending record");
{
  // An in-flight purchase blocks a repeat without making the item look unavailable.
  const [inFlight] = selectShop(state, 1_000).items;
  assert.equal(inFlight.commandState, "pending");
  assert.equal(inFlight.disabled, true, "in-flight command blocks a repeat purchase");
  assert.equal(inFlight.unavailable, false, "in-flight command is not drawn as unavailable");
}
state = shopReducer(state, { type: "tick", nowMs: 1_000 + SHOP_COMMAND_TIMEOUT_MS + 1 });
assert.equal(state.pending[command.command_id]?.state, "timedOut", "timeout keeps pending for late result");
state = shopReducer(state, { type: "command-result", result: { command_id: command.command_id, command_kind: command.kind, status: "duplicate" } });
assert.equal(state.pending[command.command_id], undefined, "late result retires pending record");
assert.equal(state.commands[command.command_id]?.state, "success", "duplicate is accepted");
assert.equal(selectShop(state, 1_000).items[0].commandState, "success");
state = shopReducer(state, { type: "connection", status: "offline" });
assert.equal(selectShop(state, 1_000).hasSnapshot, true, "offline keeps last authority");

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
