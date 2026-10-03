import {
  createCommandId,
  type CommandResult,
  type ConnectionStatus,
  type ShopItem,
  type ShopSnapshot,
  type ShopPurchaseCommand,
  type SlgoEvent,
} from "../../contracts/index.ts";

export const SHOP_COMMAND_TIMEOUT_MS = 5_000;
export const SHOP_STALE_AFTER_MS = 5_000;

export type ShopCommandState = "idle" | "pending" | "success" | "failed" | "timedOut" | "rejected" | "abandoned";

export type ShopPendingCommand = {
  command: ShopPurchaseCommand;
  itemId: string;
  sentAtMs: number;
  state: Extract<ShopCommandState, "pending" | "timedOut">;
  reason?: string;
};

export type ShopCommandRecord = {
  state: ShopCommandState;
  itemId: string;
  sentAtMs?: number;
  reason?: string;
};

export type ShopSnapshotFrame = {
  serverId: string;
  instanceId: string;
  sequence: number;
  /** Server clock. Informational only: never compare it with the local clock. */
  sentAtMs: number;
  receivedAtMs: number;
  snapshot: ShopSnapshot;
};

export type ShopAvailability = "live" | "stale" | "disconnected" | "restarted" | "baseline-required" | "no-shop";

export type ShopState = {
  connectionStatus: ConnectionStatus;
  serverId: string | null;
  instanceId: string | null;
  sequence: number;
  baselineAccepted: boolean;
  restartPending: boolean;
  lastEventReceivedAtMs: number | null;
  frame: ShopSnapshotFrame | null;
  pending: Readonly<Record<string, ShopPendingCommand>>;
  commands: Readonly<Record<string, ShopCommandRecord>>;
  failureReason: string | null;
};

export const initialShopState: ShopState = {
  connectionStatus: "signed-out",
  serverId: null,
  instanceId: null,
  sequence: -1,
  baselineAccepted: false,
  restartPending: false,
  lastEventReceivedAtMs: null,
  frame: null,
  pending: {},
  commands: {},
  failureReason: null,
};

export type ShopAction =
  | { type: "connection"; status: ConnectionStatus }
  | { type: "event"; event: SlgoEvent; receivedAtMs: number }
  | { type: "purchase"; command: ShopPurchaseCommand; sentAtMs: number }
  | { type: "command-result"; result: CommandResult; receivedAtMs?: number }
  | { type: "tick"; nowMs: number };

function abandonPending(state: ShopState): ShopState {
  const pending = { ...state.pending };
  const commands = { ...state.commands };
  for (const [id, command] of Object.entries(pending)) {
    commands[id] = { state: "abandoned", itemId: command.itemId, sentAtMs: command.sentAtMs, reason: "Connection lost" };
    delete pending[id];
  }
  return { ...state, pending, commands };
}

export function createPurchaseCommand(itemId: string, quantity = 1): ShopPurchaseCommand {
  return { kind: "command.shop.purchase", command_id: createCommandId("purchase"), item_id: itemId, quantity };
}

export function canPurchase(snapshot: ShopSnapshot, itemId: string): boolean {
  const item = snapshot.items.find((candidate) => candidate.item_id === itemId);
  return Boolean(snapshot.window_open && item?.purchasable);
}

function sourceChanged(state: ShopState, serverId: string, instanceId: string): boolean {
  return state.serverId !== null && (state.serverId !== serverId || state.instanceId !== instanceId);
}

export function shopReducer(state: ShopState, action: ShopAction): ShopState {
  if (action.type === "connection") {
    const next = { ...state, connectionStatus: action.status };
    if (action.status === "offline" || action.status === "not-in-game" || action.status === "unauthorized") return abandonPending(next);
    return next;
  }

  if (action.type === "tick") {
    const pending = { ...state.pending };
    const commands = { ...state.commands };
    let changed = false;
    for (const [id, command] of Object.entries(pending)) {
      if (command.state === "pending" && action.nowMs - command.sentAtMs > SHOP_COMMAND_TIMEOUT_MS) {
        pending[id] = { ...command, state: "timedOut" };
        commands[id] = { state: "timedOut", itemId: command.itemId, sentAtMs: command.sentAtMs };
        changed = true;
      }
    }
    return changed ? { ...state, pending, commands } : state;
  }

  if (action.type === "purchase") {
    if (!state.frame || state.connectionStatus !== "live" || !canPurchase(state.frame.snapshot, action.command.item_id)) return state;
    if (state.pending[action.command.command_id]) return state;
    const existing = state.commands[action.command.command_id];
    if (existing && existing.state !== "idle") return state;
    const pending: ShopPendingCommand = { command: action.command, itemId: action.command.item_id, sentAtMs: action.sentAtMs, state: "pending" };
    return {
      ...state,
      pending: { ...state.pending, [action.command.command_id]: pending },
      commands: { ...state.commands, [action.command.command_id]: { state: "pending", itemId: action.command.item_id, sentAtMs: action.sentAtMs } },
      failureReason: null,
    };
  }

  if (action.type === "command-result") {
    const command = state.pending[action.result.command_id];
    if (!command) return state;
    if (action.result.command_kind !== command.command.kind) return state;
    const status: ShopCommandState = action.result.status === "accepted" || action.result.status === "duplicate"
      ? "success"
      : action.result.status === "rejected" ? "rejected" : "failed";
    const pending = { ...state.pending };
    // A timeout keeps the record pending until the authoritative late result arrives;
    // once it does, the in-flight entry can be retired.
    delete pending[action.result.command_id];
    const commands = {
      ...state.commands,
      [action.result.command_id]: {
        state: status,
        itemId: command.itemId,
        sentAtMs: command.sentAtMs,
        ...(action.result.reason ? { reason: action.result.reason } : {}),
      },
    };
    return { ...state, pending, commands, failureReason: status === "rejected" || status === "failed" ? action.result.reason ?? null : null };
  }

  const { event, receivedAtMs } = action;
  if (event.type === "command.result") {
    return shopReducer(state, { type: "command-result", result: event.payload, receivedAtMs });
  }
  if (event.type === "sidecar.baseline") {
    const sameSource = event.server_id === state.serverId && event.instance_id === state.instanceId;
    if (sameSource && event.sequence <= state.sequence) return state;
    const changedSource = sourceChanged(state, event.server_id, event.instance_id);
    const next = {
      ...state,
      serverId: event.server_id,
      instanceId: event.instance_id,
      sequence: event.sequence,
      baselineAccepted: true,
      restartPending: state.restartPending || changedSource,
      lastEventReceivedAtMs: receivedAtMs,
      frame: null,
    };
    return changedSource ? abandonPending(next) : next;
  }
  if (event.type !== "shop.snapshot") return state;
  if (event.server_id !== state.serverId || event.instance_id !== state.instanceId) {
    const next = {
      ...state,
      connectionStatus: "baseline-required" as ConnectionStatus,
      serverId: event.server_id,
      instanceId: event.instance_id,
      sequence: -1,
      baselineAccepted: false,
      restartPending: state.serverId !== null,
      lastEventReceivedAtMs: receivedAtMs,
      frame: null,
    };
    return abandonPending(next);
  }
  if (!state.baselineAccepted || event.sequence <= state.sequence) return state;
  const parsedSentAt = event.sent_at ? Date.parse(event.sent_at) : receivedAtMs;
  const frame: ShopSnapshotFrame = {
    serverId: event.server_id,
    instanceId: event.instance_id,
    sequence: event.sequence,
    sentAtMs: Number.isFinite(parsedSentAt) ? parsedSentAt : receivedAtMs,
    receivedAtMs,
    snapshot: event.payload,
  };
  const commands = { ...state.commands };
  for (const [id, record] of Object.entries(commands)) if (record.state === "success") commands[id] = { ...record, state: "idle" };
  return { ...state, sequence: event.sequence, restartPending: false, lastEventReceivedAtMs: receivedAtMs, frame, commands };
}

function availabilityForState(state: ShopState, nowMs: number): ShopAvailability {
  if (["signed-out", "offline", "not-in-game", "unauthorized", "incompatible"].includes(state.connectionStatus)) return "disconnected";
  if (state.connectionStatus === "stale") return "stale";
  if (state.restartPending && !state.frame) return "restarted";
  if (["discovering", "route-pending", "connecting", "baseline-required"].includes(state.connectionStatus) && !state.frame) return "baseline-required";
  if (!state.baselineAccepted) return "baseline-required";
  if (!state.frame) return "no-shop";
  if (state.connectionStatus !== "live") return "stale";
  // Local clock only: a player clock running ahead of the server would otherwise mark
  // every snapshot stale and refuse all purchases.
  return nowMs - state.frame.receivedAtMs > SHOP_STALE_AFTER_MS ? "stale" : "live";
}

function statusLabel(availability: ShopAvailability, connectionStatus: ConnectionStatus): string {
  switch (availability) {
    case "live": return "LIVE";
    case "stale": return "STALE DATA";
    case "disconnected": return connectionStatus === "unauthorized" ? "UNAUTHORIZED" : connectionStatus === "incompatible" ? "INCOMPATIBLE" : connectionStatus === "signed-out" ? "SIGNED OUT" : "OFFLINE";
    case "restarted": return "SERVER RESTARTED";
    case "baseline-required": return "SYNCING";
    case "no-shop": return "NO SHOP DATA";
  }
}

export type ShopItemView = ShopItem & {
  commandState: ShopCommandState;
  commandReason?: string;
  /** The plugin or the buy window refuses it; the card is drawn disabled. */
  unavailable: boolean;
  /** Blocks a purchase: `unavailable`, or a command for it is still in flight. */
  disabled: boolean;
};

/**
 * Purchase eligibility is plugin-authoritative: only `disabled` (derived from
 * `purchasable`, the buy window and pending commands) blocks a purchase. Owning
 * the item already is display-only, e.g. a second flashbang stays buyable.
 */
export function isShopItemPurchaseBlocked(item: Pick<ShopItemView, "disabled">): boolean {
  return item.disabled;
}

export type ShopViewModel = {
  availability: ShopAvailability;
  connectionStatus: ConnectionStatus;
  statusLabel: string;
  hasSnapshot: boolean;
  windowOpen: boolean;
  balance: number;
  nextRoundMinMoney: number | null;
  categories: ShopSnapshot["categories"];
  items: ShopItemView[];
  failureReason: string | null;
  pendingCount: number;
  frame: ShopSnapshotFrame | null;
};

export function selectShop(state: ShopState, nowMs: number): ShopViewModel {
  const availability = availabilityForState(state, nowMs);
  const status = { availability, connectionStatus: state.connectionStatus, statusLabel: statusLabel(availability, state.connectionStatus) };
  if (!state.frame) return { ...status, hasSnapshot: false, windowOpen: false, balance: 0, nextRoundMinMoney: null, categories: undefined, items: [], failureReason: state.failureReason, pendingCount: Object.keys(state.pending).length, frame: null };
  const snapshot = state.frame.snapshot;
  const enabled = availability === "live" && snapshot.window_open;
  return {
    ...status,
    hasSnapshot: true,
    windowOpen: snapshot.window_open,
    balance: snapshot.balance,
    nextRoundMinMoney: snapshot.next_round_min_money ?? null,
    categories: snapshot.categories,
    items: snapshot.items.map((item) => {
      const command = Object.values(state.pending).find((candidate) => candidate.itemId === item.item_id);
      const record = command
        ? state.commands[command.command.command_id]
        : Object.values(state.commands).find((candidate) => candidate.itemId === item.item_id && candidate.state !== "idle");
      const unavailable = !enabled || !item.purchasable;
      return { ...item, commandState: command?.state ?? record?.state ?? "idle", commandReason: command?.reason ?? record?.reason, unavailable, disabled: unavailable || Boolean(command) };
    }),
    failureReason: state.failureReason,
    pendingCount: Object.keys(state.pending).length,
    frame: state.frame,
  };
}
