import { failureSummary, type InstallMode, type InstallOutcome } from "../model.ts";
import { Hero } from "./Hero.tsx";

export function Failure({ outcome, mode, onRetry, onClose }: {
  outcome: Extract<InstallOutcome, { kind: "failed" }>;
  mode: InstallMode;
  onRetry: () => void;
  onClose: () => void;
}) {
  return <div className="setup-page">
    <Hero tone="error" title={mode === "update" ? "更新失败" : "安装失败"}>
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

export function LoadFailure({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="setup-page">
    <Hero tone="error" title="无法读取安装状态">
      <p className="setup-summary">{message}</p>
    </Hero>
    <div className="setup-actions">
      <button type="button" className="setup-button setup-button--primary setup-button--wide" autoFocus onClick={onClose}>关闭</button>
    </div>
  </div>;
}
