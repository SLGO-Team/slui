import type { ReactNode } from "react";
import sluiIcon from "../../../src/app/home/slui-icon.svg";

export type Tone = "accent" | "ok" | "error";

/** Centered page header: the SLUI mark in a HUD frame, the title and a meta line. */
export function Hero({ tone = "accent", busy = false, title, children }: {
  tone?: Tone;
  busy?: boolean;
  title: ReactNode;
  children?: ReactNode;
}) {
  return <header className="setup-hero" data-tone={tone}>
    <div className="setup-mark" data-busy={busy || undefined}>
      <img className="setup-mark__icon" src={sluiIcon} alt="" draggable={false} />
    </div>
    <h1 className="setup-title">{title}</h1>
    {children ? <div className="setup-meta">{children}</div> : null}
  </header>;
}
