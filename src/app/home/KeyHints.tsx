import { hotkeyLabel } from "../../platform/hotkeys";

// Y/U are fixed chat keys (see isBindableHotkey); only the shop key is configurable.
export function KeyHints({ shopKey }: { shopKey: string }) {
  const hints = [
    { key: hotkeyLabel(shopKey), action: "打开 / 关闭商店" },
    { key: "Y", action: "全体聊天" },
    { key: "U", action: "队伍聊天" },
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
