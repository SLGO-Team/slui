import { CloseIcon, MinimizeIcon } from "../../../src/app/home/icons.tsx";

/** Minimize and close, floating in the top-right corner; the window has no title bar. */
export function WindowControls({ closeDisabled, onMinimize, onClose }: {
  closeDisabled: boolean;
  onMinimize: () => void;
  onClose: () => void;
}) {
  return <div className="setup-controls">
    <button type="button" className="setup-controls__button" aria-label="最小化" title="最小化" onClick={onMinimize}>
      <MinimizeIcon />
    </button>
    <button type="button" className="setup-controls__button setup-controls__button--close" aria-label="关闭"
      title={closeDisabled ? "安装进行中，无法关闭" : "关闭"} disabled={closeDisabled} onClick={onClose}>
      <CloseIcon />
    </button>
  </div>;
}
