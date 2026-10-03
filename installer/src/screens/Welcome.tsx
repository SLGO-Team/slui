import { optionsGate, type Detect, type InstallMode, type Kind, type Shortcut, type State } from "../model.ts";
import { Hero } from "./Hero.tsx";
import { Options } from "./Options.tsx";

const TITLE: Record<Kind, string> = {
  fresh: "安装 SLUI",
  update: "更新 SLUI",
  same: "SLUI 已安装",
  newerInstalled: "已安装更新的版本",
};

export function Welcome({ state, detect, kind, options, launchError, onStart, onLaunch, onReinstall, onCloseReinstall,
  onDirChange, onBrowse, onShortcutChange }: {
  state: State;
  detect: Detect;
  kind: Kind;
  /** Install location and shortcuts are shown and editable. */
  options: boolean;
  launchError: string | null;
  onStart: (mode: InstallMode) => void;
  onLaunch: () => void;
  onReinstall: () => void;
  onCloseReinstall: () => void;
  onDirChange: (dir: string) => void;
  onBrowse: () => void;
  onShortcutChange: (shortcut: Shortcut, value: boolean) => void;
}) {
  const installMode: InstallMode = kind === "fresh" ? "fresh" : "reinstall";
  const gate = optionsGate(state);
  const installedDir = detect.installed?.dir;
  const willInstall = options || kind === "update";
  return <form className="setup-page" onSubmit={(event) => {
    event.preventDefault();
    if (options && gate.ok) onStart(installMode);
  }}>
    <Hero title={TITLE[kind]}><Versions detect={detect} kind={kind} /></Hero>

    {options
      ? <Options state={state} detect={detect} onDirChange={onDirChange} onBrowse={onBrowse}
        onShortcutChange={onShortcutChange} />
      : installedDir
        ? <p className="setup-place">
          安装于 <span className="setup-path" title={installedDir}>{installedDir}</span>
          {kind === "update" ? " · 保留现有快捷方式" : null}
        </p>
        : null}

    <div className="setup-notices">
      {kind === "newerInstalled"
        ? <p className="setup-notice" data-tone="warn">此安装包的版本低于已安装的 SLUI，无法降级安装。</p>
        : null}
      {willInstall && detect.appRunning
        ? <p className="setup-notice" data-tone="warn">SLUI 正在运行，安装时会将其关闭。</p>
        : null}
      {state.notice ? <p className="setup-notice" data-tone="info">{state.notice}</p> : null}
      {launchError ? <p className="setup-notice" data-tone="error">{launchError}</p> : null}
    </div>

    <div className="setup-actions">
      {options ? <>
        <button type="submit" className="setup-button setup-button--primary setup-button--wide" autoFocus
          disabled={!gate.ok}>{kind === "fresh" ? "安装" : "重新安装"}</button>
        {kind === "same"
          ? <button type="button" className="setup-button setup-button--ghost" onClick={onCloseReinstall}>取消</button>
          : null}
      </> : null}
      {kind === "update"
        ? <button type="button" className="setup-button setup-button--primary setup-button--wide" autoFocus
          onClick={() => onStart("update")}>更新</button>
        : null}
      {!options && (kind === "same" || kind === "newerInstalled")
        ? <button type="button" className="setup-button setup-button--primary setup-button--wide" autoFocus
          onClick={onLaunch}>启动</button>
        : null}
      {!options && kind === "same"
        ? <button type="button" className="setup-button setup-button--ghost" onClick={onReinstall}>重新安装…</button>
        : null}
    </div>
  </form>;
}

function Versions({ detect, kind }: { detect: Detect; kind: Kind }) {
  const installed = detect.installed;
  switch (kind) {
    case "fresh":
      return <span className="setup-chip">版本 <b>{detect.payloadVersion}</b></span>;
    case "update":
      return <>
        <span className="setup-chip">已安装 <b>{installed?.version}</b></span>
        <span className="setup-arrow" aria-label="更新到">→</span>
        <span className="setup-chip setup-chip--accent">新版本 <b>{detect.payloadVersion}</b></span>
      </>;
    case "same":
      return <span className="setup-chip">版本 <b>{detect.payloadVersion}</b> · 与安装包相同</span>;
    case "newerInstalled":
      return <>
        <span className="setup-chip">已安装 <b>{installed?.version}</b></span>
        <span className="setup-chip">安装包 <b>{detect.payloadVersion}</b></span>
      </>;
  }
}
