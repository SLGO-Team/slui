import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { WinPanelMvpView, WinPanelView } from "./model";
import {
  CHECKER_HEIGHT,
  CHECKER_RUN_MS,
  CHECKER_SQUARE_SIZE,
  CHECKER_STILL_MS,
  CHECKER_WIDTH,
  WIN_PANEL_MVP_DELAY_MS,
  checkerAlpha,
  checkerExitAlpha,
  checkerSeed,
  checkerSquares,
  type CheckerSquare,
} from "./checker.ts";
import { useOverlayScale } from "../../shared/overlay.ts";
import "./WinPanel.css";

/**
 * Exit length (recording): the title box flashes white and collapses in 0.2 s, the MVP strip in 0.23 s;
 * the last view stays mounted that long.
 */
export const WIN_PANEL_EXIT_MS = 240;

export type WinPanelProps = {
  panel: WinPanelView | null;
  /** Debug captures: no enter, exit or checker animation, so a still frame is deterministic. */
  still?: boolean;
};

/**
 * Panorama `text-overflow: shrink`: a label wider than its box is drawn at a smaller font size.
 * Measured on layout sizes, so the overlay scale does not matter; refitted once the fonts load.
 */
function useShrinkToFit<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    let active = true;
    const fit = () => {
      if (!active) return;
      element.style.fontSize = "";
      if (element.scrollWidth <= element.clientWidth) return;
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      element.style.fontSize = `${(size * element.clientWidth) / element.scrollWidth}px`;
    };
    fit();
    void document.fonts?.ready.then(fit);
    return () => { active = false; };
  }, [text]);
  return ref;
}

type CheckerProps = { seed: number; leaving: boolean; still: boolean; scale: number };

/**
 * The lighting checker behind the MVP strip, drawn on a canvas by requestAnimationFrame from the pure
 * `checkerAlpha` model (never the UI clock). Its clock is read from the strip's own entrance animation,
 * so it stays locked to the CSS timeline; the exit draws one still pattern.
 */
function MvpChecker({ seed, leaving, still, scale }: CheckerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Timeline time of the strip entrance; kept across re-renders and rescales. */
  const stripStartRef = useRef<number | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;
    const ratio = scale * (window.devicePixelRatio || 1);
    canvas.width = Math.round(CHECKER_WIDTH * ratio);
    canvas.height = Math.round(CHECKER_HEIGHT * ratio);
    const accent = getComputedStyle(canvas).getPropertyValue("--winpanel-mvp-accent").trim() || "#fff";
    const squares = checkerSquares();
    const draw = (alphaOf: (square: CheckerSquare) => number) => {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, CHECKER_WIDTH, CHECKER_HEIGHT);
      context.fillStyle = accent;
      for (const square of squares) {
        const alpha = alphaOf(square);
        if (alpha < 0.004) continue;
        context.globalAlpha = alpha;
        context.fillRect(square.x, square.y, CHECKER_SQUARE_SIZE, CHECKER_SQUARE_SIZE);
      }
      context.globalAlpha = 1;
    };
    if (leaving) {
      draw((square) => checkerExitAlpha(seed, square));
      return undefined;
    }
    if (still) {
      draw((square) => checkerAlpha(seed, square, CHECKER_STILL_MS));
      return undefined;
    }
    // The strip's entrance animation (its delay included) started at the strip clock's -990 ms.
    const stripStart = (now: number) => {
      if (stripStartRef.current !== null) return stripStartRef.current;
      const entrance = canvas.closest(".winpanel-mvp")?.getAnimations()
        .find((animation) => (animation as CSSAnimation).animationName === "winpanel-open");
      const elapsed = entrance?.currentTime;
      if (typeof elapsed === "number") stripStartRef.current = now - elapsed + WIN_PANEL_MVP_DELAY_MS;
      else if (!entrance) stripStartRef.current = now + WIN_PANEL_MVP_DELAY_MS;
      return stripStartRef.current;
    };
    let frame = 0;
    const tick = (now: number) => {
      const start = stripStart(now);
      const stripMs = start === null ? -1 : now - start;
      draw((square) => checkerAlpha(seed, square, stripMs));
      if (stripMs < CHECKER_RUN_MS) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seed, leaving, still, scale]);
  return <canvas ref={canvasRef} className="winpanel-mvp__checker" aria-hidden="true" />;
}

function MvpStrip({ mvp, checker }: { mvp: WinPanelMvpView; checker: CheckerProps }) {
  const kitRef = useShrinkToFit<HTMLSpanElement>(mvp.musicKit ?? "");
  return (
    <div className="winpanel-mvp" data-winpanel="mvp">
      <div className="winpanel-mvp__band">
        <MvpChecker {...checker} />
      </div>
      <div className="winpanel-mvp__content">
        <div className="winpanel-mvp__avatar">
          <img className="winpanel-mvp__fallback" src={mvp.fallbackAvatarUrl} alt="" draggable={false} />
          {mvp.avatarUrl ? (
            <img
              key={mvp.avatarUrl}
              className="winpanel-mvp__steam-avatar"
              src={mvp.avatarUrl}
              alt=""
              draggable={false}
              onError={(event) => { event.currentTarget.hidden = true; }}
            />
          ) : null}
        </div>
        <div className="winpanel-mvp__details">
          <div className="winpanel-mvp__reason">{mvp.reason}</div>
          <div className="winpanel-mvp__name">{mvp.name}</div>
          {mvp.musicKit !== null ? (
            <div className="winpanel-mvp__kit">
              <span ref={kitRef} className="winpanel-mvp__kit-name">{mvp.musicKit}</span>
              <span className="winpanel-mvp__kit-note" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </div>
      <span className="winpanel-mvp__white" aria-hidden="true" />
    </div>
  );
}

type WinPanelCardProps = { view: WinPanelView; leaving: boolean; still: boolean; scale: number };

function WinPanelCard({ view, leaving, still, scale }: WinPanelCardProps) {
  const titleRef = useShrinkToFit<HTMLDivElement>(view.title);
  const subtitleRef = useShrinkToFit<HTMLDivElement>(view.subtitle ?? "");
  const style = {
    "--winpanel-accent": view.colors.accent,
    "--winpanel-fill": view.colors.fill,
    "--winpanel-mvp-accent": view.colors.mvpAccent,
    "--winpanel-mvp-fill": view.colors.mvpFill,
  } as CSSProperties;
  return (
    <div
      className={`winpanel winpanel--${view.outcome}${leaving ? " winpanel--leaving" : ""}`}
      data-winpanel="root"
      data-outcome={view.outcome}
      data-winner={view.winnerRole ?? "none"}
      data-match-end={view.isMatchEnd ? "true" : "false"}
      data-still={still ? "true" : undefined}
      style={style}
    >
      <div className="winpanel-result" data-winpanel="result">
        <span className="winpanel-result__arrows winpanel-result__arrows--left" aria-hidden="true" />
        <span className="winpanel-result__arrows winpanel-result__arrows--right" aria-hidden="true" />
        <div ref={titleRef} className="winpanel-result__title">{view.title}</div>
        <span className="winpanel-result__glitch" aria-hidden="true" />
        {view.subtitle !== null ? <div ref={subtitleRef} className="winpanel-result__subtitle">{view.subtitle}</div> : null}
        <span className="winpanel-result__white" aria-hidden="true" />
      </div>
      {view.mvp ? <MvpStrip mvp={view.mvp} checker={{ seed: checkerSeed(view.resultId), leaving, still, scale }} /> : null}
    </div>
  );
}

/**
 * CS2 `CSGOHudWinPanel` (hudwinpanel.xml / hudwinpanel.css) on the 1920x1080 overlay canvas. One mount
 * per result: replays of the same result keep the element and never re-run the enter animation; when the
 * panel ends, the last view plays the exit transition before it unmounts.
 */
export function WinPanel({ panel, still = false }: WinPanelProps) {
  const scale = useOverlayScale();
  const [previous, setPrevious] = useState<WinPanelView | null>(panel);
  const [exiting, setExiting] = useState<WinPanelView | null>(null);
  // Derived during render, so the frame the panel ends in already draws the exit (no blank frame).
  if (panel !== previous) {
    setPrevious(panel);
    if (panel === null) setExiting(still ? null : previous);
    else if (exiting !== null) setExiting(null);
  }
  useEffect(() => {
    if (exiting === null) return undefined;
    const timer = window.setTimeout(() => setExiting(null), WIN_PANEL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [exiting]);

  const view = panel ?? exiting;
  return (
    <section className="winpanel-overlay" aria-label="回合结算">
      <div className="winpanel-canvas" style={{ "--winpanel-scale": scale } as CSSProperties}>
        {view ? <WinPanelCard key={view.resultId} view={view} leaving={panel === null} still={still} scale={scale} /> : null}
      </div>
    </section>
  );
}
