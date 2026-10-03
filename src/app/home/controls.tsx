import { useId, type ReactNode } from "react";
import { ResetIcon } from "./icons";

export function SettingsGroup({ id, title, eyebrow, onReset, children }: {
  id: string;
  title: string;
  eyebrow: string;
  onReset(): void;
  children: ReactNode;
}) {
  const titleId = useId();
  return <section id={id} className="home-panel" aria-labelledby={titleId}>
    <header className="home-panel__header">
      <h2 id={titleId} className="home-section__title">{title}<span className="home-eyebrow">{eyebrow}</span></h2>
      <button type="button" className="home-button home-button--ghost" onClick={onReset}><ResetIcon />恢复默认</button>
    </header>
    {children}
  </section>;
}

export function SettingRow({ htmlFor, label, note, children }: {
  htmlFor: string;
  label: string;
  note?: string;
  children: ReactNode;
}) {
  return <div className="home-row">
    <label className="home-row__label" htmlFor={htmlFor}>
      {label}
      {note ? <span className="home-row__note">{note}</span> : null}
    </label>
    <div className="home-row__control">{children}</div>
  </div>;
}

export function Switch({ id, checked, onChange }: { id: string; checked: boolean; onChange(checked: boolean): void }) {
  return <button id={id} type="button" role="switch" aria-checked={checked} className="home-switch" onClick={() => onChange(!checked)}>
    <span className="home-switch__thumb" />
  </button>;
}

/** Range input whose filled part is painted from --fill, since WebView2 has no ::-moz-range-progress. */
export function RangeInput({ id, min, max, step, value, onChange }: {
  id: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange(value: number): void;
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return <input id={id} type="range" className="home-range" min={min} max={max} step={step} value={value}
    style={{ "--fill": `${fill}%` } as React.CSSProperties} onChange={(event) => onChange(Number(event.target.value))} />;
}
