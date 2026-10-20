import { failureSummary, type InstallMode, type InstallOutcome } from "../model.ts";
import { Hero } from "./Hero.tsx";

/** `onLaunch` (unattended update) replaces 「关闭」 with 「打开 SLUI」, which reopens the installed version. */
export function Failure({ outcome, mode, launchError, onRetry, onClose, onLaunch }: {
  outcome: Extract<InstallOutcome, { kind: "failed" }>;
  mode: InstallMode;
  launchError?: string | null;
  onRetry: () => void;
  onClose: () => void;
  onLaunch?: () => void;
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
    {launchError ? <div className="setup-notices"><p className="setup-notice" data-tone="error">{launchError}</p></div> : null}
    <div className="setup-actions">
      <button type="button" className="setup-button setup-button--primary setup-button--wide" autoFocus onClick={onRetry}>重试</button>
      {onLaunch
        ? <button type="button" className="setup-button setup-button--ghost" onClick={onLaunch}>打开 SLUI</button>
        : <button type="button" className="setup-button setup-button--ghost" onClick={onClose}>关闭</button>}
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
