import { useId, useState, type KeyboardEvent } from "react";
import { hotkeyLabel, hotkeyOwner, isBindableFor, type HotkeyAction, type HotkeySettings as Hotkeys } from "../../platform/hotkeys";
import { SettingRow, SettingsGroup } from "./controls";

const ACTION_NAMES: Readonly<Record<HotkeyAction, string>> = {
  shop: "商店",
  scoreboard: "计分板",
  chatGlobal: "全体聊天",
  chatTeam: "队伍聊天",
};

const ROWS: readonly { action: HotkeyAction; label: string; note: string }[] = [
  { action: "shop", label: "打开 / 关闭商店", note: "仅在游戏处于前台且购买时段开放时打开；商店打开时 UI 接管鼠标，关闭后恢复点击穿透。" },
  { action: "scoreboard", label: "计分板（按住）", note: "游戏处于前台时按住显示，松开隐藏；显示时按鼠标右键启用光标，可排序、切换统计页。" },
  { action: "chatGlobal", label: "全体聊天", note: "打开聊天框并发送给所有玩家；Enter 发送，Esc 关闭。" },
  { action: "chatTeam", label: "队伍聊天", note: "打开聊天框并只发送给队友。" },
];

export function HotkeySettings({ id, value, onChange, onReset }: {
  id: string;
  value: Hotkeys;
  onChange(next: Hotkeys): void;
  onReset(): void;
}) {
  const baseId = useId();
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  // Capture on the focused button so F5/F12 and friends can be bound instead of reloading.
  const capture = (action: HotkeyAction) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (capturing !== action || event.repeat) return;
    event.preventDefault();
    if (event.code === "Escape") {
      setCapturing(null);
      return;
    }
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    const name = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (!isBindableFor(action, event.code) || event.ctrlKey || event.altKey || event.metaKey) {
      setRejected(`不能使用 ${name}：请选择字母键${action === "scoreboard" ? "、Caps Lock " : ""}或 F1–F12，且不带修饰键（数字键用于商店选购）。`);
      return;
    }
    const owner = hotkeyOwner(value, event.code, action);
    if (owner) {
      setRejected(`不能使用 ${name}：它已是${ACTION_NAMES[owner]}键。`);
      return;
    }
    setCapturing(null);
    setRejected(null);
    onChange({ ...value, [action]: event.code });
  };

  const keycap = (action: HotkeyAction) => <button id={`${baseId}-${action}`} type="button" className="home-keycap"
    data-capturing={capturing === action}
    onClick={() => { setRejected(null); setCapturing(action); }}
    onBlur={() => setCapturing((current) => current === action ? null : current)} onKeyDown={capture(action)}>
    {capturing === action ? "按下新按键…" : hotkeyLabel(value[action])}
  </button>;

  return <SettingsGroup id={id} title="快捷键" eyebrow="HOTKEYS" onReset={() => { setRejected(null); onReset(); }}>
    {ROWS.map(({ action, label, note }) => <SettingRow key={action} htmlFor={`${baseId}-${action}`} label={label} note={note}>
      {keycap(action)}
    </SettingRow>)}
    {rejected ? <p className="home-error" role="alert">{rejected}</p> : null}
  </SettingsGroup>;
}
