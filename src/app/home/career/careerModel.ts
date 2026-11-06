// Pure view helpers for the home window's career page: number formats, labels and the match scoreboard
// grouping. Nothing here fetches; see src/platform/career.ts for the API.
import type {
  CareerMatchDetail, CareerMatchPlayer, CareerMatchResult, CareerMatchStatus, CareerMatchSummary, CareerStats, Role, TeamId,
} from "../../../contracts/index.ts";
import type { CareerFailure } from "../../../platform/career.ts";

/** Shown wherever the API has no value (a rate without a denominator, Round Swing without rounds). */
export const NO_VALUE = "—";
/** Typographic minus, so a negative swing lines up with the plus sign and is not read as a dash. */
const MINUS = "−";

export type SwingTone = "up" | "down" | "flat";

/**
 * Round Swing per round, in percentage points as the API sends it: one decimal, always signed (`+4.2%`,
 * `−6.5%`); a value that rounds to zero reads `0.0%`, no value `—`.
 */
export function formatSwing(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NO_VALUE;
  const tenths = Math.round(Math.abs(value) * 10);
  if (tenths === 0) return "0.0%";
  return `${value > 0 ? "+" : MINUS}${(tenths / 10).toFixed(1)}%`;
}

/** Colour of a swing: by the same rounding as `formatSwing`, so `0.0%` is never tinted. */
export function swingTone(value: number | null): SwingTone {
  if (value === null || !Number.isFinite(value) || Math.round(Math.abs(value) * 10) === 0) return "flat";
  return value > 0 ? "up" : "down";
}

/** A 0-1 rate as a whole percentage (`67%`). */
export function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? NO_VALUE : `${Math.round(value * 100)}%`;
}

export function formatDecimal(value: number | null, digits: number): string {
  return value === null || !Number.isFinite(value) ? NO_VALUE : value.toFixed(digits);
}

/** `rounds_won / rounds` style ratio of two counts, as a whole percentage. */
export function formatShare(part: number, whole: number): string {
  return whole > 0 ? formatPercent(part / whole) : NO_VALUE;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `m:ss`, or `h:mm:ss` past an hour. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Local `YYYY-MM-DD HH:mm`. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return NO_VALUE;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local `MM-DD HH:mm`, for tables (the full date goes in a tooltip). */
export const formatShortDateTime = (iso: string): string => { const full = formatDateTime(iso); return full === NO_VALUE ? full : full.slice(5); };

/** Local `YYYY-MM-DD`. */
export function formatDate(iso: string | null): string {
  return iso === null ? NO_VALUE : formatDateTime(iso).slice(0, 10);
}

const MODE_LABELS: Readonly<Record<string, string>> = { all: "全部模式", competitive: "竞技", casual: "休闲" };

/** Mode profile ids the client knows by name; others show as sent. */
export const modeLabel = (mode: string | null): string => mode === null ? "未知模式" : MODE_LABELS[mode] ?? mode;

export const RESULT_LABELS: Readonly<Record<CareerMatchResult, string>> = { win: "胜", loss: "负", draw: "平", unfinished: "未完成" };

const STATUS_LABELS: Readonly<Record<CareerMatchStatus, string>> = { finished: "已结束", aborted: "已中止", abandoned: "已中断" };
export const statusLabel = (status: CareerMatchStatus): string => STATUS_LABELS[status];

export const ROLE_LABELS: Readonly<Record<Role, string>> = { ntf: "NTF", scp: "SCP" };

/** `Scp173` -> `SCP-173`, `Scp0492` -> `SCP-049-2`; anything else as sent. */
export function scpRoleLabel(role: string): string {
  if (role === "Scp0492") return "SCP-049-2";
  const match = /^Scp(\d+)$/.exec(role);
  return match ? `SCP-${match[1]}` : role;
}

const MATCH_END_LABELS: Readonly<Record<string, string>> = {
  ScoreToWin: "达到胜利分数", MaxRounds: "打满回合", Forfeit: "一方弃赛", Aborted: "比赛中止",
};
export const matchEndLabel = (reason: string | null): string => reason === null ? NO_VALUE : MATCH_END_LABELS[reason] ?? reason;

const ROUND_END_LABELS: Readonly<Record<string, string>> = {
  NtfEliminated: "NTF 全灭", ScpEliminated: "SCP 全部收容", TimeExpired: "时间耗尽",
  GeneratorActivated: "发电机过载", GeneratorDeactivated: "发电机被关闭",
};
export const roundEndLabel = (reason: string | null): string => reason === null ? "未结束" : ROUND_END_LABELS[reason] ?? reason;

export type CareerBucket = "overall" | "ntf" | "scp";
export const CAREER_BUCKETS: readonly { id: CareerBucket; label: string }[] = [
  { id: "overall", label: "全部" },
  { id: "ntf", label: "NTF" },
  { id: "scp", label: "SCP" },
];

export type CareerStatView = { key: string; label: string; value: string; detail?: string; tone?: SwingTone };

/** The headline row: Round Swing first, the number that holds up in uneven casual teams. */
export function headlineStats(stats: CareerStats): CareerStatView[] {
  return [
    { key: "swing", label: "每回合 Swing", value: formatSwing(stats.swing_per_round), tone: swingTone(stats.swing_per_round),
      detail: `${stats.rounds_played} 回合` },
    { key: "kd", label: "K/D", value: formatDecimal(stats.kd, 2), detail: `${stats.kills} 杀 / ${stats.deaths} 死` },
    { key: "adr", label: "ADR", value: formatDecimal(stats.adr, 1), detail: "每回合伤害" },
    { key: "kast", label: "KAST", value: formatPercent(stats.kast), detail: `${stats.kast_rounds} 回合有贡献` },
    { key: "win-rate", label: "胜率", value: formatPercent(stats.win_rate),
      detail: `${stats.wins} 胜 ${stats.losses} 负${stats.draws > 0 ? ` ${stats.draws} 平` : ""}` },
  ];
}

/** Secondary counters under the headline. */
export function detailStats(stats: CareerStats): CareerStatView[] {
  return [
    { key: "matches", label: "比赛", value: String(stats.matches) },
    { key: "assists", label: "助攻", value: String(stats.assists) },
    { key: "headshot", label: "爆头率", value: formatPercent(stats.headshot_rate) },
    { key: "accuracy", label: "命中率", value: formatPercent(stats.accuracy) },
    { key: "opening", label: "首杀 / 首死", value: `${stats.opening_kills} / ${stats.opening_deaths}` },
    { key: "trade", label: "补枪 / 被补", value: `${stats.trade_kills} / ${stats.traded_deaths}` },
    { key: "multi", label: "3K+ 回合", value: String(stats.multi_3k + stats.multi_4k + stats.multi_5k) },
    { key: "clutch", label: "残局胜 / 次", value: `${stats.clutch_wins} / ${stats.clutch_attempts}` },
    { key: "mvp", label: "MVP", value: String(stats.mvps) },
    { key: "generator", label: "发电机 开 / 关", value: `${stats.gen_activations} / ${stats.gen_deactivations}` },
    { key: "flash", label: "闪光助攻", value: String(stats.flash_assists) },
    { key: "damage", label: "总伤害", value: String(Math.round(stats.damage)) },
  ];
}

/** Score as the player saw it (`13 : 9`); `—` when the match has none. */
export function matchScore(match: Pick<CareerMatchSummary, "score_own" | "score_enemy">): string {
  return match.score_own === null || match.score_enemy === null ? NO_VALUE : `${match.score_own} : ${match.score_enemy}`;
}

/** Name to show for a match participant: anonymous (do-not-track) and test players have neither name nor id. */
export const playerName = (player: Pick<CareerMatchPlayer, "nickname" | "player_id">): string =>
  player.nickname ?? player.player_id ?? "匿名玩家";

export type ScoreboardTeam = {
  side: TeamId;
  /** The side the team started on; null when neither the rounds nor the players say. */
  firstTeam: Role | null;
  score: number | null;
  won: boolean;
  players: CareerMatchPlayer[];
};

/** Team A then team B, each with its players in the API's order (kills down, deaths up, damage down). */
export function scoreboardTeams(detail: CareerMatchDetail): ScoreboardTeam[] {
  const firstNtfSide = detail.rounds.find((round) => round.ntf_side !== null)?.ntf_side ?? null;
  return (["team-a", "team-b"] as const).map((side) => {
    const players = detail.players.filter((player) => player.side === side);
    const firstTeam: Role | null = firstNtfSide !== null ? (firstNtfSide === side ? "ntf" : "scp") : players[0]?.first_team ?? null;
    return { side, firstTeam, score: side === "team-a" ? detail.score_a : detail.score_b, won: detail.winner_side === side, players };
  });
}

export type RoundCell = { key: number; label: string; winner: Role | null; reason: string };

/** One cell per round in play order, coloured by the side that won it. */
export function roundCells(detail: CareerMatchDetail): RoundCell[] {
  return detail.rounds.map((round) => ({
    key: round.round_seq,
    label: String(round.round ?? round.round_seq),
    winner: round.completed ? round.winner_team : null,
    reason: roundEndLabel(round.end_reason),
  }));
}

/** The message of a failed load; `self` when the page shows the viewer's own career. */
export function careerFailureText(failure: CareerFailure, self: boolean): { title: string; detail: string; retry: boolean } {
  switch (failure) {
    case "not-found":
      return self
        ? { title: "还没有生涯数据", detail: "在 SLGO 服务器打完一场计入生涯的比赛后，这里会显示你的统计。开启了不追踪的玩家没有生涯。", retry: true }
        : { title: "没有这名玩家的生涯", detail: "对方还没有计入生涯的比赛，或开启了不追踪。", retry: false };
    case "rate-limited": return { title: "请求过于频繁", detail: "生涯服务暂时限制了请求，请稍后重试。", retry: true };
    case "unavailable": return { title: "生涯服务暂不可用", detail: "数据仓库正在维护或无法访问，请稍后重试。", retry: true };
    case "offline": return { title: "无法连接生涯服务", detail: "请检查网络后重试。", retry: true };
    case "invalid": return { title: "无法读取生涯数据", detail: "服务器返回的数据与此版本 SLUI 不兼容，请更新 SLUI。", retry: false };
  }
}
