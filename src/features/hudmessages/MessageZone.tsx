import { useEffect, useState, type CSSProperties } from "react";
import type { HudMessageView, HudMessageZoneSlot, HudMessageZoneView } from "./model";
import { useOverlayScale } from "../../shared/overlay.ts";
import "./MessageZone.css";

/**
 * Exit lengths (recording): an alert fades its text, turns white and collapses (750 ms); a hint
 * collapses and fades at once (200 ms). The last view stays mounted that long.
 */
export const HUD_ALERT_EXIT_MS = 750;
export const HUD_HINT_EXIT_MS = 200;
/** CS2 `FlashAnim` (3.7 s) split around the plugin's own lifetime: the settle at the start, the closing flash before expiry. */
export const HUD_FLASH_SETTLE_MS = 2_109;
export const HUD_FLASH_CLOSE_MS = 518;

const SLOT_CLASS: Readonly<Record<HudMessageZoneSlot, string>> = {
  alert: "hudmsg--alert",
  hint_high: "hudmsg--hint hudmsg--high",
  hint_low: "hudmsg--hint hudmsg--low",
};

const exitMsFor = (slot: HudMessageZoneSlot) => slot === "alert" ? HUD_ALERT_EXIT_MS : HUD_HINT_EXIT_MS;

type MessageBoxProps = { view: HudMessageView; leaving: boolean; still: boolean };

function MessageBox({ view, leaving, still }: MessageBoxProps) {
  const flash = view.flash;
  // The closing flash ends when the message expires; its delay is fixed from the flash start, so the
  // 250 ms UI clock never re-times it.
  const style = flash !== null && view.expiresAtMs !== null
    ? { "--hudmsg-flash-close-delay": `${view.expiresAtMs - HUD_FLASH_CLOSE_MS - flash.startedAtMs}ms` } as CSSProperties
    : undefined;
  return (
    <div
      className={`hudmsg ${SLOT_CLASS[view.slot]}${flash ? " hudmsg--flash" : ""}${flash && view.expiresAtMs !== null ? " hudmsg--flash-close" : ""}${leaving ? " hudmsg--leaving" : ""}`}
      data-hudmsg={view.slot}
      data-key={view.key}
      data-tone={view.tone}
      data-still={still ? "true" : undefined}
      style={style}
    >
      <div className="hudmsg__box">
        <span className="hudmsg__fill" aria-hidden="true" />
        <span className="hudmsg__white" aria-hidden="true" />
        <span className="hudmsg__glitch" aria-hidden="true" />
        <span className="hudmsg__bar hudmsg__bar--left" aria-hidden="true" />
        <span className="hudmsg__bar hudmsg__bar--right" aria-hidden="true" />
        <div className="hudmsg__text">{view.text}</div>
      </div>
    </div>
  );
}

type MessageSlotProps = { slot: HudMessageZoneSlot; view: HudMessageView | null; still: boolean };

/**
 * One fixed slot of CS2's bottom-centre zone. A message mounts once per appearance (replacements swap
 * the text in place, as in CS2); it starts its exit at its own expiry time, not on the next UI tick,
 * and the last view plays the exit before it unmounts.
 */
function MessageSlot({ slot, view, still }: MessageSlotProps) {
  const [expiredAtMs, setExpiredAtMs] = useState<number | null>(null);
  const expiresAtMs = view?.expiresAtMs ?? null;
  useEffect(() => {
    if (still || expiresAtMs === null) return undefined;
    const timer = window.setTimeout(() => setExpiredAtMs(expiresAtMs), Math.max(0, expiresAtMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAtMs, still]);
  const live = view !== null && !(expiresAtMs !== null && expiredAtMs === expiresAtMs) ? view : null;

  const [previous, setPrevious] = useState<HudMessageView | null>(live);
  const [exiting, setExiting] = useState<HudMessageView | null>(null);
  // Derived during render, so the frame the message ends in already draws the exit (no blank frame).
  if (live !== previous) {
    setPrevious(live);
    if (live === null) setExiting(still ? null : previous);
    else if (exiting !== null && exiting.id !== live.id) setExiting(null);
  }
  useEffect(() => {
    if (exiting === null) return undefined;
    const timer = window.setTimeout(() => setExiting(null), exitMsFor(slot));
    return () => window.clearTimeout(timer);
  }, [exiting, slot]);

  const shown = live ?? exiting;
  if (shown === null) return null;
  const boxKey = shown.flash ? `${shown.id}:${shown.flash.id}` : shown.id;
  return <MessageBox key={boxKey} view={shown} leaving={live === null} still={still} />;
}

export type MessageZoneProps = {
  zone: HudMessageZoneView;
  /** Debug captures: no enter, exit or flash animation, so a still frame is deterministic. */
  still?: boolean;
};

/**
 * CS2 `HudBottomCenter--float` (hud.xml): `CSGOHudAlerts` and the two `CSGOHudHintText` panels
 * (hudalerts.css / hudhinttext.css) on the 1920x1080 overlay canvas. Slots are fixed, not stacked.
 */
export function MessageZone({ zone, still = false }: MessageZoneProps) {
  const scale = useOverlayScale();
  return (
    <section className="hudmsg-overlay" aria-label="提示信息">
      <div className="hudmsg-canvas" style={{ "--hudmsg-scale": scale } as CSSProperties}>
        <MessageSlot slot="alert" view={zone.alert} still={still} />
        <MessageSlot slot="hint_high" view={zone.hintHigh} still={still} />
        <MessageSlot slot="hint_low" view={zone.hintLow} still={still} />
      </div>
    </section>
  );
}
