import {
  HUD_TIME_REMAINING_TOKEN,
  type HudMessagesSnapshot,
  type HudProgressMessage,
  type HudSlotMessage,
  type HudTone,
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
  nextAppearance: number;
};

const EMPTY_SLOTS: HudMessagesState["slots"] = { progress: null, alert: null, hint_high: null, hint_low: null };
const NONE_ENDED: HudMessagesState["ended"] = { progress: null, alert: null, hint_high: null, hint_low: null };

export const initialHudMessagesState: HudMessagesState = { source: null, slots: EMPTY_SLOTS, ended: NONE_ENDED, nextAppearance: 1 };

export type HudMessagesAction = { type: "event"; event: SlgoEvent; receivedAtMs: number };

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

/** CS2 countdown `m:ss`, rounded up to the second like the plugin's `HudMessageCatalog.FormatTimeRemaining`. */
export function formatHudCountdown(remainingMs: number): string {
  const seconds = remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 1000);
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
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
  return { ...state, slots, ended, nextAppearance };
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
  /** Plugin text with `{time_remaining}` drawn as the local `m:ss` countdown; may contain `\n`. */
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
  const text = countdown === null ? message.text : message.text.split(HUD_TIME_REMAINING_TOKEN).join(formatHudCountdown(countdown));
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
