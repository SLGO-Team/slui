import type { OverlayState } from "../../platform/desktop";
import { HomeIcon, SettingsIcon } from "./icons";
import type { Tone } from "./status";

export type HomePage = "home" | "settings";

const PAGES: readonly { id: HomePage; label: string; Icon: typeof HomeIcon }[] = [
  { id: "home", label: "首页", Icon: HomeIcon },
  { id: "settings", label: "设置", Icon: SettingsIcon },
];

export function NavRail({ page, onNavigate, overlay, server }: {
  page: HomePage;
  onNavigate(page: HomePage): void;
  overlay: OverlayState;
  server: { label: string; tone: Tone };
}) {
  return <nav className="home-rail" aria-label="主导航">
    <ul className="home-rail__list">
      {PAGES.map(({ id, label, Icon }) => <li key={id}>
        <button type="button" className="home-rail__item" aria-current={page === id ? "page" : undefined}
          onClick={() => onNavigate(id)}>
          <Icon size={18} />{label}
        </button>
      </li>)}
    </ul>
    <dl className="home-rail__summary">
      <div className="home-rail__summary-row">
        <dt>UI</dt>
        <dd data-tone={overlay.enabled ? "active" : "muted"}><span className="home-dot" />{overlay.enabled ? "已启用" : "已停用"}</dd>
      </div>
      <div className="home-rail__summary-row">
        <dt>服务器</dt>
        <dd data-tone={server.tone}><span className="home-dot" />{server.label}</dd>
      </div>
    </dl>
  </nav>;
}
