import type { ShopSnapshot, SlgoEvent } from "../contracts/index.ts";
import { initialShopState, shopReducer, type ShopState } from "../features/shop/model.ts";
import { createPurchaseCommand } from "../features/shop/model.ts";
import { mockScp079ShopSnapshot, mockScpShopSnapshot, type MockShopRole } from "./provider.ts";

export const SHOP_DEBUG_AVAILABILITIES = ["live", "stale", "offline", "restarted", "baseline-required", "no-shop"] as const;
export const SHOP_DEBUG_STATES = ["standard", "pending", "rejected", "unavailable", "owned", "disconnected"] as const;
export const SHOP_DEBUG_ROLES = ["scp", "scp079"] as const satisfies readonly MockShopRole[];
export type ShopDebugAvailability = typeof SHOP_DEBUG_AVAILABILITIES[number];
export type ShopDebugState = typeof SHOP_DEBUG_STATES[number];
export type ShopDebugRole = typeof SHOP_DEBUG_ROLES[number];
export type ShopDebugOptions = { availability: ShopDebugAvailability; state: ShopDebugState; role: ShopDebugRole; open: boolean };
export const DEFAULT_SHOP_DEBUG_OPTIONS: ShopDebugOptions = { availability: "live", state: "standard", role: "scp", open: false };

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

export function createShopDebugSnapshot(options: ShopDebugOptions, sourceSnapshot?: ShopSnapshot): ShopSnapshot {
  const snapshot = structuredClone(sourceSnapshot ?? snapshotForRole(options.role));
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
    state = shopReducer(state, { type: "purchase", command, sentAtMs: nowMs });
    if (options.state === "rejected") state = shopReducer(state, { type: "command-result", result: { command_id: command.command_id, command_kind: command.kind, status: "rejected", reason: "Plugin rejected purchase" } });
  }
  if (options.availability === "stale") state = shopReducer(state, { type: "connection", status: "stale" });
  if (options.availability === "offline" || options.state === "disconnected") state = shopReducer(state, { type: "connection", status: "offline" });
  return state;
}
