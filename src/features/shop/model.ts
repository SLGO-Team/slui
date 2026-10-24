import {
  createCommandId,
  type CommandResult,
  type ConnectionStatus,
  type ShopCommand,
  type ShopFulfillCommand,
  type ShopItem,
  type ShopPurchaseCommand,
  type ShopRequest,
  type ShopRequestCommand,
  type ShopSnapshot,
  type SlgoEvent,
} from "../../contracts/index.ts";

export const SHOP_COMMAND_TIMEOUT_MS = 5_000;
export const SHOP_STALE_AFTER_MS = 5_000;

export type ShopCommandState = "idle" | "pending" | "success" | "failed" | "timedOut" | "rejected" | "abandoned";

/**
 * What a command acts on: `purchase:<item>` (buy for oneself), `request:<item>` (toggle one's teammate
 * request), `fulfill:<request id>` (buy a teammate's request). A command blocks repeats of its own target.
 */
export type ShopCommandTarget = string;

export function shopCommandTarget(command: ShopCommand): ShopCommandTarget {
  switch (command.kind) {
    case "command.shop.purchase": return `purchase:${command.item_id}`;
    case "command.shop.request": return `request:${command.item_id}`;
    case "command.shop.fulfill": return `fulfill:${command.request_id}`;
  }
}

export type ShopPendingCommand = {
  command: ShopCommand;
  target: ShopCommandTarget;
  sentAtMs: number;
  state: Extract<ShopCommandState, "pending" | "timedOut">;
  reason?: string;
};

export type ShopCommandRecord = {
  state: ShopCommandState;
  target: ShopCommandTarget;
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
  | { type: "command"; command: ShopCommand; sentAtMs: number }
  | { type: "command-result"; result: CommandResult; receivedAtMs?: number }
  | { type: "tick"; nowMs: number };

function abandonPending(state: ShopState): ShopState {
  const pending = { ...state.pending };
  const commands = { ...state.commands };
  for (const [id, command] of Object.entries(pending)) {
    commands[id] = { state: "abandoned", target: command.target, sentAtMs: command.sentAtMs, reason: "Connection lost" };
    delete pending[id];
  }
  return { ...state, pending, commands };
}

export function createPurchaseCommand(itemId: string, quantity = 1): ShopPurchaseCommand {
  return { kind: "command.shop.purchase", command_id: createCommandId("purchase"), item_id: itemId, quantity };
}

export function createRequestCommand(itemId: string): ShopRequestCommand {
  return { kind: "command.shop.request", command_id: createCommandId("request"), item_id: itemId };
}

export function createFulfillCommand(requestId: string): ShopFulfillCommand {
  return { kind: "command.shop.fulfill", command_id: createCommandId("fulfill"), request_id: requestId };
}

export function canPurchase(snapshot: ShopSnapshot, itemId: string): boolean {
  const item = snapshot.items.find((candidate) => candidate.item_id === itemId);
  return Boolean(snapshot.window_open && item?.purchasable);
}

/** The snapshot lets the viewer ask teammates for items at all (some item is requestable). */
export function canRequestAny(snapshot: ShopSnapshot): boolean {
  return snapshot.items.some((item) => item.requestable === true);
}

/**
 * Whether the snapshot allows sending this command. A request is sent for any card once requesting is
 * possible: the plugin answers an item outside the scope with its own reason.
 */
export function canSendShopCommand(snapshot: ShopSnapshot, command: ShopCommand): boolean {
  if (!snapshot.window_open) return false;
  switch (command.kind) {
    case "command.shop.purchase": return canPurchase(snapshot, command.item_id);
    case "command.shop.request": return canRequestAny(snapshot) && snapshot.items.some((item) => item.item_id === command.item_id);
    case "command.shop.fulfill": return Boolean(snapshot.requests?.find((request) => request.request_id === command.request_id)?.purchasable);
  }
}

function sourceChanged(state: ShopState, serverId: string, instanceId: string): boolean {
  return state.serverId !== null && (state.serverId !== serverId || state.instanceId !== instanceId);
}

/** The events shopReducer reads; App dispatches no others to it (each dispatch re-renders App). */
export const SHOP_EVENT_TYPES: ReadonlySet<SlgoEvent["type"]> = new Set<SlgoEvent["type"]>(["sidecar.baseline", "shop.snapshot", "command.result"]);

export function shopReducer(state: ShopState, action: ShopAction): ShopState {
  if (action.type === "connection") {
    if (action.status === "ended") return { ...initialShopState, connectionStatus: "ended" };
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
        commands[id] = { state: "timedOut", target: command.target, sentAtMs: command.sentAtMs };
        changed = true;
      }
    }
    return changed ? { ...state, pending, commands } : state;
  }

  if (action.type === "command") {
    if (!state.frame || state.connectionStatus !== "live" || !canSendShopCommand(state.frame.snapshot, action.command)) return state;
    if (state.pending[action.command.command_id]) return state;
    const existing = state.commands[action.command.command_id];
    if (existing && existing.state !== "idle") return state;
    const target = shopCommandTarget(action.command);
    if (Object.values(state.pending).some((candidate) => candidate.target === target)) return state;
    const pending: ShopPendingCommand = { command: action.command, target, sentAtMs: action.sentAtMs, state: "pending" };
    return {
      ...state,
      pending: { ...state.pending, [action.command.command_id]: pending },
      commands: { ...state.commands, [action.command.command_id]: { state: "pending", target, sentAtMs: action.sentAtMs } },
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
        target: command.target,
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
  // Each connection's baseline restarts the sequence, as in roundHudReducer (a restarted sidecar counts from 0 again).
  if (event.type === "sidecar.baseline") {
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
  if (["signed-out", "offline", "not-in-game", "ended", "unauthorized", "incompatible"].includes(state.connectionStatus)) return "disconnected";
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
  /** A request toggle for this item is in flight; a repeat waits for its result. */
  requestPending: boolean;
};

/** A teammate's request as the request area draws it; the same purchase rules as a card. */
export type ShopRequestView = ShopRequest & {
  commandState: ShopCommandState;
  commandReason?: string;
  /** The viewer cannot pay it now, or the shop is not live with the buy window open. */
  unavailable: boolean;
  /** Blocks a click: `unavailable`, or a fulfilment of it is still in flight. */
  disabled: boolean;
};

/**
 * Purchase eligibility is plugin-authoritative: only `disabled` (derived from
 * `purchasable`, the buy window and pending commands) blocks a purchase. Owning
 * the item already is display-only, e.g. a second flashbang stays buyable.
 */
export function isShopItemPurchaseBlocked(item: Pick<ShopItemView | ShopRequestView, "disabled">): boolean {
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
  /** Teammates' requests the viewer may fulfil (the request area); empty without any. */
  requests: ShopRequestView[];
  /** Some item is requestable: R / right-click on a card sends a request and the navbar shows the hint. */
  canRequest: boolean;
  failureReason: string | null;
  pendingCount: number;
  frame: ShopSnapshotFrame | null;
};

function commandFor(state: ShopState, target: ShopCommandTarget): { pending: ShopPendingCommand | undefined; record: ShopCommandRecord | undefined } {
  const pending = Object.values(state.pending).find((candidate) => candidate.target === target);
  const record = pending
    ? state.commands[pending.command.command_id]
    : Object.values(state.commands).find((candidate) => candidate.target === target && candidate.state !== "idle");
  return { pending, record };
}

/** A command the tick can still time out; while none is, nothing in the shop state waits on the clock. */
export function hasTimedShopCommand(state: ShopState): boolean {
  return Object.values(state.pending).some((command) => command.state === "pending");
}

/** Two selectShop results of one state differ in time only through availability (it also gates the cards). */
export function sameShopTime(a: ShopViewModel, b: ShopViewModel): boolean {
  return a.availability === b.availability;
}

/** `nowMs` only decides availability; App keeps the previous view while sameShopTime holds. */
export function selectShop(state: ShopState, nowMs: number): ShopViewModel {
  const availability = availabilityForState(state, nowMs);
  const status = { availability, connectionStatus: state.connectionStatus, statusLabel: statusLabel(availability, state.connectionStatus) };
  if (!state.frame) return { ...status, hasSnapshot: false, windowOpen: false, balance: 0, nextRoundMinMoney: null, categories: undefined, items: [], requests: [], canRequest: false, failureReason: state.failureReason, pendingCount: Object.keys(state.pending).length, frame: null };
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
      const { pending: command, record } = commandFor(state, `purchase:${item.item_id}`);
      const unavailable = !enabled || !item.purchasable;
      const requestPending = Boolean(commandFor(state, `request:${item.item_id}`).pending);
      return { ...item, commandState: command?.state ?? record?.state ?? "idle", commandReason: command?.reason ?? record?.reason, unavailable, disabled: unavailable || Boolean(command), requestPending };
    }),
    requests: (snapshot.requests ?? []).map((request) => {
      const { pending: command, record } = commandFor(state, `fulfill:${request.request_id}`);
      const unavailable = !enabled || !request.purchasable;
      return { ...request, commandState: command?.state ?? record?.state ?? "idle", commandReason: command?.reason ?? record?.reason, unavailable, disabled: unavailable || Boolean(command) };
    }),
    canRequest: enabled && canRequestAny(snapshot),
    failureReason: state.failureReason,
    pendingCount: Object.keys(state.pending).length,
    frame: state.frame,
  };
}
