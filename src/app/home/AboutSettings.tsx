import type { AboutUpdate, UpdateAction } from "../updateModel";
import { SettingsGroup } from "./controls";

const ACTION_LABEL: Record<UpdateAction, string> = { install: "更新并重启", check: "检查更新" };

export function AboutSettings({ id, update, onAction }: {
  id: string;
  update: AboutUpdate;
  onAction(action: UpdateAction): void;
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
  </SettingsGroup>;
}
