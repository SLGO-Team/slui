import type { Detect } from "../model.ts";
import { Hero } from "./Hero.tsx";

// Screens of the unattended update (started by SLUI's updater). Each one can reopen the
// installed SLUI, so the player is never left without it.

function LaunchError({ message }: { message: string | null }) {
  return <div className="setup-notices">
    {message ? <p className="setup-notice" data-tone="error">{message}</p> : null}
  </div>;
}

/** UAC declined: nothing was installed. */
export function Cancelled({ detect, launchError, onRetry, onLaunch }: {
  detect: Detect;
  launchError: string | null;
  onRetry: () => void;
  onLaunch: () => void;
}) {
  return <div className="setup-page">
    <Hero title="更新已取消">
      <span className="setup-chip">版本 <b>{detect.payloadVersion}</b></span>
    </Hero>
    <p className="setup-summary">已取消授权，未安装任何内容。</p>
    <LaunchError message={launchError} />
    <div className="setup-actions">
      <button type="button" className="setup-button setup-button--primary setup-button--wide" autoFocus onClick={onRetry}>重试</button>
      <button type="button" className="setup-button setup-button--ghost" onClick={onLaunch}>打开 SLUI</button>
    </div>
  </div>;
}

/** Nothing older is installed, so there is nothing to update. */
export function Unavailable({ summary, canLaunch, launchError, onLaunch, onClose }: {
  summary: string;
  canLaunch: boolean;
  launchError: string | null;
  onLaunch: () => void;
  onClose: () => void;
}) {
  return <div className="setup-page">
    <Hero tone="error" title="无法更新">
      <p className="setup-summary">{summary}</p>
    </Hero>
    <LaunchError message={launchError} />
    <div className="setup-actions">
      {canLaunch
        ? <button type="button" className="setup-button setup-button--primary setup-button--wide" autoFocus onClick={onLaunch}>
          打开 SLUI
        </button>
        : null}
      <button type="button" autoFocus={!canLaunch} onClick={onClose}
        className={canLaunch ? "setup-button setup-button--ghost" : "setup-button setup-button--primary setup-button--wide"}>
        关闭
      </button>
    </div>
  </div>;
}
