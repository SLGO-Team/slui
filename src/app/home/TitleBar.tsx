import type { WindowControls } from "../../platform/desktop";
import type { TitleBarUpdate } from "../updateModel";
import { CloseIcon, MinimizeIcon, UpdateIcon } from "./icons";
import sluiIcon from "./slui-icon.svg";

// Tauri drags only from the element that carries data-tauri-drag-region itself,
// so every non-interactive child is marked as well.
export function TitleBar({ controls, update, onUpdate }: {
  controls: WindowControls;
  /** Shown only while an update is ready (or starting). */
  update: TitleBarUpdate | null;
  onUpdate(): void;
}) {
  return <header className="home-titlebar" data-tauri-drag-region>
    <div className="home-brand" data-tauri-drag-region>
      <img className="home-brand__icon" src={sluiIcon} alt="" draggable={false} data-tauri-drag-region />
      <span className="home-brand__name" data-tauri-drag-region>SLUI</span>
      <span className="home-brand__by" data-tauri-drag-region>by SLGO</span>
    </div>
    <div className="home-titlebar__actions">
      {update ? <button type="button" className="home-button home-button--small home-button--primary home-titlebar__update"
        disabled={update.busy} title="SLUI 将关闭，安装完成后自动重新打开" onClick={onUpdate}>
        <UpdateIcon size={14} />{update.label}
      </button> : null}
      <button type="button" className="home-titlebar__button" aria-label="最小化" title="最小化" onClick={controls.minimize}>
        <MinimizeIcon />
      </button>
      <button type="button" className="home-titlebar__button home-titlebar__button--close" aria-label="关闭到托盘" title="关闭到托盘"
        onClick={controls.close}>
        <CloseIcon />
      </button>
    </div>
  </header>;
}
