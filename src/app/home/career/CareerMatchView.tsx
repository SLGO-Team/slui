import type { CareerMatchDetail } from "../../../contracts/index.ts";
import type { CareerSource } from "../../../platform/career.ts";
import {
  formatDateTime, formatDecimal, formatDuration, formatPercent, matchEndLabel, modeLabel, playerName, ROLE_LABELS,
  roundCells, scoreboardTeams, statusLabel, type ScoreboardTeam,
} from "./careerModel";
import { CareerFailureNotice, CareerHeader, CareerNotice, SwingValue } from "./CareerParts";
import { useCareerMatch } from "./useCareer";

const TEAM_NAMES = { "team-a": "A 队", "team-b": "B 队" } as const;

export function CareerMatchView({ source, matchId, viewerId, onBack, onOpenPlayer }: {
  source: CareerSource;
  matchId: string;
  /** The account whose row is highlighted. */
  viewerId: string | null;
  onBack(): void;
  onOpenPlayer(playerId: string): void;
}) {
  const { match, reload } = useCareerMatch(source, matchId);
  const detail = match.kind === "ready" ? match.value : null;
  const subtitle = detail
    ? [modeLabel(detail.mode), formatDateTime(detail.started_at), formatDuration(detail.duration_ms),
      detail.status === "finished" ? matchEndLabel(detail.end_reason) : statusLabel(detail.status)].join(" · ")
    : "单场计分板";
  return <div className="career-view">
    <CareerHeader title="比赛详情" subtitle={subtitle}>
      <button type="button" className="home-button home-button--small" onClick={onBack}>返回</button>
    </CareerHeader>
    <div className="home-main__scroll">
      <div className="home-page home-page--below-header">
        {match.kind === "loading" ? <CareerNotice title="正在读取比赛…" />
          : match.kind === "failed" ? (match.failure === "not-found"
            ? <CareerNotice title="这场比赛没有详情" detail="只有数据完整的比赛有计分板；中止或中断的比赛可能没有。" />
            : <CareerFailureNotice failure={match.failure} self onRetry={reload} />)
          : <MatchScoreboard detail={match.value} viewerId={viewerId} onOpenPlayer={onOpenPlayer} />}
      </div>
    </div>
  </div>;
}

function MatchScoreboard({ detail, viewerId, onOpenPlayer }: { detail: CareerMatchDetail; viewerId: string | null; onOpenPlayer(playerId: string): void }) {
  const teams = scoreboardTeams(detail);
  const rounds = roundCells(detail);
  return <>
    <section className="career-score" aria-label="比分">
      {teams.map((team, index) => <div key={team.side} className="career-score__team" data-side={index === 0 ? "left" : "right"}
        data-role={team.firstTeam ?? undefined} data-won={team.won}>
        <span className="career-score__name">{TEAM_NAMES[team.side]}</span>
        <span className="career-score__start">{team.firstTeam ? `开局 ${ROLE_LABELS[team.firstTeam]}` : ""}</span>
        <span className="career-score__value">{team.score ?? "—"}</span>
      </div>)}
      <span className="career-score__divider">:</span>
    </section>
    {rounds.length > 0 ? <ol className="career-rounds" aria-label="回合">
      {rounds.map((round) => <li key={round.key} className="career-rounds__cell" data-winner={round.winner ?? undefined}
        title={`第 ${round.label} 回合：${round.winner ? `${ROLE_LABELS[round.winner]} 胜，` : ""}${round.reason}`}>{round.label}</li>)}
    </ol> : null}
    {teams.map((team) => <TeamTable key={team.side} team={team} viewerId={viewerId} onOpenPlayer={onOpenPlayer} />)}
  </>;
}

function TeamTable({ team, viewerId, onOpenPlayer }: { team: ScoreboardTeam; viewerId: string | null; onOpenPlayer(playerId: string): void }) {
  return <section className="home-panel career-panel career-team" data-role={team.firstTeam ?? undefined} aria-label={TEAM_NAMES[team.side]}>
    <div className="career-table-scroll"><table className="career-table career-table--scoreboard">
      <thead><tr>
        <th className="career-team__title">{TEAM_NAMES[team.side]}{team.won ? <span className="career-tag career-tag--win">胜</span> : null}</th>
        <th>K</th><th>D</th><th>A</th><th>ADR</th><th>KAST</th><th>首杀</th><th>MVP</th>
        <th title="每回合 Round Swing：本人为本方回合胜率带来的平均变化">Swing</th>
      </tr></thead>
      <tbody>
        {team.players.map((player) => {
          const name = playerName(player);
          return <tr key={player.ref} data-self={viewerId !== null && player.player_id === viewerId}>
            <td className="career-table__name">
              {player.player_id ? <button type="button" className="career-player" title="查看生涯" onClick={() => onOpenPlayer(player.player_id!)}>{name}</button>
                : <span className="career-player career-player--anonymous">{name}</span>}
              {player.joined_late ? <span className="career-tag">中途加入</span> : null}
              {player.left_early ? <span className="career-tag">提前离开</span> : null}
            </td>
            <td className="career-table__num">{player.kills}</td>
            <td className="career-table__num">{player.deaths}</td>
            <td className="career-table__num">{player.assists}</td>
            <td className="career-table__num">{formatDecimal(player.adr, 1)}</td>
            <td className="career-table__num">{formatPercent(player.kast)}</td>
            <td className="career-table__num">{player.opening_kills}</td>
            <td className="career-table__num">{player.mvps}</td>
            <td className="career-table__num"><SwingValue value={player.swing_per_round} /></td>
          </tr>;
        })}
      </tbody>
    </table></div>
  </section>;
}
