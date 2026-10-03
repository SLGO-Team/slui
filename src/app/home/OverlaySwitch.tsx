import { useEffect, useRef, useState } from "react";
import type { OverlayState } from "../../platform/desktop";

const ARROW = "M -24 -282 H 24 V -142 H 66 L 0 -58 L -66 -142 H -24 Z";

// Hero art: the containment mark from the SLUI icon with the SLGO crosshair ticks.
// It carries the panel visually, so the panel never has to list features.
function HeroMark({ pulse }: { pulse: number }) {
  return <svg className="home-hero__mark" viewBox="-320 -320 640 640" aria-hidden="true">
    <circle className="home-hero__mark-range" r="300" />
    <g className="home-hero__mark-ticks">
      <rect x="262" y="-6" width="58" height="12" /><rect x="-320" y="-6" width="58" height="12" />
      <rect x="-6" y="262" width="12" height="58" />
    </g>
    <g className="home-hero__mark-ring">
      <path d="M 50.2 -224.5 A 230 230 0 0 1 219.5 68.8" />
      <path d="M 169.3 155.7 A 230 230 0 0 1 -169.3 155.7" />
      <path d="M -219.5 68.8 A 230 230 0 0 1 -50.2 -224.5" />
    </g>
    <g className="home-hero__mark-arrows">
      <path d={ARROW} /><path d={ARROW} transform="rotate(120)" /><path d={ARROW} transform="rotate(240)" />
    </g>
    {pulse ? <g key={pulse}><circle className="home-hero__mark-ping" r="40" /><circle className="home-hero__mark-ping" r="40" /></g> : null}
    <circle className="home-hero__mark-core" r="28" />
  </svg>;
}

export function OverlaySwitch({ state, busy, error, onToggle }: {
  state: OverlayState;
  busy: boolean;
  error: string | null;
  onToggle(): void;
}) {
  // The one-shot scan line and ping play only when this button turned the UI on,
  // not for the initial load or a tray toggle; transitions cover those.
  const requested = useRef<boolean | null>(null);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (requested.current !== state.enabled) return;
    requested.current = null;
    if (state.enabled) setPulse((count) => count + 1);
  }, [state.enabled]);
  useEffect(() => {
    if (error) requested.current = null;
  }, [error]);

  const toggle = () => {
    requested.current = !state.enabled;
    onToggle();
  };

  return <section className="home-hero" data-enabled={state.enabled} aria-labelledby="home-hero-title">
    <div className="home-hero__grid" aria-hidden="true" />
    {pulse ? <div key={pulse} className="home-hero__scan" aria-hidden="true" /> : null}
    <HeroMark pulse={pulse} />
    <div className="home-hero__body">
      <p className="home-eyebrow">IN-GAME UI</p>
      <h1 id="home-hero-title" className="home-hero__title">
        UI
        <span className="home-hero__state"><span className="home-dot" aria-hidden="true" />{state.enabled ? "已启用" : "已停用"}</span>
      </h1>
      {error ? <p className="home-error" role="alert">{error}</p> : null}
      <button type="button" className={`home-button home-button--hero${state.enabled ? "" : " home-button--primary"}`}
        disabled={busy} aria-pressed={state.enabled} onClick={toggle}>
        {state.enabled ? "停用 UI" : "启用 UI"}
      </button>
    </div>
  </section>;
}
