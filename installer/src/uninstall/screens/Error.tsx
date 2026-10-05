import { failureSummary, type UninstallOutcome } from "../model.ts";
import { Hero } from "../../screens/Hero.tsx";

export function Failure({ outcome, onRetry, onClose }: {
  outcome: Extract<UninstallOutcome, { kind: "failed" }>;
  onRetry: () => void;
  onClose: () => void;
}) {
  return <div className="setup-page">
    <Hero tone="error" title="卸载失败">
      <p className="setup-summary">{failureSummary(outcome)}</p>
    </Hero>
    {outcome.code !== null || outcome.detail
      ? <dl className="setup-facts">
        {outcome.code !== null
          ? <div className="setup-facts__row"><dt>退出码</dt><dd className="setup-code">{outcome.code}</dd></div>
          : null}
        {outcome.detail
          ? <div className="setup-facts__row"><dt>详细信息</dt><dd className="setup-path" title={outcome.detail}>{outcome.detail}</dd></div>
          : null}
      </dl>
      : null}
    <div className="setup-actions">
      <button type="button" className="setup-button setup-button--primary setup-button--wide" autoFocus onClick={onRetry}>重试</button>
      <button type="button" className="setup-button setup-button--ghost" onClick={onClose}>关闭</button>
    </div>
  </div>;
}

export function NotInstalled({ onClose }: { onClose: () => void }) {
  return <div className="setup-page">
    <Hero tone="error" title="未找到已安装的 SLUI">
      <p className="setup-summary">SLUI 可能已被卸载，或安装信息已损坏。</p>
    </Hero>
    <div className="setup-actions">
      <button type="button" className="setup-button setup-button--primary setup-button--wide" autoFocus onClick={onClose}>关闭</button>
    </div>
  </div>;
}
