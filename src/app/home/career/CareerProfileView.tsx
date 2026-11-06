import { useState } from "react";
import { CAREER_MODE_ALL, type CareerMatchSummary, type CareerProfile } from "../../../contracts/index.ts";
import type { CareerSource } from "../../../platform/career.ts";
import {
  CAREER_BUCKETS, careerFailureText, detailStats, formatDate, formatDateTime, formatDecimal, formatShortDateTime, formatPercent, formatShare,
  headlineStats, matchScore, modeLabel, RESULT_LABELS, ROLE_LABELS, scpRoleLabel, statusLabel, type CareerBucket,
} from "./careerModel";
import { CareerFailureNotice, CareerHeader, CareerNotice, SwingValue } from "./CareerParts";
import { useCareer, type MatchPage } from "./useCareer";

export function CareerProfileView({ source, playerId, self, hidden, onOpenMatch, onBackToSelf }: {
  source: CareerSource;
  playerId: string;
  /** The page shows the viewer's own career. */
  self: boolean;
  /** Kept mounted (with its pages of matches) while a match is open. */
  hidden: boolean;
  onOpenMatch(matchId: string): void;
  /** Present while another player's career is shown. */
  onBackToSelf?(): void;
}) {
  const [mode, setMode] = useState(CAREER_MODE_ALL);
  const [bucket, setBucket] = useState<CareerBucket>("overall");
  const { profile, matches, loadMore, reload } = useCareer(source, playerId, mode);
  // The mode list comes with the profile; keep the last one while another mode loads.
  const [modes, setModes] = useState<readonly string[]>([]);
  const loadedModes = profile.kind === "ready" ? profile.value.modes : null;
  if (loadedModes && loadedModes.join() !== modes.join()) setModes(loadedModes);
  const modeOptions = [CAREER_MODE_ALL, ...modes.filter((value) => value !== CAREER_MODE_ALL), ...(modes.includes(mode) || mode === CAREER_MODE_ALL ? [] : [mode])];

  const name = profile.kind === "ready" ? profile.value.nickname ?? playerId : playerId;
  const subtitle = profile.kind === "ready" && profile.value.nickname ? `${profile.value.nickname} · ${playerId}` : playerId;
  return <div className="career-view" hidden={hidden}>
    <CareerHeader title={self ? "我的生涯" : `${name} 的生涯`} subtitle={subtitle}>
      {onBackToSelf ? <button type="button" className="home-button home-button--small" onClick={onBackToSelf}>回到我的生涯</button> : null}
      <select className="home-select" aria-label="模式" value={mode} onChange={(event) => setMode(event.target.value)}>
        {modeOptions.map((value) => <option key={value} value={value}>{modeLabel(value)}</option>)}
      </select>
    </CareerHeader>
    <div className="home-main__scroll">
      <div className="home-page home-page--below-header">
        {profile.kind === "loading" ? <CareerNotice title="正在读取生涯…" />
          : profile.kind === "failed" ? <CareerFailureNotice failure={profile.failure} self={self} onRetry={reload} />
          : <>
            <CareerOverview profile={profile.value} bucket={bucket} onBucket={setBucket} />
            <CareerFavorites profile={profile.value} />
            <CareerRecentMatches matches={matches} self={self} onOpenMatch={onOpenMatch} onLoadMore={loadMore} onRetry={reload} />
          </>}
      </div>
    </div>
  </div>;
}

function CareerOverview({ profile, bucket, onBucket }: { profile: CareerProfile; bucket: CareerBucket; onBucket(bucket: CareerBucket): void }) {
  const stats = profile[bucket];
  const notes = [
    `首场 ${formatDate(profile.first_match_at)}`,
    `最近 ${formatDate(profile.last_match_at)}`,
    profile.unfinished > 0 ? `${profile.unfinished} 场未完成不计入` : null,
    profile.left_early > 0 ? `提前离开 ${profile.left_early} 场` : null,
  ].filter((note) => note !== null);
  return <section className="home-panel career-panel" aria-label="生涯概览">
    <header className="home-panel__header">
      <h2 className="home-section__title">概览<span className="home-eyebrow">Overview</span></h2>
      <div className="career-tabs" role="group" aria-label="阵营">
        {CAREER_BUCKETS.map(({ id, label }) => <button key={id} type="button" className="career-tabs__item" aria-pressed={bucket === id}
          onClick={() => onBucket(id)}>{label}</button>)}
      </div>
    </header>
    {stats.matches === 0 && stats.rounds_played === 0
      ? <CareerNotice title="这个模式下还没有计入生涯的比赛" />
      : <>
        <div className="career-headline">
          {headlineStats(stats).map((stat) => <div key={stat.key} className="career-stat" data-key={stat.key}>
            <span className="career-stat__label">{stat.label}</span>
            <span className="career-stat__value" data-tone={stat.tone}>{stat.value}</span>
            {stat.detail ? <span className="career-stat__detail">{stat.detail}</span> : null}
          </div>)}
        </div>
        <dl className="career-details">
          {detailStats(stats).map((stat) => <div key={stat.key} className="career-details__item">
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>)}
        </dl>
      </>}
    <p className="career-panel__note">{notes.join(" · ")}。Swing：击杀、死亡、助攻、发电机等事件为本方回合胜率带来的变化，事件前的人数优势不计入任何人。</p>
  </section>;
}

function CareerFavorites({ profile }: { profile: CareerProfile }) {
  if (profile.scp_roles.length === 0 && profile.weapons.length === 0) return null;
  return <div className="career-columns">
    <section className="home-panel career-panel" aria-label="常用 SCP">
      <header className="home-panel__header"><h2 className="home-section__title">常用 SCP<span className="home-eyebrow">Roles</span></h2></header>
      {profile.scp_roles.length === 0 ? <CareerNotice title="还没有 SCP 回合" /> : <table className="career-table">
        <thead><tr><th>角色</th><th>回合</th><th>胜率</th><th>K / D</th><th>ADR</th></tr></thead>
        <tbody>
          {profile.scp_roles.slice(0, 6).map((role) => <tr key={role.role}>
            <td className="career-table__name">{scpRoleLabel(role.role)}</td>
            <td>{role.rounds}</td>
            <td>{formatShare(role.rounds_won, role.rounds)}</td>
            <td>{role.kills} / {role.deaths}</td>
            <td>{formatDecimal(role.adr, 1)}</td>
          </tr>)}
        </tbody>
      </table>}
    </section>
    <section className="home-panel career-panel" aria-label="武器">
      <header className="home-panel__header"><h2 className="home-section__title">击杀来源<span className="home-eyebrow">Weapons</span></h2></header>
      {profile.weapons.length === 0 ? <CareerNotice title="还没有击杀" /> : <table className="career-table">
        <thead><tr><th>武器</th><th>击杀</th><th>爆头</th></tr></thead>
        <tbody>
          {profile.weapons.slice(0, 6).map((weapon) => <tr key={weapon.weapon}>
            <td className="career-table__name">{scpRoleLabel(weapon.weapon)}</td>
            <td>{weapon.kills}</td>
            <td>{formatShare(weapon.headshot_kills, weapon.kills)}</td>
          </tr>)}
        </tbody>
      </table>}
    </section>
  </div>;
}

function CareerRecentMatches({ matches, self, onOpenMatch, onLoadMore, onRetry }: {
  matches: ReturnType<typeof useCareer>["matches"];
  self: boolean;
  onOpenMatch(matchId: string): void;
  onLoadMore(): void;
  onRetry(): void;
}) {
  return <section className="home-panel career-panel" aria-label="近期比赛">
    <header className="home-panel__header"><h2 className="home-section__title">近期比赛<span className="home-eyebrow">Matches</span></h2></header>
    {matches.kind === "loading" ? <CareerNotice title="正在读取比赛…" />
      : matches.kind === "failed" ? <CareerFailureNotice failure={matches.failure} self={self} onRetry={onRetry} />
      : matches.value.items.length === 0 ? <CareerNotice title="这个模式下还没有比赛" />
      : <MatchTable page={matches.value} onOpenMatch={onOpenMatch} onLoadMore={onLoadMore} />}
  </section>;
}

function MatchTable({ page, onOpenMatch, onLoadMore }: { page: MatchPage; onOpenMatch(matchId: string): void; onLoadMore(): void }) {
  const more = page.more;
  return <>
    <div className="career-table-scroll">
      <table className="career-table career-table--matches">
        <thead><tr>
          <th>时间</th><th>模式 · 开局</th><th>结果</th><th>比分</th><th>K / D / A</th><th>ADR</th><th>KAST</th>
          <th title="每回合 Round Swing：本人为本方回合胜率带来的平均变化">Swing</th>
        </tr></thead>
        <tbody>
          {page.items.map((match) => <MatchRow key={match.match_id} match={match} onOpen={() => onOpenMatch(match.match_id)} />)}
        </tbody>
      </table>
    </div>
    {page.nextCursor ? <div className="career-more">
      {more !== "idle" && more !== "loading" ? <span className="career-more__error">{careerFailureText(more, true).title}</span> : null}
      <button type="button" className="home-button home-button--small" disabled={more === "loading"} onClick={onLoadMore}>
        {more === "loading" ? "正在读取…" : more === "idle" ? "加载更多" : "重试"}
      </button>
    </div> : null}
  </>;
}

function MatchRow({ match, onOpen }: { match: CareerMatchSummary; onOpen(): void }) {
  const note = match.status !== "finished" ? statusLabel(match.status) : match.left_early ? "提前离开" : !match.counts_for_career ? "不计入" : null;
  return <tr className="career-table__link" tabIndex={0} onClick={onOpen}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}>
    <td className="career-table__time" title={formatDateTime(match.started_at)}>{formatShortDateTime(match.started_at)}</td>
    <td>{modeLabel(match.mode)}<span className="career-role" data-role={match.first_team}>{ROLE_LABELS[match.first_team]}</span></td>
    <td><span className="career-result" data-result={match.result}>{RESULT_LABELS[match.result]}</span>
      {note ? <span className="career-tag">{note}</span> : null}</td>
    <td className="career-table__num">{matchScore(match)}</td>
    <td className="career-table__num">{match.kills} / {match.deaths} / {match.assists}</td>
    <td className="career-table__num">{formatDecimal(match.adr, 1)}</td>
    <td className="career-table__num">{formatPercent(match.kast)}</td>
    <td className="career-table__num"><SwingValue value={match.swing_per_round} /></td>
  </tr>;
}
