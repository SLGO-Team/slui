import type { ShopRequest, ShopSnapshot, SlgoEvent } from "../contracts/index.ts";
import { initialShopState, shopReducer, type ShopState } from "../features/shop/model.ts";
import { createPurchaseCommand, createRefundCommand } from "../features/shop/model.ts";
import { mockScp079ShopSnapshot, mockScpShopSnapshot, type MockShopRole } from "./provider.ts";

export const SHOP_DEBUG_AVAILABILITIES = ["live", "stale", "offline", "restarted", "baseline-required", "no-shop"] as const;
export const SHOP_DEBUG_STATES = ["standard", "pending", "rejected", "unavailable", "owned", "disconnected"] as const;
export const SHOP_DEBUG_ROLES = ["scp", "scp079"] as const satisfies readonly MockShopRole[];
/** Teammate requests: none, the payer's view (requests listed), the requester's own view, a full 10v10 column. */
export const SHOP_DEBUG_REQUESTS = ["none", "payer", "requester", "crowded"] as const;
/** Refunds: a plugin without refunds, refundable purchases, and an armour refund refused with the plugin's text. */
export const SHOP_DEBUG_REFUNDS = ["none", "some", "rejected"] as const;
export type ShopDebugAvailability = typeof SHOP_DEBUG_AVAILABILITIES[number];
export type ShopDebugState = typeof SHOP_DEBUG_STATES[number];
export type ShopDebugRole = typeof SHOP_DEBUG_ROLES[number];
export type ShopDebugRequests = typeof SHOP_DEBUG_REQUESTS[number];
export type ShopDebugRefunds = typeof SHOP_DEBUG_REFUNDS[number];
export type ShopDebugOptions = { availability: ShopDebugAvailability; state: ShopDebugState; role: ShopDebugRole; requests: ShopDebugRequests; refunds: ShopDebugRefunds; open: boolean };
export const DEFAULT_SHOP_DEBUG_OPTIONS: ShopDebugOptions = { availability: "live", state: "standard", role: "scp", requests: "none", refunds: "none", open: false };

function valid<T extends string>(values: readonly T[], value: string | null, fallback: T): T {
  return value && values.includes(value as T) ? value as T : fallback;
}

export function readShopDebugOptions(search = window.location.search): ShopDebugOptions {
  const params = new URLSearchParams(search);
  return {
    availability: valid(SHOP_DEBUG_AVAILABILITIES, params.get("shopAvailability"), DEFAULT_SHOP_DEBUG_OPTIONS.availability),
    state: valid(SHOP_DEBUG_STATES, params.get("shopState"), DEFAULT_SHOP_DEBUG_OPTIONS.state),
    // Keep accepting the original short `079` URL value while writing the
    // canonical role id used by the provider and fixture snapshots.
    role: valid(SHOP_DEBUG_ROLES, params.get("shopRole") === "079" ? "scp079" : params.get("shopRole"), DEFAULT_SHOP_DEBUG_OPTIONS.role),
    requests: valid(SHOP_DEBUG_REQUESTS, params.get("shopRequests"), DEFAULT_SHOP_DEBUG_OPTIONS.requests),
    refunds: valid(SHOP_DEBUG_REFUNDS, params.get("shopRefunds"), DEFAULT_SHOP_DEBUG_OPTIONS.refunds),
    // Shop visibility is React state that a reload resets. Mirroring it into the
    // URL is what makes a given shop state reproducible from a link when
    // comparing against the live baseline screenshot.
    open: params.get("shopOpen") === "1",
  };
}

export function replaceShopDebugUrl(options: ShopDebugOptions): void {
  const url = new URL(window.location.href);
  url.searchParams.set("shopAvailability", options.availability);
  url.searchParams.set("shopState", options.state);
  // Keep the short value used by existing preview links; the internal option
  // remains the provider's `scp079` role id.
  url.searchParams.set("shopRole", options.role === "scp079" ? "079" : options.role);
  url.searchParams.set("shopRequests", options.requests);
  url.searchParams.set("shopRefunds", options.refunds);
  url.searchParams.set("shopOpen", options.open ? "1" : "0");
  window.history.replaceState(window.history.state, "", url);
}

function event<T>(type: string, sequence: number, payload: T, instanceId = "shop-debug-instance-1"): SlgoEvent {
  return { protocol_version: 0, schema_version: 1, event_id: `shop-debug-${type}-${sequence}`, server_id: "slgo-shop-debug", instance_id: instanceId, sequence, type, sent_at: new Date().toISOString(), payload } as SlgoEvent;
}

function snapshotForRole(role: ShopDebugRole): ShopSnapshot {
  if (role === "scp079") return mockScp079ShopSnapshot;
  return mockScpShopSnapshot;
}

// The plugin's default scope (roles_only): only SCP role items can be requested.
const ROLE_CATEGORIES = new Set(["scp-low", "scp-mid"]);

function debugRequest(requestId: string, requester: [string, string], itemId: string, snapshot: ShopSnapshot, price?: number): ShopRequest {
  const item = mockScpShopSnapshot.items.find((candidate) => candidate.item_id === itemId);
  const cost = price ?? item?.price ?? 0;
  const purchasable = snapshot.balance >= cost;
  return {
    request_id: requestId, requester_player_id: requester[0], requester_name: requester[1], item_id: itemId, name: item?.name ?? itemId,
    ...(item?.description ? { description: item.description } : {}), icon_url: null, category_id: item?.category_id ?? null, price: cost,
    purchasable, unavailable_reason: purchasable ? null : "资金不足",
  };
}

/** Teammate-request fixtures on the SCP snapshot (mock team-b roster ids). */
function withDebugRequests(snapshot: ShopSnapshot, requests: ShopDebugRequests): ShopSnapshot {
  if (requests === "none") return snapshot;
  const items = snapshot.items.map((item) => ({
    ...item,
    requestable: ROLE_CATEGORIES.has(item.category_id ?? ""),
    requested: requests === "requester" && item.item_id === "Scp939",
  }));
  const rook: [string, string] = ["76561198000000006", "Rook"];
  const striker: [string, string] = ["76561198000000007", "Striker"];
  const specter: [string, string] = ["76561198000000008", "Specter_the_extremely_long_nickname"];
  const list = requests === "payer"
    ? [debugRequest("41", rook, "Scp173", snapshot), debugRequest("42", striker, "Scp096", snapshot), debugRequest("43", specter, "Scp049", snapshot)]
    : requests === "crowded"
      ? ["Scp173", "Scp939", "Scp106", "Scp079", "Scp096", "Scp939", "Scp173", "Scp106", "Scp049"].map((itemId, index) =>
        debugRequest(String(50 + index), [`7656119800000010${index}`, `Teammate${index + 1}`], itemId, snapshot))
      : [];
  return { ...snapshot, items, requests: list };
}

// This round's own purchases: an owned rifle / current role (refundable but not purchasable), a grenade that is
// still purchasable, armour, an upgrade. Ids missing from the viewer's catalog are skipped.
const REFUNDABLE_OWNED: Readonly<Record<string, string>> = { GunE11SR: "你已经拥有 E-11 SR", Scp173: "你已经是 SCP-173 了", HealthUpgrade1: "你已经拥有 生命强化 I" };
const REFUNDABLE_PURCHASABLE = new Set(["GrenadeFlash", "ArmorHeavy"]);
/** The item the `rejected` scene tried to refund: armour, or the upgrade on the SCP side. */
const REFUND_REJECTED_ITEMS = ["ArmorHeavy", "HealthUpgrade1"];

function withDebugRefunds(snapshot: ShopSnapshot, refunds: ShopDebugRefunds): ShopSnapshot {
  // `none` is a plugin without refunds (no field), so the default scenes keep their earlier captures.
  if (refunds === "none") return snapshot;
  const items = snapshot.items.map((item) => {
    const ownedReason = REFUNDABLE_OWNED[item.item_id];
    if (ownedReason) return { ...item, owned_quantity: 1, purchasable: false, unavailable_reason: ownedReason, refundable: true };
    return REFUNDABLE_PURCHASABLE.has(item.item_id) ? { ...item, owned_quantity: Math.max(1, item.owned_quantity ?? 0), refundable: true } : item;
  });
  return { ...snapshot, items, has_refundable: items.some((item) => item.refundable === true) };
}

export function createShopDebugSnapshot(options: ShopDebugOptions, sourceSnapshot?: ShopSnapshot): ShopSnapshot {
  const snapshot = withDebugRefunds(withDebugRequests(structuredClone(sourceSnapshot ?? snapshotForRole(options.role)), options.requests), options.refunds);
  if (options.state === "unavailable") snapshot.items = snapshot.items.map((item) => ({ ...item, purchasable: false, unavailable_reason: "Purchase not allowed" }));
  if (options.state === "owned") snapshot.items = snapshot.items.map((item) => ({ ...item, owned_quantity: Math.max(1, item.owned_quantity ?? 0) }));
  if (options.state === "disconnected") snapshot.window_open = true;
  return snapshot;
}

export function createShopDebugState(options: ShopDebugOptions, nowMs = Date.now(), sourceSnapshot?: ShopSnapshot): ShopState {
  if (options.availability === "baseline-required") return shopReducer(initialShopState, { type: "connection", status: "baseline-required" });
  const instance = "shop-debug-instance-1";
  let state = shopReducer(initialShopState, { type: "connection", status: "live" });
  state = shopReducer(state, { type: "event", event: event("sidecar.baseline", 1, { baseline: true }, instance), receivedAtMs: nowMs });
  const snapshot = createShopDebugSnapshot(options, sourceSnapshot);
  if (options.availability !== "no-shop") state = shopReducer(state, { type: "event", event: event("shop.snapshot", 2, snapshot, instance), receivedAtMs: nowMs });
  if (options.availability === "restarted") {
    state = shopReducer(state, { type: "event", event: event("sidecar.baseline", 3, { baseline: true }, "shop-debug-instance-2"), receivedAtMs: nowMs });
  }
  if (options.state === "pending" || options.state === "rejected") {
    const targetItem = snapshot.items.find((item) => item.purchasable);
    if (!targetItem) return state;
    const command = createPurchaseCommand(targetItem.item_id);
    state = shopReducer(state, { type: "command", command, sentAtMs: nowMs });
    if (options.state === "rejected") state = shopReducer(state, { type: "command-result", result: { command_id: command.command_id, command_kind: command.kind, status: "rejected", reason: "Plugin rejected purchase" } });
  }
  if (options.refunds === "rejected") {
    const target = snapshot.items.find((item) => item.refundable === true && REFUND_REJECTED_ITEMS.includes(item.item_id));
    if (target) {
      const command = createRefundCommand(target.item_id);
      state = shopReducer(state, { type: "command", command, sentAtMs: nowMs });
      state = shopReducer(state, { type: "command-result", result: { command_id: command.command_id, command_kind: command.kind, status: "rejected", reason: "退款后背包将超出容量" } });
    }
  }
  if (options.availability === "stale") state = shopReducer(state, { type: "connection", status: "stale" });
  if (options.availability === "offline" || options.state === "disconnected") state = shopReducer(state, { type: "connection", status: "offline" });
  return state;
}
