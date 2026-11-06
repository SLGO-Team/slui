import type { ReactNode } from "react";
import type { CareerFailure } from "../../../platform/career.ts";
import { careerFailureText, formatSwing, swingTone } from "./careerModel";

/** Round Swing per round, signed and tinted by direction. */
export function SwingValue({ value, className }: { value: number | null; className?: string }) {
  return <span className={className ? `career-swing ${className}` : "career-swing"} data-tone={swingTone(value)}>{formatSwing(value)}</span>;
}

/** Page header outside the scroll area, like the settings page. */
export function CareerHeader({ title, subtitle, children }: { title: string; subtitle: ReactNode; children?: ReactNode }) {
  return <header className="home-page__header">
    <div className="home-page__header-inner">
      <div className="career-header__text">
        <h1 className="home-page__title">{title}</h1>
        <p className="home-page__subtitle">{subtitle}</p>
      </div>
      {children ? <div className="career-header__actions">{children}</div> : null}
    </div>
  </header>;
}

/** A centred note in place of content: loading, signed out, or a failed request with its retry. */
export function CareerNotice({ title, detail, onRetry }: { title: string; detail?: string; onRetry?(): void }) {
  return <div className="career-notice" role="status">
    <p className="career-notice__title">{title}</p>
    {detail ? <p className="career-notice__detail">{detail}</p> : null}
    {onRetry ? <button type="button" className="home-button home-button--small" onClick={onRetry}>重试</button> : null}
  </div>;
}

export function CareerFailureNotice({ failure, self, onRetry }: { failure: CareerFailure; self: boolean; onRetry(): void }) {
  const text = careerFailureText(failure, self);
  return <CareerNotice title={text.title} detail={text.detail} onRetry={text.retry ? onRetry : undefined} />;
}
