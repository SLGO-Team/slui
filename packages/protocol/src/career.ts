// Control-plane career API: read-only, public, no credentials (v0/README.md "Career API").
// Built by the SLGO backend from its match warehouse; only settled matches are ever served.
import type { ParseResult, Role, TeamId } from "./index.ts";

/** `GET /v0/players/{player_id}` profile, `GET /v0/players/{player_id}/matches` recent matches. */
export const CAREER_PLAYERS_PATH = "/v0/players";
/** `GET /v0/matches/{match_id}` one match. */
export const CAREER_MATCHES_PATH = "/v0/matches";
/** `mode` covering every game mode (otherwise a mode profile id such as `competitive`). */
export const CAREER_MODE_ALL = "all";
export const CAREER_MATCHES_DEFAULT_LIMIT = 20;
export const CAREER_MATCHES_MAX_LIMIT = 50;
/** Most weapons a profile lists. */
export const CAREER_MAX_WEAPONS = 10;
/** Longest player id, nickname, mode, role, weapon and other text fields (UTF-16 code units). */
export const CAREER_MAX_TEXT_LENGTH = 128;
/** Longest pagination cursor. */
export const CAREER_MAX_CURSOR_LENGTH = 256;
/** Most players and rounds one match detail carries. */
export const CAREER_MAX_MATCH_PLAYERS = 64;
export const CAREER_MAX_MATCH_ROUNDS = 128;
/** Most deaths one round of a match detail carries. */
export const CAREER_MAX_ROUND_KILLS = 128;

/**
 * Account id as the game reports it: a SteamID64, or `id@provider` for other providers (never
 * `@steam`, which is stored without the suffix). Characters that need URL escaping are excluded.
 */
export const CAREER_PLAYER_ID_PATTERN = /^(?:[0-9]{17}|(?![^@]*@steam$)[^@\s:/?#%]+@[a-z]+)$/;
/** Match ids are lowercase UUIDs (UUIDv7 in practice). */
export const CAREER_MATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Mode values: `all` or a mode profile id. */
export const CAREER_MODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const isCareerPlayerId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= CAREER_MAX_TEXT_LENGTH && CAREER_PLAYER_ID_PATTERN.test(value);
export const isCareerMatchId = (value: unknown): value is string => typeof value === "string" && CAREER_MATCH_ID_PATTERN.test(value);
export const isCareerMode = (value: unknown): value is string => typeof value === "string" && CAREER_MODE_PATTERN.test(value);

export const CAREER_ERROR_CODES = ["invalid-request", "not-found", "rate-limited", "unavailable"] as const;
/** 400 / 404 / 429 / 503 body. */
export type CareerErrorCode = (typeof CAREER_ERROR_CODES)[number];
export type CareerError = { error: CareerErrorCode };

/** `finished`: played to its end; `aborted`: ended early by the server; `abandoned`: the server stopped reporting. */
export const CAREER_MATCH_STATUSES = ["finished", "aborted", "abandoned"] as const;
export type CareerMatchStatus = (typeof CAREER_MATCH_STATUSES)[number];
/** From the player's last side; `unfinished` for matches that did not finish. */
export const CAREER_MATCH_RESULTS = ["win", "loss", "draw", "unfinished"] as const;
export type CareerMatchResult = (typeof CAREER_MATCH_RESULTS)[number];
/** Who earned a kill's assist (CS2 one assister per kill). */
export const CAREER_ASSIST_SOURCES = ["damage", "flash", "scp_debuff", "scp079"] as const;
export type CareerAssistSource = (typeof CAREER_ASSIST_SOURCES)[number];

/**
 * Known values of the pass-through enums (telemetry v1). Newer servers may send others; clients
 * show unknown values generically instead of rejecting the response.
 */
export const CAREER_DEATH_KINDS = ["EnemyKill", "FriendlyFire", "SelfDamage", "Environment", "Disconnect", "TeamChange", "Unknown"] as const;
export const CAREER_ROUND_END_REASONS = ["NtfEliminated", "ScpEliminated", "TimeExpired", "GeneratorActivated", "GeneratorDeactivated", "Unknown"] as const;
export const CAREER_MATCH_END_REASONS = ["ScoreToWin", "MaxRounds", "Forfeit", "Aborted", "Unknown"] as const;
export const CAREER_MVP_REASONS = ["MostKills", "GeneratorActivated", "GeneratorDefused"] as const;

/**
 * Totals over the player's counted matches (finished, with complete data) and the rates derived
 * from them. A rate is null when its denominator is 0: win_rate = wins / matches, kd = kills /
 * deaths, adr = damage / rounds_played, kast = kast_rounds / rounds_played, headshot_rate =
 * headshot_kills / kills, accuracy = hits / shots. `damage` is to enemies (health and shields).
 */
export type CareerStats = {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  rounds_played: number;
  rounds_won: number;
  kills: number;
  deaths: number;
  assists: number;
  headshot_kills: number;
  damage: number;
  kast_rounds: number;
  opening_kills: number;
  opening_deaths: number;
  trade_kills: number;
  traded_deaths: number;
  multi_2k: number;
  multi_3k: number;
  multi_4k: number;
  multi_5k: number;
  clutch_attempts: number;
  clutch_wins: number;
  flash_assists: number;
  enemies_flashed: number;
  shots: number;
  hits: number;
  mvps: number;
  gen_activations: number;
  gen_deactivations: number;
  win_rate: number | null;
  kd: number | null;
  adr: number | null;
  kast: number | null;
  headshot_rate: number | null;
  accuracy: number | null;
};

/** One SCP role over the counted rounds the player started as it, most played first. */
export type CareerRoleStats = {
  role: string;
  rounds: number;
  rounds_won: number;
  kills: number;
  deaths: number;
  damage: number;
  adr: number | null;
};

/** Kills by damage type (`Com15`, `Scp173`, ...) in counted matches, most kills first. */
export type CareerWeaponStats = { weapon: string; kills: number; headshot_kills: number };

/** `GET /v0/players/{player_id}?mode=`. */
export type CareerProfile = {
  player_id: string;
  /** Latest known in-game name; null when never reported. */
  nickname: string | null;
  mode: string;
  /** Mode profile ids with counted matches. */
  modes: string[];
  first_match_at: string | null;
  last_match_at: string | null;
  /** Matches played but not counted (aborted or abandoned). */
  unfinished: number;
  /** Matches the player left before the end. */
  left_early: number;
  overall: CareerStats;
  ntf: CareerStats;
  scp: CareerStats;
  scp_roles: CareerRoleStats[];
  weapons: CareerWeaponStats[];
};

/** One row of `GET /v0/players/{player_id}/matches`. Scores are null when the match has none. */
export type CareerMatchSummary = {
  match_id: string;
  mode: string | null;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: CareerMatchStatus;
  counts_for_career: boolean;
  result: CareerMatchResult;
  /** Side at the player's last round. */
  side: TeamId;
  first_team: Role;
  score_own: number | null;
  score_enemy: number | null;
  rounds_played: number;
  kills: number;
  deaths: number;
  assists: number;
  headshot_kills: number;
  mvps: number;
  adr: number | null;
  kast: number | null;
  left_early: boolean;
};

/** `GET /v0/players/{player_id}/matches?mode=&limit=&cursor=`, newest first. */
export type CareerMatchList = {
  player_id: string;
  mode: string;
  items: CareerMatchSummary[];
  /** Pass as `cursor` for the next page; null on the last page. */
  next_cursor: string | null;
};

/** A participant of a match detail. `ref` is its index in `players`, used by rounds and kills. */
export type CareerMatchPlayer = {
  ref: number;
  /** Career link; null for anonymous players (do-not-track), test bots and erased players. */
  player_id: string | null;
  nickname: string | null;
  side: TeamId;
  first_team: Role;
  result: CareerMatchResult;
  joined_late: boolean;
  left_early: boolean;
  rounds_played: number;
  kills: number;
  deaths: number;
  assists: number;
  headshot_kills: number;
  damage: number;
  kast_rounds: number;
  opening_kills: number;
  opening_deaths: number;
  multi_3k: number;
  multi_4k: number;
  multi_5k: number;
  clutch_wins: number;
  flash_assists: number;
  enemies_flashed: number;
  mvps: number;
  money_spent: number;
  adr: number | null;
  kast: number | null;
};

/** One death of a round, in order. Player refs are null when the player did not take part (environment kills, mid-round spawns). */
export type CareerKill = {
  round_ms: number | null;
  /** Telemetry death kind (CAREER_DEATH_KINDS); only `EnemyKill` counts as a kill. */
  kind: string;
  killer: number | null;
  victim: number | null;
  assister: number | null;
  assist_source: CareerAssistSource | null;
  killer_role: string | null;
  victim_role: string | null;
  /** Damage type, e.g. `Com15`, `Scp096`, `Tesla`. */
  weapon: string;
  headshot: boolean;
  /** First kill of the round. */
  opening: boolean;
  /** Avenged a teammate killed just before. */
  trade: boolean;
  /** After the round was decided. */
  exit: boolean;
};

export type CareerRound = {
  round_seq: number;
  /** Display number (an admin score change may rewrite it); null when unknown. */
  round: number | null;
  half: number | null;
  ntf_side: TeamId | null;
  completed: boolean;
  winner_side: TeamId | null;
  winner_team: Role | null;
  end_reason: string | null;
  duration_ms: number | null;
  /** Score after this round. */
  score_a: number | null;
  score_b: number | null;
  mvp: number | null;
  mvp_reason: string | null;
  kills: CareerKill[];
};

/** `GET /v0/matches/{match_id}`: scoreboard and round timeline of a settled match with complete data. */
export type CareerMatchDetail = {
  match_id: string;
  mode: string | null;
  server_id: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: CareerMatchStatus;
  end_reason: string | null;
  counts_for_career: boolean;
  score_to_win: number | null;
  max_rounds: number | null;
  has_halftime: boolean | null;
  /** Null for a draw or a match without a winner. */
  winner_side: TeamId | null;
  score_a: number | null;
  score_b: number | null;
  players: CareerMatchPlayer[];
  rounds: CareerRound[];
};

// ---------------------------------------------------------------------------------------------
// Parsers: exact keys, types and ranges; references within `players`. Pass-through enums accept
// any short identifier so a newer backend does not break older clients.

type Check = (value: unknown) => boolean;
type Shape = Record<string, Check>;

const invalid = (message: string): ParseResult<never> => ({ ok: false, error: { code: "invalid-career", message } });
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Every key of `shape` present and passing, no other keys. */
const fits = (value: unknown, shape: Shape): value is Record<string, unknown> =>
  isObject(value) && Object.keys(value).length === Object.keys(shape).length && Object.entries(shape).every(([key, check]) => key in value && check(value[key]));

const count: Check = (value) => Number.isSafeInteger(value) && Number(value) >= 0;
const amount: Check = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const rate: Check = (value) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
const fraction: Check = (value) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
const bool: Check = (value) => typeof value === "boolean";
const text: Check = (value) => typeof value === "string" && value.length > 0 && value.length <= CAREER_MAX_TEXT_LENGTH;
const identifier: Check = (value) => typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value);
const date: Check = (value) => typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
const nullable = (check: Check): Check => (value) => value === null || check(value);
const oneOf = (values: readonly string[]): Check => (value) => values.includes(value as string);
const teamId = oneOf(["team-a", "team-b"]);
const role = oneOf(["ntf", "scp"]);
const playerId: Check = isCareerPlayerId;
const mode: Check = isCareerMode;

const STATS_COUNTS = [
  "matches", "wins", "losses", "draws", "rounds_played", "rounds_won", "kills", "deaths", "assists", "headshot_kills", "kast_rounds",
  "opening_kills", "opening_deaths", "trade_kills", "traded_deaths", "multi_2k", "multi_3k", "multi_4k", "multi_5k", "clutch_attempts",
  "clutch_wins", "flash_assists", "enemies_flashed", "shots", "hits", "mvps", "gen_activations", "gen_deactivations",
] as const;
const STATS_SHAPE: Shape = {
  ...Object.fromEntries(STATS_COUNTS.map((key) => [key, count])),
  damage: amount,
  win_rate: fraction,
  kd: rate,
  adr: rate,
  kast: fraction,
  headshot_rate: fraction,
  accuracy: fraction,
};
const ROLE_SHAPE: Shape = { role: identifier, rounds: count, rounds_won: count, kills: count, deaths: count, damage: amount, adr: rate };
const WEAPON_SHAPE: Shape = { weapon: identifier, kills: count, headshot_kills: count };
const listOf = (shape: Shape, max: number): Check => (value) => Array.isArray(value) && value.length <= max && value.every((item) => fits(item, shape));

const PROFILE_SHAPE: Shape = {
  player_id: playerId,
  nickname: nullable(text),
  mode,
  modes: (value) => Array.isArray(value) && value.length <= 64 && value.every(mode),
  first_match_at: nullable(date),
  last_match_at: nullable(date),
  unfinished: count,
  left_early: count,
  overall: (value) => fits(value, STATS_SHAPE),
  ntf: (value) => fits(value, STATS_SHAPE),
  scp: (value) => fits(value, STATS_SHAPE),
  scp_roles: listOf(ROLE_SHAPE, 64),
  weapons: listOf(WEAPON_SHAPE, CAREER_MAX_WEAPONS),
};

const SUMMARY_SHAPE: Shape = {
  match_id: isCareerMatchId,
  mode: nullable(mode),
  started_at: date,
  ended_at: date,
  duration_ms: count,
  status: oneOf(CAREER_MATCH_STATUSES),
  counts_for_career: bool,
  result: oneOf(CAREER_MATCH_RESULTS),
  side: teamId,
  first_team: role,
  score_own: nullable(count),
  score_enemy: nullable(count),
  rounds_played: count,
  kills: count,
  deaths: count,
  assists: count,
  headshot_kills: count,
  mvps: count,
  adr: rate,
  kast: fraction,
  left_early: bool,
};

const LIST_SHAPE: Shape = {
  player_id: playerId,
  mode,
  items: listOf(SUMMARY_SHAPE, CAREER_MATCHES_MAX_LIMIT),
  next_cursor: nullable((value) => typeof value === "string" && value.length > 0 && value.length <= CAREER_MAX_CURSOR_LENGTH),
};

const MATCH_PLAYER_SHAPE: Shape = {
  ref: count,
  player_id: nullable(playerId),
  nickname: nullable(text),
  side: teamId,
  first_team: role,
  result: oneOf(CAREER_MATCH_RESULTS),
  joined_late: bool,
  left_early: bool,
  rounds_played: count,
  kills: count,
  deaths: count,
  assists: count,
  headshot_kills: count,
  damage: amount,
  kast_rounds: count,
  opening_kills: count,
  opening_deaths: count,
  multi_3k: count,
  multi_4k: count,
  multi_5k: count,
  clutch_wins: count,
  flash_assists: count,
  enemies_flashed: count,
  mvps: count,
  money_spent: count,
  adr: rate,
  kast: fraction,
};

const KILL_SHAPE: Shape = {
  round_ms: nullable(count),
  kind: identifier,
  killer: nullable(count),
  victim: nullable(count),
  assister: nullable(count),
  assist_source: nullable(oneOf(CAREER_ASSIST_SOURCES)),
  killer_role: nullable(identifier),
  victim_role: nullable(identifier),
  weapon: identifier,
  headshot: bool,
  opening: bool,
  trade: bool,
  exit: bool,
};

const ROUND_SHAPE: Shape = {
  round_seq: (value) => Number.isSafeInteger(value) && Number(value) >= 1,
  round: nullable(count),
  half: nullable(count),
  ntf_side: nullable(teamId),
  completed: bool,
  winner_side: nullable(teamId),
  winner_team: nullable(role),
  end_reason: nullable(identifier),
  duration_ms: nullable(count),
  score_a: nullable(count),
  score_b: nullable(count),
  mvp: nullable(count),
  mvp_reason: nullable(identifier),
  kills: listOf(KILL_SHAPE, CAREER_MAX_ROUND_KILLS),
};

const DETAIL_SHAPE: Shape = {
  match_id: isCareerMatchId,
  mode: nullable(mode),
  server_id: text,
  started_at: date,
  ended_at: date,
  duration_ms: count,
  status: oneOf(CAREER_MATCH_STATUSES),
  end_reason: nullable(identifier),
  counts_for_career: bool,
  score_to_win: nullable(count),
  max_rounds: nullable(count),
  has_halftime: nullable(bool),
  winner_side: nullable(teamId),
  score_a: nullable(count),
  score_b: nullable(count),
  players: listOf(MATCH_PLAYER_SHAPE, CAREER_MAX_MATCH_PLAYERS),
  rounds: listOf(ROUND_SHAPE, CAREER_MAX_MATCH_ROUNDS),
};

export function parseCareerProfile(raw: unknown): ParseResult<CareerProfile> {
  if (!fits(raw, PROFILE_SHAPE)) return invalid("Career profile is invalid");
  return { ok: true, value: raw as unknown as CareerProfile };
}

export function parseCareerMatchList(raw: unknown): ParseResult<CareerMatchList> {
  if (!fits(raw, LIST_SHAPE)) return invalid("Career match list is invalid");
  const items = raw.items as CareerMatchSummary[];
  if (new Set(items.map((item) => item.match_id)).size !== items.length) return invalid("Career match list repeats a match");
  return { ok: true, value: raw as unknown as CareerMatchList };
}

export function parseCareerMatchDetail(raw: unknown): ParseResult<CareerMatchDetail> {
  if (!fits(raw, DETAIL_SHAPE)) return invalid("Career match detail is invalid");
  const detail = raw as unknown as CareerMatchDetail;
  if (!detail.players.every((player, index) => player.ref === index)) return invalid("Career match player refs must equal their index");
  const isRef = (ref: number | null) => ref === null || ref < detail.players.length;
  for (const round of detail.rounds) {
    if (!isRef(round.mvp)) return invalid("Career round MVP is not a player");
    for (const kill of round.kills) {
      if (!isRef(kill.killer) || !isRef(kill.victim) || !isRef(kill.assister)) return invalid("Career kill refers to an unknown player");
      if ((kill.assister === null) !== (kill.assist_source === null)) return invalid("Career kill assist source needs an assister");
    }
  }
  if (!detail.rounds.every((round, index) => index === 0 || round.round_seq > detail.rounds[index - 1]!.round_seq)) return invalid("Career rounds must be in increasing order");
  return { ok: true, value: detail };
}

export function parseCareerError(raw: unknown): ParseResult<CareerError> {
  if (!fits(raw, { error: oneOf(CAREER_ERROR_CODES) })) return invalid("Career error is invalid");
  return { ok: true, value: raw as unknown as CareerError };
}
