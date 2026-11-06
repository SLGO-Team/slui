import type {
  CareerKill, CareerMatchDetail, CareerMatchList, CareerMatchPlayer, CareerMatchResult, CareerMatchSummary, CareerProfile,
  CareerRound, CareerStats, Role, TeamId,
} from "../contracts/index.ts";
import { CareerRequestError, type CareerFailure, type CareerSource } from "../platform/career.ts";

// Career page previews for the home window in a browser (`?window=home&career=<name>`, and by default in the
// `mock` mode, which has no control plane). Every player id is a placeholder SteamID and every name invented.

export const CAREER_PREVIEW_PLAYER_ID = "76561198000000001";
const PAGE_SIZE = 20;
const MATCH_COUNT = 26;
const NAMES = ["Nova", "Reef", "Kestrel", "Juniper", "Ostrich", "Pilot", "Lumen", "Basalt", "Moth", "Quill", "Tundra", "Wren"];

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const ratio = (part: number, whole: number, digits = 4) => whole > 0 ? Number((part / whole).toFixed(digits)) : null;

type StatInput = {
  matches: number; wins: number; losses: number; draws: number; rounds: number; roundsWon: number;
  kills: number; deaths: number; assists: number; damage: number; swing: number;
};

function stats(input: StatInput): CareerStats {
  const { matches, wins, losses, draws, rounds, roundsWon, kills, deaths, assists, damage, swing } = input;
  const headshots = Math.round(kills * 0.18);
  const kastRounds = Math.round(rounds * 0.68);
  const shots = kills * 31;
  const hits = Math.round(shots * 0.27);
  return {
    matches, wins, losses, draws, rounds_played: rounds, rounds_won: roundsWon, kills, deaths, assists,
    headshot_kills: headshots, damage, kast_rounds: kastRounds,
    opening_kills: Math.round(kills * 0.14), opening_deaths: Math.round(deaths * 0.12),
    trade_kills: Math.round(kills * 0.2), traded_deaths: Math.round(deaths * 0.22),
    multi_2k: Math.round(rounds * 0.16), multi_3k: Math.round(rounds * 0.05), multi_4k: Math.round(rounds * 0.012), multi_5k: rounds > 100 ? 1 : 0,
    clutch_attempts: Math.round(rounds * 0.07), clutch_wins: Math.round(rounds * 0.025),
    flash_assists: Math.round(assists * 0.15), enemies_flashed: Math.round(assists * 0.6),
    shots, hits, mvps: Math.round(rounds * 0.09), gen_activations: Math.round(rounds * 0.04), gen_deactivations: Math.round(rounds * 0.03),
    swing: round4(swing),
    win_rate: ratio(wins, matches), kd: ratio(kills, deaths, 2), adr: ratio(damage, rounds, 1), kast: ratio(kastRounds, rounds),
    headshot_rate: ratio(headshots, kills), accuracy: ratio(hits, shots),
    swing_per_round: rounds > 0 ? Number((swing / rounds * 100).toFixed(2)) : null,
  };
}

const NTF = stats({ matches: 21, wins: 12, losses: 8, draws: 1, rounds: 214, roundsWon: 119, kills: 241, deaths: 176, assists: 63, damage: 31_870, swing: 6.42 });
const SCP = stats({ matches: 21, wins: 12, losses: 8, draws: 1, rounds: 198, roundsWon: 92, kills: 158, deaths: 189, assists: 41, damage: 22_410, swing: -3.17 });

function sampleProfile(playerId: string, mode: string): CareerProfile {
  const overall = stats({ matches: 21, wins: 12, losses: 8, draws: 1, rounds: 412, roundsWon: 211, kills: 399, deaths: 365, assists: 104, damage: 54_280, swing: 3.25 });
  const known = mode === "all" || mode === "competitive" || mode === "casual";
  const zero = stats({ matches: 0, wins: 0, losses: 0, draws: 0, rounds: 0, roundsWon: 0, kills: 0, deaths: 0, assists: 0, damage: 0, swing: 0 });
  return {
    player_id: playerId,
    nickname: playerId === CAREER_PREVIEW_PLAYER_ID ? "Nova" : NAMES[Number(playerId.slice(-2)) % NAMES.length]!,
    mode,
    modes: ["casual", "competitive"],
    first_match_at: "2026-10-12T12:04:00.000Z",
    last_match_at: "2026-11-06T13:41:00.000Z",
    unfinished: 2,
    left_early: 1,
    overall: known ? overall : zero,
    ntf: known ? NTF : zero,
    scp: known ? SCP : zero,
    scp_roles: known ? [
      { role: "Scp0492", rounds: 88, rounds_won: 39, kills: 52, deaths: 81, damage: 7_310, adr: 83.1 },
      { role: "Scp173", rounds: 41, rounds_won: 22, kills: 44, deaths: 33, damage: 6_020, adr: 146.8 },
      { role: "Scp096", rounds: 33, rounds_won: 15, kills: 31, deaths: 30, damage: 4_550, adr: 137.9 },
      { role: "Scp939", rounds: 36, rounds_won: 16, kills: 31, deaths: 45, damage: 4_530, adr: 125.8 },
    ] : [],
    weapons: known ? [
      { weapon: "Crossvec", kills: 96, headshot_kills: 14 },
      { weapon: "Com15", kills: 61, headshot_kills: 19 },
      { weapon: "E11SR", kills: 48, headshot_kills: 9 },
      { weapon: "Scp173", kills: 44, headshot_kills: 0 },
      { weapon: "Fsp9", kills: 29, headshot_kills: 5 },
    ] : [],
  };
}

const hex = (value: number, width: number) => value.toString(16).padStart(width, "0");
const matchId = (index: number) => `01a1a${hex(0xf00 - index, 3)}-4f00-7000-8000-${hex(0xbef0 + index, 12)}`;
const SWINGS = [4.2, -6.5, 1.84, 0.03, -2.1, 7.9, -0.6, 3.3, -11.25, 2.05];

function summary(index: number): CareerMatchSummary {
  const competitive = index % 3 !== 1;
  const started = Date.parse("2026-11-06T13:00:00.000Z") - index * 7 * 3_600_000;
  const aborted = index === 4;
  const won = !aborted && index % 2 === 0;
  const target = competitive ? 13 : 8;
  const own = aborted ? null : won ? target : (index * 3) % target;
  const enemy = aborted ? null : won ? (index * 5) % target : target;
  const rounds = (own ?? 0) + (enemy ?? 0);
  const result: CareerMatchResult = aborted ? "unfinished" : won ? "win" : "loss";
  const kills = aborted ? 0 : 12 + (index * 7) % 15;
  const deaths = aborted ? 0 : 10 + (index * 5) % 12;
  return {
    match_id: matchId(index),
    mode: competitive ? "competitive" : "casual",
    started_at: new Date(started).toISOString(),
    ended_at: new Date(started + (aborted ? 4 : rounds * 2) * 60_000).toISOString(),
    duration_ms: (aborted ? 4 : rounds * 2) * 60_000,
    status: aborted ? "aborted" : "finished",
    counts_for_career: !aborted,
    result,
    side: index % 2 === 0 ? "team-a" : "team-b",
    first_team: index % 4 < 2 ? "ntf" : "scp",
    score_own: own,
    score_enemy: enemy,
    rounds_played: rounds,
    kills,
    deaths,
    assists: aborted ? 0 : 2 + index % 6,
    headshot_kills: Math.round(kills * 0.2),
    mvps: aborted ? 0 : index % 5,
    adr: aborted ? null : Number((60 + (index * 13) % 70).toFixed(1)),
    kast: aborted ? null : round4(0.55 + (index % 7) * 0.05),
    swing_per_round: aborted ? null : SWINGS[index % SWINGS.length]!,
    left_early: index === 7,
  };
}

function sampleMatches(playerId: string, mode: string, cursor: string | null): CareerMatchList {
  const all = Array.from({ length: MATCH_COUNT }, (_, index) => summary(index)).filter((match) => mode === "all" || match.mode === mode);
  const start = cursor ? Number(cursor.slice("page-".length)) : 0;
  const items = all.slice(start, start + PAGE_SIZE);
  return { player_id: playerId, mode, items, next_cursor: start + PAGE_SIZE < all.length ? `page-${start + PAGE_SIZE}` : null };
}

function matchPlayer(ref: number, side: TeamId, firstTeam: Role, result: CareerMatchResult, rounds: number, seed: number, self: boolean): CareerMatchPlayer {
  const anonymous = !self && seed % 7 === 3;
  const kills = 6 + (seed * 7) % 19;
  const deaths = 8 + (seed * 5) % 13;
  const damage = kills * 92 + (seed * 37) % 400;
  const kastRounds = Math.min(rounds, Math.round(rounds * (0.5 + (seed % 5) * 0.08)));
  const swings = [5.6, -3.2, 0.9, -8.4, 2.7, 11.3, -0.4, -1.9, 4.4, 0.02];
  return {
    ref,
    player_id: self ? CAREER_PREVIEW_PLAYER_ID : anonymous ? null : `765611980000000${String(10 + seed % 80).padStart(2, "0")}`,
    nickname: self ? "Nova" : anonymous ? null : NAMES[seed % NAMES.length]!,
    side,
    first_team: firstTeam,
    result,
    joined_late: seed % 9 === 5,
    left_early: false,
    rounds_played: rounds,
    kills,
    deaths,
    assists: seed % 7,
    headshot_kills: Math.round(kills * 0.2),
    damage,
    kast_rounds: kastRounds,
    opening_kills: seed % 4,
    opening_deaths: seed % 3,
    multi_3k: seed % 3,
    multi_4k: seed % 5 === 0 ? 1 : 0,
    multi_5k: 0,
    clutch_wins: seed % 2,
    flash_assists: seed % 3,
    enemies_flashed: seed % 6,
    mvps: seed % 4,
    money_spent: 18_000 + seed * 750,
    adr: rounds > 0 ? Number((damage / rounds).toFixed(1)) : null,
    kast: rounds > 0 ? round4(kastRounds / rounds) : null,
    swing_per_round: rounds > 0 ? swings[seed % swings.length]! : null,
  };
}

function sampleMatch(id: string): CareerMatchDetail {
  const index = Array.from({ length: MATCH_COUNT }, (_, i) => i).find((i) => matchId(i) === id);
  if (index === undefined) throw new CareerRequestError("not-found", "No such preview match");
  const row = summary(index);
  if (row.status !== "finished") throw new CareerRequestError("not-found", "Preview match has no complete data");
  const own = row.side;
  const enemy: TeamId = own === "team-a" ? "team-b" : "team-a";
  const scoreOf = (side: TeamId) => side === own ? row.score_own : row.score_enemy;
  const firstOf = (side: TeamId): Role => side === own ? row.first_team : row.first_team === "ntf" ? "scp" : "ntf";
  const resultOf = (side: TeamId): CareerMatchResult => side === own ? row.result : row.result === "win" ? "loss" : "win";
  // Casual previews are uneven (6 v 4), the case Round Swing exists for.
  const sizes: Record<TeamId, number> = row.mode === "casual" ? { [own]: 6, [enemy]: 4 } as Record<TeamId, number> : { "team-a": 5, "team-b": 5 };
  const players: CareerMatchPlayer[] = [];
  for (const side of ["team-a", "team-b"] as const) {
    for (let slot = 0; slot < sizes[side]; slot += 1) {
      const self = side === own && slot === 1;
      players.push(matchPlayer(players.length, side, firstOf(side), resultOf(side), row.rounds_played, index * 11 + players.length * 3, self));
    }
  }
  players.sort((a, b) => (a.side === b.side ? b.kills - a.kills || a.deaths - b.deaths : a.side === "team-a" ? -1 : 1));
  players.forEach((player, ref) => { player.ref = ref; });

  const ntfFirst: TeamId = firstOf("team-a") === "ntf" ? "team-a" : "team-b";
  const half = Math.ceil(row.rounds_played / 2);
  let a = 0;
  let b = 0;
  // Round winners that add up to the final score, the match winner taking the last round.
  const matchWinner: TeamId = row.result === "win" ? own : enemy;
  let leftA = (scoreOf("team-a") ?? 0) - (matchWinner === "team-a" ? 1 : 0);
  let leftB = (scoreOf("team-b") ?? 0) - (matchWinner === "team-b" ? 1 : 0);
  const rounds: CareerRound[] = Array.from({ length: row.rounds_played }, (_, i) => {
    const last = i === row.rounds_played - 1;
    const winner: TeamId = last ? matchWinner : leftB === 0 || (leftA > 0 && (i % 2 === 0) === (leftA >= leftB)) ? "team-a" : "team-b";
    if (!last) { if (winner === "team-a") leftA -= 1; else leftB -= 1; }
    if (winner === "team-a") a += 1; else b += 1;
    const ntfSide: TeamId = row.mode === "competitive" && i >= half ? (ntfFirst === "team-a" ? "team-b" : "team-a") : ntfFirst;
    const winnerTeam: Role = winner === ntfSide ? "ntf" : "scp";
    const killer = players.find((player) => player.side === winner)!.ref;
    const victim = players.find((player) => player.side !== winner)!.ref;
    const kill: CareerKill = {
      round_ms: 21_000 + i * 900, kind: "EnemyKill", killer, victim, assister: null, assist_source: null,
      killer_role: winnerTeam === "ntf" ? "NtfSergeant" : "Scp173", victim_role: winnerTeam === "ntf" ? "Scp0492" : "NtfSergeant",
      weapon: winnerTeam === "ntf" ? "Crossvec" : "Scp173", headshot: false, opening: true, trade: false, exit: false,
    };
    return {
      round_seq: i + 1, round: i + 1, half: row.mode === "competitive" ? (i >= half ? 2 : 1) : null, ntf_side: ntfSide, completed: true,
      winner_side: winner, winner_team: winnerTeam,
      end_reason: winnerTeam === "ntf" ? (i % 4 === 0 ? "GeneratorActivated" : "ScpEliminated") : (i % 3 === 0 ? "TimeExpired" : "NtfEliminated"),
      duration_ms: 95_000 + (i * 7_000) % 60_000, score_a: a, score_b: b, mvp: killer, mvp_reason: "MostKills", kills: [kill],
    };
  });
  return {
    match_id: row.match_id, mode: row.mode, server_id: "slgo-preview-1", started_at: row.started_at, ended_at: row.ended_at,
    duration_ms: row.duration_ms, status: row.status, end_reason: "ScoreToWin", counts_for_career: true,
    score_to_win: row.mode === "competitive" ? 13 : 8, max_rounds: row.mode === "competitive" ? 24 : 15, has_halftime: row.mode === "competitive",
    winner_side: matchWinner, score_a: a, score_b: b, players, rounds,
  };
}

const delay = <T>(value: () => T, ms: number) => new Promise<T>((resolve, reject) => setTimeout(() => {
  try { resolve(value()); } catch (error) { reject(error); }
}, ms));

/** Sample career for any player id, served after a short delay so loading states show. */
export class SampleCareerSource implements CareerSource {
  private readonly latencyMs: number;

  constructor(latencyMs = 250) {
    this.latencyMs = latencyMs;
  }

  profile(playerId: string, mode: string) { return delay(() => sampleProfile(playerId, mode), this.latencyMs); }
  matches(playerId: string, mode: string, cursor: string | null) { return delay(() => sampleMatches(playerId, mode, cursor), this.latencyMs); }
  match(matchId: string) { return delay(() => sampleMatch(matchId), this.latencyMs); }
}

/** Every request fails the same way. */
export class FailingCareerSource implements CareerSource {
  private readonly failure: CareerFailure;

  constructor(failure: CareerFailure) {
    this.failure = failure;
  }

  private fail<T>(): Promise<T> { return delay(() => { throw new CareerRequestError(this.failure, `Preview: ${this.failure}`); }, 250); }
  profile() { return this.fail<CareerProfile>(); }
  matches() { return this.fail<CareerMatchList>(); }
  match() { return this.fail<CareerMatchDetail>(); }
}

const PREVIEWS: Record<string, () => CareerSource> = {
  sample: () => new SampleCareerSource(),
  slow: () => new SampleCareerSource(2_500),
  empty: () => new FailingCareerSource("not-found"),
  unavailable: () => new FailingCareerSource("unavailable"),
  offline: () => new FailingCareerSource("offline"),
};

export type CareerPreview = { source: CareerSource; playerId: string };

/** `?career=sample|slow|empty|unavailable|offline`; the mock mode shows `sample` without one. */
export function readCareerPreview(search: string, mockBackend: boolean): CareerPreview | null {
  const name = new URLSearchParams(search).get("career") ?? (mockBackend ? "sample" : null);
  const create = name && Object.prototype.hasOwnProperty.call(PREVIEWS, name) ? PREVIEWS[name] : null;
  return create ? { source: create(), playerId: CAREER_PREVIEW_PLAYER_ID } : null;
}
