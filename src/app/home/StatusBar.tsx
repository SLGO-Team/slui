import type { SessionStatusSnapshot } from "../../platform/desktop";
import { AccountIcon, GameIcon, ServerIcon } from "./icons";
import { serverStatus, type Tone } from "./status";

function StatusTile({ icon, name, value, tone, children }: {
  icon: React.ReactNode;
  name: string;
  value: string;
  tone: Tone;
  children?: React.ReactNode;
}) {
  return <div className="home-tile" data-tone={tone}>
    <div className="home-tile__head">
      <span className="home-tile__icon">{icon}</span>
      <span className="home-tile__name">{name}</span>
      <span className="home-dot" aria-hidden="true" />
    </div>
    <span className="home-tile__value" title={value}>{value}</span>
    {children}
  </div>;
}

export function StatusBar({ session, gameRunning, onRetry }: {
  session: SessionStatusSnapshot | null;
  gameRunning: boolean | null;
  onRetry(): void;
}) {
  const server = serverStatus(session);
  return <section className="home-section" aria-labelledby="home-status-title">
    <h2 id="home-status-title" className="home-section__title">连接状态<span className="home-eyebrow">STATUS</span></h2>
    <div className="home-status">
      <StatusTile icon={<AccountIcon />} name="Steam" tone={!session ? "muted" : session.steamId ? "ok" : "muted"}
        value={!session ? "正在获取…" : session.steamId ? session.steamId : "未检测到 Steam 登录"} />
      <StatusTile icon={<GameIcon />} name="游戏" tone={gameRunning ? "ok" : "muted"}
        value={gameRunning === null ? "正在检测…" : gameRunning ? "运行中" : "未运行"} />
      <StatusTile icon={<ServerIcon />} name="服务器" tone={server.tone} value={server.label}>
        {server.hint ? <span className="home-tile__detail">{server.hint}</span>
          : session?.detail && server.retry ? <span className="home-tile__detail" title={session.detail}>{session.detail}</span> : null}
        {server.retry ? <button type="button" className="home-button home-button--small" onClick={onRetry}>重试</button> : null}
      </StatusTile>
    </div>
  </section>;
}
