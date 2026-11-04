import type { AboutUpdate, UpdateAction } from "../updateModel";
import { SettingsGroup } from "./controls";

const ACTION_LABEL: Record<UpdateAction, string> = { install: "更新并重启", check: "检查更新" };

export function AboutSettings({ id, update, linkError, onAction, onRevealLog, onOpenProject }: {
  id: string;
  update: AboutUpdate;
  /** Why the last log or project link failed; cleared on the next click. */
  linkError: string | null;
  onAction(action: UpdateAction): void;
  onRevealLog(): void;
  onOpenProject(): void;
}) {
  return <SettingsGroup id={id} title="关于" eyebrow="ABOUT">
    <div className="home-row">
      <div className="home-row__label">
        <span>SLUI {update.version}</span>
        <span className="home-row__note home-about__status" data-tone={update.tone}>{update.status}</span>
      </div>
      <div className="home-row__control">
        <button type="button" disabled={update.busy} onClick={() => onAction(update.action)}
          className={update.action === "install" ? "home-button home-button--small home-button--primary" : "home-button home-button--small"}>
          {ACTION_LABEL[update.action]}
        </button>
      </div>
    </div>
    <div className="home-row">
      <div className="home-row__label">
        <span>诊断日志</span>
        <span className="home-row__note">反馈问题时请附上 slui.log。日志只记录 SLUI 自身的状态和快捷键，不记录输入的文字或其他按键。</span>
      </div>
      <div className="home-row__control">
        <button type="button" className="home-button home-button--small" onClick={onRevealLog}>打开日志文件夹</button>
      </div>
    </div>
    <div className="home-row">
      <div className="home-row__label">
        <span>源代码</span>
        <span className="home-row__note">SLUI 是以 GPL-3.0-or-later 许可发布的开源软件。</span>
      </div>
      <div className="home-row__control">
        <button type="button" className="home-button home-button--small" onClick={onOpenProject}>项目主页</button>
      </div>
    </div>
    {linkError ? <p className="home-error" role="alert">{linkError}</p> : null}
  </SettingsGroup>;
}
