import { offered, type State, type UninstallDetect, type UninstallOption } from "../model.ts";
import { Hero } from "../../screens/Hero.tsx";
import { Check } from "../../screens/Check.tsx";

export function Confirm({ state, detect, installed, onOption, onStart, onCancel }: {
  state: State;
  detect: UninstallDetect;
  installed: NonNullable<UninstallDetect["installed"]>;
  onOption: (option: UninstallOption, value: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const themePack = offered(detect, "themePack");
  const userData = offered(detect, "userData");
  return <form className="setup-page" onSubmit={(event) => {
    event.preventDefault();
    onStart();
  }}>
    <Hero title="卸载 SLUI"><span className="setup-chip">版本 <b>{installed.version}</b></span></Hero>
    <p className="setup-place">
      安装于 <span className="setup-path" title={installed.dir}>{installed.dir}</span>
    </p>

    {themePack || userData
      ? <section className="setup-options" aria-label="卸载选项">
        <div className="setup-options__checks setup-options__checks--list">
          {themePack
            ? <Check checked={state.themePack} onChange={(value) => onOption("themePack", value)}>
              同时删除主题包<span className="setup-check__hint">theme-pack 中的字体和音效</span>
            </Check>
            : null}
          {userData
            ? <Check checked={state.userData} onChange={(value) => onOption("userData", value)}>
              删除用户设置和数据<span className="setup-check__hint">设置和缓存</span>
            </Check>
            : null}
        </div>
      </section>
      : null}

    <div className="setup-notices">
      {detect.appRunning ? <p className="setup-notice" data-tone="warn">SLUI 正在运行，卸载时会将其关闭。</p> : null}
      {state.notice ? <p className="setup-notice" data-tone="info">{state.notice}</p> : null}
    </div>

    <div className="setup-actions">
      <button type="submit" className="setup-button setup-button--primary setup-button--wide" autoFocus>卸载</button>
      <button type="button" className="setup-button setup-button--ghost" onClick={onCancel}>取消</button>
    </div>
  </form>;
}
