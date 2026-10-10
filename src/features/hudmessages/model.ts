import {
  HUD_SECONDS_REMAINING_TOKEN,
  HUD_TIME_REMAINING_TOKEN,
  type ConnectionStatus,
  type HudMessagesSnapshot,
  type HudProgressMessage,
  type HudSlotMessage,
  type HudTone,
  type Role,
  type SlgoEvent,
} from "../../contracts/index.ts";

/** The sidecar instance the board belongs to; another one clears it. */
export type HudMessagesSource = { serverId: string; instanceId: string };

export type HudSlotName = keyof HudMessagesSnapshot;

export type HudSlotEntry<M extends HudSlotMessage = HudSlotMessage> = {
  message: M;
  /** Local receive time of the latest copy; every `*_remaining_ms` counts down from here. */
  receivedAtMs: number;
  /** Local time the slot went from empty to showing; replacements keep it (CS2 swaps the text in place). */
  appearedAtMs: number;
  /** One number per appearance (empty -> showing), the React key of the slot box. */
  appearance: number;
  /** Local time the current `key` first showed in this appearance. */
  keySinceMs: number;
};

export type HudMessagesState = {
  source: HudMessagesSource | null;
  slots: {
    progress: HudSlotEntry<HudProgressMessage> | null;
    alert: HudSlotEntry | null;
    hint_high: HudSlotEntry | null;
    hint_low: HudSlotEntry | null;
  };
  /** Per slot, the `message_id` that last ended (cleared or ran out); a late replay of it stays hidden. */
  ended: Record<HudSlotName, string | null>;
  /** Timeline the progress card animates on; re-syncs within `HUD_PROGRESS_RESYNC_MS` keep it. */
  progressAnchor: HudProgressAnchor | null;
  nextAppearance: number;
};

/** Local timeline of the shown progress: the card's CSS animations are fixed from it. */
export type HudProgressAnchor = {
  appearance: number;
  key: string;
  totalMs: number;
  /** Local time the progress reaches its end. */
  endsAtMs: number;
  /** Changes whenever the timeline is re-anchored (new key, total, or a re-sync off by more than the tolerance). */
  revision: number;
};

/** Progress re-syncs closer than this to the running timeline keep it, so the ring never jumps (design 250 ms). */
export const HUD_PROGRESS_RESYNC_MS = 250;

const EMPTY_SLOTS: HudMessagesState["slots"] = { progress: null, alert: null, hint_high: null, hint_low: null };
const NONE_ENDED: HudMessagesState["ended"] = { progress: null, alert: null, hint_high: null, hint_low: null };

export const initialHudMessagesState: HudMessagesState = {
  source: null,
  slots: EMPTY_SLOTS,
  ended: NONE_ENDED,
  progressAnchor: null,
  nextAppearance: 1,
};

export type HudMessagesAction =
  | { type: "event"; event: SlgoEvent; receivedAtMs: number }
  | { type: "connection"; status: ConnectionStatus };

const sameSource = (a: HudMessagesSource | null, serverId: string, instanceId: string) =>
  a !== null && a.serverId === serverId && a.instanceId === instanceId;

/** Local time the entry expires on its own, or null when it shows until replaced or cleared. */
export function hudSlotExpiresAtMs(entry: HudSlotEntry): number | null {
  const visible = entry.message.visible_remaining_ms;
  return visible === null ? null : entry.receivedAtMs + visible;
}

/** Whether the entry still shows at `nowMs`; a message whose own lifetime ran out hides even if the clearing frame is late. */
export function hudSlotVisibleAt(entry: HudSlotEntry, nowMs: number): boolean {
  const expiresAtMs = hudSlotExpiresAtMs(entry);
  return expiresAtMs === null || nowMs < expiresAtMs;
}

/** `{time_remaining}` value at `nowMs`: the plugin's remaining time at `sent_at` minus the local time since receipt. */
export function hudCountdownRemainingMs(entry: HudSlotEntry, nowMs: number): number | null {
  const countdown = entry.message.countdown_remaining_ms;
  return countdown === null ? null : Math.max(0, countdown - Math.max(0, nowMs - entry.receivedAtMs));
}

/** Whole seconds left, rounded up like the plugin's `HudMessageCatalog.FormatTimeRemaining`. */
export function hudCountdownSeconds(remainingMs: number): number {
  return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 1000);
}

/** CS2 countdown `m:ss` (`{time_remaining}`). */
export function formatHudCountdown(remainingMs: number): string {
  const seconds = hudCountdownSeconds(remainingMs);
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}

/** Plain seconds (`{seconds_remaining}`), e.g. 「离过载还剩 34 秒。」. */
export function formatHudSeconds(remainingMs: number): string {
  return String(hudCountdownSeconds(remainingMs));
}

/** The message text with its countdown token (either kind) drawn at `remainingMs`. */
export function drawHudCountdown(text: string, remainingMs: number): string {
  return text
    .split(HUD_TIME_REMAINING_TOKEN).join(formatHudCountdown(remainingMs))
    .split(HUD_SECONDS_REMAINING_TOKEN).join(formatHudSeconds(remainingMs));
}

type SlotStep<M extends HudSlotMessage> = { entry: HudSlotEntry<M> | null; ended: string | null };

function nextSlot<M extends HudSlotMessage>(
  previous: HudSlotEntry<M> | null,
  ended: string | null,
  message: M | null,
  receivedAtMs: number,
  appearance: number,
): SlotStep<M> {
  const previousShowing = previous !== null && hudSlotVisibleAt(previous, receivedAtMs);
  // The message that just left the slot (cleared or ran out) is the one a late replay could repeat.
  const lastEnded = previous !== null && (!previousShowing || message === null) ? previous.message.message_id : ended;
  if (message === null || message.visible_remaining_ms === 0 || message.message_id === lastEnded) {
    return { entry: null, ended: lastEnded };
  }
  if (previousShowing) {
    return {
      entry: {
        message,
        receivedAtMs,
        appearedAtMs: previous.appearedAtMs,
        appearance: previous.appearance,
        keySinceMs: previous.message.key === message.key ? previous.keySinceMs : receivedAtMs,
      },
      ended: lastEnded,
    };
  }
  return { entry: { message, receivedAtMs, appearedAtMs: receivedAtMs, appearance, keySinceMs: receivedAtMs }, ended: lastEnded };
}

export function hudMessagesReducer(state: HudMessagesState, action: HudMessagesAction): HudMessagesState {
  // Only an ended instance clears the board; other drops keep it for a reconnect to the same instance.
  if (action.type === "connection") {
    return action.status === "ended" && state.source !== null ? { ...initialHudMessagesState, nextAppearance: state.nextAppearance } : state;
  }
  const { event, receivedAtMs } = action;
  if (event.type === "sidecar.baseline") {
    // A reconnect to the same instance keeps the board until the replayed snapshot arrives.
    if (sameSource(state.source, event.server_id, event.instance_id)) return state;
    return { ...initialHudMessagesState, source: { serverId: event.server_id, instanceId: event.instance_id }, nextAppearance: state.nextAppearance };
  }
  if (event.type !== "hud.messages" || !sameSource(state.source, event.server_id, event.instance_id)) return state;

  let nextAppearance = state.nextAppearance;
  const ended = { ...state.ended };
  const slot = <M extends HudSlotMessage>(name: HudSlotName, previous: HudSlotEntry<M> | null, message: M | null) => {
    const step = nextSlot(previous, state.ended[name], message, receivedAtMs, nextAppearance);
    ended[name] = step.ended;
    if (step.entry !== null && step.entry.appearance === nextAppearance) nextAppearance += 1;
    return step.entry;
  };
  const { payload } = event;
  const slots = {
    progress: slot("progress", state.slots.progress, payload.progress),
    alert: slot("alert", state.slots.alert, payload.alert),
    hint_high: slot("hint_high", state.slots.hint_high, payload.hint_high),
    hint_low: slot("hint_low", state.slots.hint_low, payload.hint_low),
  };
  return { ...state, slots, ended, progressAnchor: nextProgressAnchor(state.progressAnchor, slots.progress), nextAppearance };
}

function nextProgressAnchor(previous: HudProgressAnchor | null, entry: HudSlotEntry<HudProgressMessage> | null): HudProgressAnchor | null {
  if (entry === null) return null;
  const { progress, key } = entry.message;
  const endsAtMs = entry.receivedAtMs + progress.remaining_ms;
  if (
    previous !== null
    && previous.appearance === entry.appearance
    && previous.key === key
    && previous.totalMs === progress.total_ms
    && Math.abs(previous.endsAtMs - endsAtMs) <= HUD_PROGRESS_RESYNC_MS
  ) return previous;
  return { appearance: entry.appearance, key, totalMs: progress.total_ms, endsAtMs, revision: (previous?.revision ?? 0) + 1 };
}

/** Message-zone slots drawn by `MessageZone` (the progress slot has its own card). */
export type HudMessageZoneSlot = "alert" | "hint_high" | "hint_low";

/** Tones whose alert plays CS2's `FlashAnim` (hudalerts.css) instead of staying at full opacity. */
const FLASH_TONES: ReadonlySet<HudTone> = new Set<HudTone>(["match_point", "final_round"]);

export type HudMessageView = {
  slot: HudMessageZoneSlot;
  /** React key: one mount (and one enter animation) per appearance; replacements keep it. */
  id: string;
  key: string;
  /** Plugin text with its countdown token drawn locally (`m:ss` or seconds); may contain `\n`. */
  text: string;
  tone: HudTone;
  /** CS2 `FlashAnim` run: restarts when a flash-tone alert's key changes. */
  flash: { id: string; startedAtMs: number } | null;
  /** Local time the slot appeared. */
  shownAtMs: number;
  /** Local time the message expires on its own; null = until replaced or cleared. */
  expiresAtMs: number | null;
};

export type HudMessageZoneView = {
  alert: HudMessageView | null;
  hintHigh: HudMessageView | null;
  hintLow: HudMessageView | null;
};

function messageView(slot: HudMessageZoneSlot, entry: HudSlotEntry | null, nowMs: number): HudMessageView | null {
  if (entry === null || !hudSlotVisibleAt(entry, nowMs)) return null;
  const { message } = entry;
  const countdown = hudCountdownRemainingMs(entry, nowMs);
  const text = countdown === null ? message.text : drawHudCountdown(message.text, countdown);
  const flashes = slot === "alert" && FLASH_TONES.has(message.tone);
  return {
    slot,
    id: `${slot}-${entry.appearance}`,
    key: message.key,
    text,
    tone: message.tone,
    flash: flashes ? { id: `${entry.appearance}-${entry.keySinceMs}`, startedAtMs: entry.keySinceMs } : null,
    shownAtMs: entry.appearedAtMs,
    expiresAtMs: hudSlotExpiresAtMs(entry),
  };
}

/** The alert and hint slots to draw at `nowMs`; expired messages are gone even before the clearing frame. */
export function selectMessageZone(state: HudMessagesState, nowMs: number): HudMessageZoneView {
  return {
    alert: messageView("alert", state.slots.alert, nowMs),
    hintHigh: messageView("hint_high", state.slots.hint_high, nowMs),
    hintLow: messageView("hint_low", state.slots.hint_low, nowMs),
  };
}

/** Plugin keys of the two generator progress messages (`HudMessages.GeneratorProgress`). */
export const HUD_PROGRESS_GENERATOR_START_KEY = "SLGO_Progress_Generator_Start";
export const HUD_PROGRESS_GENERATOR_SHUTDOWN_KEY = "SLGO_Progress_Generator_Shutdown";

/** The local player as the progress card needs it (role and generator upgrade from match.snapshot). */
export type HudProgressViewer = { role: Role; hasGeneratorUpgrade: boolean };

/**
 * CS2 icon choice: starting a generator shows the keycard (CS2 has no plant card, the defuse-without-kit
 * C4 look stands in); shutting one down shows the wire cutters with the generator upgrade (CS2 defuse kit),
 * the keycard without it.
 */
export type HudProgressIcon = "keycard" | "wire-cutters";

export type HudProgressCardView = {
  /** React key of the card: one mount per appearance. */
  id: string;
  /** Key of the animated body: changes when the timeline is re-anchored. */
  animationKey: string;
  key: string;
  text: string;
  icon: HudProgressIcon;
  /** Role whose colour washes the wire cutters (CS2 `color-CT`), null without a known viewer. */
  iconRole: Role | null;
  totalMs: number;
  /** Local time the progress ends (the countdown reaches 00:00.000 and waits for the clearing frame). */
  endsAtMs: number;
  /** `remaining_ms` exactly as last sent: debug stills draw it without interpolation. */
  sentRemainingMs: number;
};

export function hudProgressIcon(key: string, viewer: HudProgressViewer | null): HudProgressIcon {
  return key === HUD_PROGRESS_GENERATOR_SHUTDOWN_KEY && viewer?.hasGeneratorUpgrade === true ? "wire-cutters" : "keycard";
}

/** CS2 `{t:d:duration}.{s:milliseconds}` countdown: `mm:ss.mmm`, truncated to the millisecond. */
export function formatHudProgressCountdown(remainingMs: number): string {
  const ms = Math.max(0, Math.floor(remainingMs));
  const seconds = Math.floor(ms / 1000);
  const pad = (value: number, width: number) => value.toString().padStart(width, "0");
  return `${pad(Math.floor(seconds / 60), 2)}:${pad(seconds % 60, 2)}.${pad(ms % 1000, 3)}`;
}

/** The progress card to draw; it stays (at 00:00.000) until the plugin clears the slot. */
export function selectProgressCard(state: HudMessagesState, viewer: HudProgressViewer | null): HudProgressCardView | null {
  const entry = state.slots.progress;
  const anchor = state.progressAnchor;
  if (entry === null || anchor === null) return null;
  const { message } = entry;
  const icon = hudProgressIcon(message.key, viewer);
  return {
    id: `progress-${entry.appearance}`,
    animationKey: `progress-${entry.appearance}-${anchor.revision}`,
    key: message.key,
    text: message.text,
    icon,
    iconRole: icon === "wire-cutters" && viewer !== null ? viewer.role : null,
    totalMs: anchor.totalMs,
    endsAtMs: anchor.endsAtMs,
    sentRemainingMs: message.progress.remaining_ms,
  };
}
