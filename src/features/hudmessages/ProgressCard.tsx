import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatHudProgressCountdown, HUD_PROGRESS_RESYNC_MS, type HudProgressCardView } from "./model";
import { ROLE_COLORS } from "../../shared/roleColors.ts";
import { useOverlayScale } from "../../shared/overlay.ts";
import "./ProgressCard.css";

/** Exit lengths: CS2 `hudProgressBarSuccessZoom` (recording) and the `--visible` opacity transition. */
export const HUD_PROGRESS_FINISH_MS = 400;
export const HUD_PROGRESS_FADE_MS = 400;

const ICON_URL: Readonly<Record<HudProgressCardView["icon"], string>> = {
  keycard: "/assets/slui-svg/KeycardNTFCommander.svg",
  "wire-cutters": "/assets/icons/wire-cutters.svg",
};

type CardBodyProps = { card: HudProgressCardView; still: boolean };

/**
 * The animated part of the card. Its CSS timeline (ring, colours, side glow) is fixed when it mounts from
 * the anchored end time, so the 250 ms UI clock never re-times it; a re-anchor remounts it (new key).
 * The countdown is written every animation frame, as CS2 does.
 */
function ProgressCardBody({ card, still }: CardBodyProps) {
  const [mountedAtMs] = useState(Date.now);
  const countdownRef = useRef<HTMLSpanElement>(null);
  const remainingAtMount = still ? card.sentRemainingMs : Math.max(0, card.endsAtMs - mountedAtMs);
  const elapsedMs = Math.min(card.totalMs, card.totalMs - remainingAtMount);
  useEffect(() => {
    const node = countdownRef.current;
    if (!node) return undefined;
    if (still) {
      node.textContent = formatHudProgressCountdown(card.sentRemainingMs);
      return undefined;
    }
    let frame = 0;
    const tick = () => {
      const remaining = card.endsAtMs - Date.now();
      node.textContent = formatHudProgressCountdown(remaining);
      if (remaining > 0) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [card.endsAtMs, card.sentRemainingMs, still]);
  const style = {
    "--hudprogress-duration": `${card.totalMs}ms`,
    "--hudprogress-delay": `${-elapsedMs}ms`,
    "--hudprogress-icon": `url("${ICON_URL[card.icon]}")`,
    ...(card.iconRole ? { "--hudprogress-icon-color": ROLE_COLORS[card.iconRole] } : {}),
  } as CSSProperties;
  return (
    <div className="hudprogress__body" data-still={still ? "true" : undefined} style={style}>
      <span className="hudprogress__glow hudprogress__glow--left" aria-hidden="true" />
      <span className="hudprogress__glow hudprogress__glow--right" aria-hidden="true" />
      <span className="hudprogress__side hudprogress__side--left" aria-hidden="true" />
      <span className="hudprogress__side hudprogress__side--right" aria-hidden="true" />
      <div className="hudprogress__layout">
        <div className="hudprogress__circle" aria-hidden="true">
          <span className="hudprogress__track" />
          <span className="hudprogress__arc" />
          <span className={`hudprogress__icon hudprogress__icon--${card.icon}`} />
          <span className="hudprogress__inner" />
        </div>
        <div className="hudprogress__info">
          <div className="hudprogress__title">{card.text}</div>
          <div className="hudprogress__countdown">
            <span ref={countdownRef}>{formatHudProgressCountdown(remainingAtMount)}</span>{" "}
          </div>
        </div>
      </div>
    </div>
  );
}

type Exit = { card: HudProgressCardView; kind: "finished" | "fade" };

export type ProgressCardProps = {
  card: HudProgressCardView | null;
  /** Debug captures: no animation, the countdown and ring drawn at the sent remaining time. */
  still?: boolean;
};

/**
 * CS2 `CSGOHudProgressBar` (hudprogressbar.xml / hudprogressbar.css) on the 1920x1080 overlay canvas: the
 * defuse card, used for starting and shutting down a generator. It appears at once; when the plugin clears
 * it, a card whose countdown already reached zero plays CS2's success zoom, any other fades out.
 */
export function ProgressCard({ card, still = false }: ProgressCardProps) {
  const scale = useOverlayScale();
  const [previous, setPrevious] = useState<HudProgressCardView | null>(card);
  const [exit, setExit] = useState<Exit | null>(null);
  // Derived during render, so the frame the card ends in already draws the exit (no blank frame).
  if (card !== previous) {
    setPrevious(card);
    if (card === null && previous !== null && !still) {
      // Within the re-sync tolerance of the end the countdown already shows (about) zero: it finished.
      const finished = previous.endsAtMs - Date.now() <= HUD_PROGRESS_RESYNC_MS;
      setExit({ card: previous, kind: finished ? "finished" : "fade" });
    } else if (card !== null && exit !== null) setExit(null);
  }
  useEffect(() => {
    if (exit === null) return undefined;
    const timer = window.setTimeout(() => setExit(null), exit.kind === "finished" ? HUD_PROGRESS_FINISH_MS : HUD_PROGRESS_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [exit]);

  const shown = card ?? exit?.card ?? null;
  const leaving = card === null && exit !== null ? exit.kind : null;
  return (
    <section className="hudprogress-overlay" aria-label="进度">
      <div className="hudprogress-canvas" style={{ "--hudprogress-scale": scale } as CSSProperties}>
        {shown ? (
          <div
            key={shown.id}
            className={`hudprogress${leaving ? ` hudprogress--${leaving}` : ""}`}
            data-hudprogress={shown.key}
            data-icon={shown.icon}
          >
            <ProgressCardBody key={shown.animationKey} card={shown} still={still} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
