import { useId, useState, type KeyboardEvent } from "react";
import { hotkeyLabel, isBindableHotkey, type HotkeySettings as Hotkeys } from "../../platform/hotkeys";
import { SettingRow, SettingsGroup } from "./controls";

export function HotkeySettings({ id, value, onChange, onReset }: {
  id: string;
  value: Hotkeys;
  onChange(next: Hotkeys): void;
  onReset(): void;
}) {
  const baseId = useId();
  const [capturing, setCapturing] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  // Capture on the focused button so F5/F12 and friends can be bound instead of reloading.
  const capture = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!capturing || event.repeat) return;
    event.preventDefault();
    if (event.code === "Escape") {
      setCapturing(false);
      return;
    }
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    if (!isBindableHotkey(event.code) || event.ctrlKey || event.altKey || event.metaKey) {
      setRejected(event.key.length === 1 ? event.key.toUpperCase() : event.key);
      return;
    }
    setCapturing(false);
    setRejected(null);
    onChange({ ...value, shop: event.code });
  };

  return <SettingsGroup id={id} title="快捷键" eyebrow="HOTKEYS" onReset={() => { setRejected(null); onReset(); }}>
    <SettingRow htmlFor={`${baseId}-shop`} label="打开 / 关闭商店"
      note="仅在游戏处于前台且购买时段开放时打开；商店打开时 UI 接管鼠标，关闭后恢复点击穿透。">
      <button id={`${baseId}-shop`} type="button" className="home-keycap" data-capturing={capturing}
        onClick={() => { setRejected(null); setCapturing(true); }}
        onBlur={() => setCapturing(false)} onKeyDown={capture}>
        {capturing ? "按下新按键…" : hotkeyLabel(value.shop)}
      </button>
    </SettingRow>
    {rejected ? <p className="home-error" role="alert">不能使用 {rejected}：请选择字母键（Y、U 为聊天键）或 F1–F12，且不带修饰键。</p> : null}
  </SettingsGroup>;
}
