import type { WindowControls } from "../../platform/desktop";
import { CloseIcon, MinimizeIcon } from "./icons";
import sluiIcon from "./slui-icon.svg";

// Tauri drags only from the element that carries data-tauri-drag-region itself,
// so every non-interactive child is marked as well.
export function TitleBar({ controls }: { controls: WindowControls }) {
  return <header className="home-titlebar" data-tauri-drag-region>
    <div className="home-brand" data-tauri-drag-region>
      <img className="home-brand__icon" src={sluiIcon} alt="" draggable={false} data-tauri-drag-region />
      <span className="home-brand__name" data-tauri-drag-region>SLUI</span>
      <span className="home-brand__by" data-tauri-drag-region>by SLGO</span>
    </div>
    <div className="home-titlebar__actions">
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
