import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { WinPanelMvpView, WinPanelView } from "./model";
import { useOverlayScale } from "../../shared/overlay.ts";
import "./WinPanel.css";

/** CS2 `.WinPanelRoot` fades out over 0.3 s; the last view stays mounted that long. */
export const WIN_PANEL_EXIT_MS = 300;

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

function MvpStrip({ mvp }: { mvp: WinPanelMvpView }) {
  const kitRef = useShrinkToFit<HTMLSpanElement>(mvp.musicKit ?? "");
  return (
    <div className="winpanel-mvp" data-winpanel="mvp">
      <span className="winpanel-mvp__checker winpanel-mvp__checker--a" aria-hidden="true" />
      <span className="winpanel-mvp__checker winpanel-mvp__checker--b" aria-hidden="true" />
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

function WinPanelCard({ view, leaving, still }: { view: WinPanelView; leaving: boolean; still: boolean }) {
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
        {view.subtitle !== null ? <div ref={subtitleRef} className="winpanel-result__subtitle">{view.subtitle}</div> : null}
      </div>
      {view.mvp ? <MvpStrip mvp={view.mvp} /> : null}
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
        {view ? <WinPanelCard key={view.resultId} view={view} leaving={panel === null} still={still} /> : null}
      </div>
    </section>
  );
}
