import type { UninstallOutcome } from "../model.ts";
import { Hero } from "../../screens/Hero.tsx";

export function Done({ version, outcome, onClose }: {
  version: string;
  outcome: Extract<UninstallOutcome, { kind: "ok" }>;
  onClose: () => void;
}) {
  const themePack = `${outcome.dir}\\theme-pack`;
  return <div className="setup-page">
    <Hero tone="ok" title="卸载完成">
      <span className="setup-chip">SLUI <b>{version}</b> 已从此电脑移除</span>
    </Hero>
    {outcome.themePackKept
      ? <p className="setup-place">主题包保留在 <span className="setup-path" title={themePack}>{themePack}</span></p>
      : null}
    <div className="setup-notices">
      {outcome.userDataError
        ? <p className="setup-notice" data-tone="error" title={outcome.userDataError}>
          部分用户数据未能删除：{outcome.userDataError}
        </p>
        : null}
    </div>
    <div className="setup-actions">
      <button type="button" className="setup-button setup-button--primary setup-button--wide" autoFocus onClick={onClose}>
        关闭
      </button>
    </div>
  </div>;
}
