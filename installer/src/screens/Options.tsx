import type { ReactNode } from "react";
import { formatBytes, optionsGate, type Detect, type Shortcut, type State } from "../model.ts";

/** Install location and shortcuts, edited in place on the welcome screen. */
export function Options({ state, detect, onDirChange, onBrowse, onShortcutChange }: {
  state: State;
  detect: Detect;
  onDirChange: (dir: string) => void;
  onBrowse: () => void;
  onShortcutChange: (shortcut: Shortcut, value: boolean) => void;
}) {
  const gate = optionsGate(state);
  const check = state.check?.input === state.dir ? state.check.result : null;
  const free = check && !check.error ? check.freeBytes : null;
  const invalid = !gate.ok && gate.reason !== null;
  return <section className="setup-options" aria-label="安装选项">
    <div className="setup-options__head">
      <label className="setup-options__label" htmlFor="setup-dir">安装位置</label>
      <p className="setup-options__status" data-tone={invalid ? "error" : undefined} aria-live="polite">
        {invalid
          ? gate.reason
          : `需要 ${formatBytes(detect.requiredBytes)} · 可用 ${free === null ? "—" : formatBytes(free)}`}
      </p>
    </div>
    <div className="setup-field">
      <input id="setup-dir" className="setup-input" value={state.dir} spellCheck={false} autoComplete="off"
        aria-invalid={invalid} onChange={(event) => onDirChange(event.target.value)} />
      <button type="button" className="setup-button" onClick={onBrowse}>浏览…</button>
    </div>
    <div className="setup-options__checks">
      <Check checked={state.startMenuShortcut} onChange={(value) => onShortcutChange("startMenu", value)}>
        创建开始菜单快捷方式
      </Check>
      <Check checked={state.desktopShortcut} onChange={(value) => onShortcutChange("desktop", value)}>
        创建桌面快捷方式
      </Check>
    </div>
  </section>;
}

function Check({ checked, onChange, children }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return <label className="setup-check">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="setup-check__box" aria-hidden="true" />
    {children}
  </label>;
}
