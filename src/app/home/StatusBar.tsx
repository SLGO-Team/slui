import type { SessionStatusSnapshot } from "../../platform/desktop";
import type { UpdateState } from "../../platform/updater";
import { homeServerStatus } from "../updateModel";
import { GameIcon, ServerIcon } from "./icons";
import type { Tone } from "./status";
import type { SteamAccount } from "./steamAccount";
import { SteamTile } from "./SteamTile";

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

export function StatusBar({ session, steam, gameRunning, update, onRetry }: {
  session: SessionStatusSnapshot | null;
  steam: SteamAccount;
  gameRunning: boolean | null;
  update: UpdateState | null;
  onRetry(): void;
}) {
  const server = homeServerStatus(session, update);
  return <section className="home-section" aria-labelledby="home-status-title">
    <h2 id="home-status-title" className="home-section__title">连接状态<span className="home-eyebrow">STATUS</span></h2>
    <div className="home-status">
      <SteamTile account={steam} />
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
