import {
  createCommandId,
  MAX_REPLAY_PIN_REASON_LENGTH,
  REPLAY_MAX_SPEED,
  REPLAY_MIN_SPEED,
  type ReplayCatalogCommand,
  type ReplayCatalogQuery,
  type ReplayCommand,
  type ReplayControlAction,
  type ReplayControlCommand,
} from "../../contracts/index.ts";
import type { ReplayCatalogFilters } from "./model.ts";

// Constructors for the `command.replay.*` commands (README "Demo replay", "Commands"); every one is a valid
// SlgoCommand (replay-model-smoke runs each through parseCommand).

const id = () => createCommandId("replay");

export function replayControl(action: ReplayControlAction): ReplayControlCommand {
  return { kind: "command.replay.control", command_id: id(), ...action } as ReplayControlCommand;
}
export const replayLoad = (matchId: string): ReplayCommand => ({ kind: "command.replay.load", command_id: id(), match_id: matchId });
export const replayUnload = (): ReplayCommand => ({ kind: "command.replay.unload", command_id: id() });
export const replayPov = (slot: number | null): ReplayCommand => ({ kind: "command.replay.pov", command_id: id(), slot });
export const replayPin = (matchId: string, reason: string): ReplayCommand => ({ kind: "command.replay.pin", command_id: id(), match_id: matchId, reason });
export const replayUnpin = (matchId: string): ReplayCommand => ({ kind: "command.replay.unpin", command_id: id(), match_id: matchId });
export const replayCatalog = (query: ReplayCatalogQuery): ReplayCatalogCommand => ({ kind: "command.replay.catalog", command_id: id(), query });

/** The status-line label of a command ("播放被拒绝：..."). */
export function replayCommandLabel(command: ReplayCommand): string {
  switch (command.kind) {
    case "command.replay.catalog": return "录像列表";
    case "command.replay.load": return "加载录像";
    case "command.replay.unload": return "结束回放";
    case "command.replay.pov": return command.slot === null ? "自由视角" : "第一视角";
    case "command.replay.pin": return "Pin";
    case "command.replay.unpin": return "取消 Pin";
    case "command.replay.control":
      switch (command.action) {
        case "play": return "播放";
        case "pause": return "暂停";
        case "toggle": return "播放 / 暂停";
        case "step": return "单步";
        case "speed": return "倍速";
        case "seek": return "跳转";
        case "round": return "回合跳转";
      }
  }
}

/** The speed menu (the protocol allows any value in 0.25-4; the menu and ↑ / ↓ offer these). */
export const REPLAY_SPEED_STEPS = [0.25, 0.5, 1, 2, 4] as const;

/** One step up (+1) or down (-1) the menu from the current speed; null at either end. */
export function nextReplaySpeed(current: number, direction: 1 | -1): number | null {
  const steps = REPLAY_SPEED_STEPS as readonly number[];
  const next = direction > 0 ? steps.find((step) => step > current + 1e-9) : [...steps].reverse().find((step) => step < current - 1e-9);
  return next === undefined || next < REPLAY_MIN_SPEED || next > REPLAY_MAX_SPEED ? null : next;
}

/** The ±10 s step (PRD R12; CS2 uses 15 s). */
export const REPLAY_STEP_MS = 10_000;
/** A kill icon jumps this long before the kill (CS2 `flSkipToTicksBefore`: 2 s). */
export const REPLAY_KILL_LEAD_MS = 2_000;
export const killSeekPositionMs = (killAtMs: number) => Math.max(0, killAtMs - REPLAY_KILL_LEAD_MS);

/**
 * The sidecar's command limit (slgo-backend `DEFAULT_COMMAND_RATE_LIMIT`): one token bucket per player shared by every
 * command, burst 10, 120 a minute; a command over it is answered `rejected` / `rate-limited`.
 */
export const SIDECAR_COMMAND_RATE_LIMIT = { burst: 10, perMinute: 120 } as const;
/** SLUI's own budget for replay commands, a little inside the sidecar's so it never refuses one. */
export const REPLAY_COMMAND_BUDGET = { burst: 8, perMinute: 100 } as const;

export type CommandBudget = {
  /** Spends one token; false = over budget, do not send. */
  take(): boolean;
  /** How long until a token is available (0 = now). */
  waitMs(): number;
};

/** A token bucket like the sidecar's (`RateLimiter`), on an injected clock. */
export function createCommandBudget(limit: { burst: number; perMinute: number }, now: () => number): CommandBudget {
  const refillPerMs = limit.perMinute / 60_000;
  let tokens: number = limit.burst;
  let updatedAt = now();
  const refill = () => {
    const at = now();
    tokens = Math.min(limit.burst, tokens + Math.max(0, at - updatedAt) * refillPerMs);
    updatedAt = at;
  };
  return {
    take() {
      refill();
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    waitMs() {
      refill();
      return tokens >= 1 ? 0 : Math.ceil((1 - tokens) / refillPerMs);
    },
  };
}

/** At most one seek per window: 2 per second, the sidecar's sustained rate; the budget may hold one back longer. */
export const REPLAY_SEEK_WINDOW_MS = 500;

export type SeekPacerOptions = {
  now(): number;
  /** Runs `callback` after `ms`; returns a cancel function. */
  schedule(callback: () => void, ms: number): () => void;
  send(seek: { position_ms: number } | { delta_ms: number }): void;
  minIntervalMs?: number;
  /** Extra wait before the next send (the command budget); 0 = none. */
  waitMs?(): number;
};

export type SeekPacer = {
  /** An absolute target (drag released, a kill icon, a click on the timeline): replaces anything queued. */
  seekTo(positionMs: number): void;
  /** A relative step (±10 s, arrow keys with auto-repeat): adds up within the window; a zero sum sends nothing. */
  seekBy(deltaMs: number): void;
  /** Drops anything queued (the console closed). */
  cancel(): void;
};

/**
 * Coalesces seeks so at most one leaves per window and none over the budget: the first goes at once, later ones are
 * merged while they wait (an absolute target replaces what is queued, a relative step adds to it) and sent when both
 * the window and the budget allow. A seek is never dropped.
 */
export function createSeekPacer(options: SeekPacerOptions): SeekPacer {
  const window = options.minIntervalMs ?? REPLAY_SEEK_WINDOW_MS;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let queued: { position_ms: number } | { delta_ms: number } | null = null;
  let cancelTimer: (() => void) | null = null;

  const waitMs = () => Math.max(lastSentAt + window - options.now(), options.waitMs?.() ?? 0);
  const emit = (seek: { position_ms: number } | { delta_ms: number }) => {
    if ("delta_ms" in seek && Math.round(seek.delta_ms) === 0) return;
    lastSentAt = options.now();
    options.send("delta_ms" in seek ? { delta_ms: Math.round(seek.delta_ms) } : { position_ms: Math.max(0, Math.round(seek.position_ms)) });
  };
  const flush = () => {
    cancelTimer = null;
    const wait = waitMs();
    if (wait > 0) {
      cancelTimer = options.schedule(flush, wait);
      return;
    }
    const seek = queued;
    queued = null;
    if (seek) emit(seek);
  };
  const submit = (merge: (current: typeof queued) => NonNullable<typeof queued>) => {
    const wait = waitMs();
    if (wait <= 0 && queued === null) {
      emit(merge(null));
      return;
    }
    queued = merge(queued);
    cancelTimer ??= options.schedule(flush, Math.max(0, wait));
  };
  return {
    seekTo: (positionMs) => submit(() => ({ position_ms: positionMs })),
    seekBy: (deltaMs) => submit((current) => current === null ? { delta_ms: deltaMs }
      : "delta_ms" in current ? { delta_ms: current.delta_ms + deltaMs } : { position_ms: current.position_ms + deltaMs }),
    cancel() {
      queued = null;
      cancelTimer?.();
      cancelTimer = null;
    },
  };
}

/** Pin reasons: trimmed, 1-128 characters, one line, no control characters. */
export function validatePinReason(text: string): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = text.trim();
  if (reason.length === 0) return { ok: false, error: "请填写 pin 原因" };
  if (reason.length > MAX_REPLAY_PIN_REASON_LENGTH) return { ok: false, error: `原因最多 ${MAX_REPLAY_PIN_REASON_LENGTH} 个字符` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(reason)) return { ok: false, error: "原因只能是一行文字" };
  return { ok: true, reason };
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A local date (`YYYY-MM-DD`) as the ISO instant of its first or last millisecond in the local time zone. */
export function localDateBound(date: string, edge: "start" | "end"): string | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const local = edge === "start" ? new Date(year, month, day, 0, 0, 0, 0) : new Date(year, month, day, 23, 59, 59, 999);
  // new Date rolls invalid days over (02-31 -> 03-03): refuse them.
  if (local.getFullYear() !== year || local.getMonth() !== month || local.getDate() !== day) return null;
  return local.toISOString();
}

/** The catalog query for the panel's filters and a page; empty fields are left out, local dates become ISO instants. */
export function catalogQuery(filters: ReplayCatalogFilters, page: number): { ok: true; query: ReplayCatalogQuery } | { ok: false; error: string } {
  const query: ReplayCatalogQuery = { page: Math.max(1, Math.trunc(page)) };
  const serverId = filters.serverId.trim();
  const player = filters.player.trim();
  if (serverId) query.server_id = serverId;
  if (player) query.player = player;
  if (filters.test !== "all") query.test = filters.test === "only";
  if (filters.pinnedOnly) query.pinned = true;
  if (filters.since) {
    const since = localDateBound(filters.since, "start");
    if (since === null) return { ok: false, error: "起始日期无效" };
    query.since = since;
  }
  if (filters.until) {
    const until = localDateBound(filters.until, "end");
    if (until === null) return { ok: false, error: "结束日期无效" };
    query.until = until;
  }
  if (query.since && query.until && Date.parse(query.until) < Date.parse(query.since)) return { ok: false, error: "结束日期早于起始日期" };
  return { ok: true, query };
}
