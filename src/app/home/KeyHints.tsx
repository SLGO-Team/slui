import { hotkeyLabel, type HotkeySettings } from "../../platform/hotkeys";

export function KeyHints({ hotkeys }: { hotkeys: HotkeySettings }) {
  const hints = [
    { key: hotkeyLabel(hotkeys.shop), action: "打开 / 关闭商店" },
    { key: hotkeyLabel(hotkeys.scoreboard), action: "按住显示计分板" },
    { key: hotkeyLabel(hotkeys.chatGlobal), action: "全体聊天" },
    { key: hotkeyLabel(hotkeys.chatTeam), action: "队伍聊天" },
  ];
  return <section className="home-section" aria-labelledby="home-keys-title">
    <h2 id="home-keys-title" className="home-section__title">游戏内按键<span className="home-eyebrow">IN-GAME KEYS</span></h2>
    <ul className="home-keys">
      {hints.map(({ key, action }) => <li key={action} className="home-keys__item">
        <kbd className="home-keycap home-keycap--static">{key}</kbd>{action}
      </li>)}
    </ul>
  </section>;
}
