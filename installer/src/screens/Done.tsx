import type { Detect, InstallMode } from "../model.ts";
import { Hero } from "./Hero.tsx";

export function Done({ detect, mode, dir, launchError, onLaunch, onClose }: {
  detect: Detect;
  mode: InstallMode;
  dir: string;
  launchError: string | null;
  onLaunch: () => void;
  onClose: () => void;
}) {
  return <div className="setup-page">
    <Hero tone="ok" title={mode === "update" ? "更新完成" : "安装完成"}>
      <span className="setup-chip">SLUI <b>{detect.payloadVersion}</b></span>
    </Hero>
    <p className="setup-place">安装于 <span className="setup-path" title={dir}>{dir}</span></p>
    <div className="setup-notices">
      {launchError ? <p className="setup-notice" data-tone="error">{launchError}</p> : null}
    </div>
    <div className="setup-actions">
      <button type="button" className="setup-button setup-button--primary setup-button--wide" autoFocus onClick={onLaunch}>
        启动 SLUI
      </button>
      <button type="button" className="setup-button setup-button--ghost" onClick={onClose}>关闭</button>
    </div>
  </div>;
}
