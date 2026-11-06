import {
  CAREER_MATCHES_PATH, CAREER_MODE_ALL, CAREER_PLAYERS_PATH, isCareerMatchId, isCareerPlayerId,
  parseCareerError, parseCareerMatchDetail, parseCareerMatchList, parseCareerProfile,
  type CareerMatchDetail, type CareerMatchList, type CareerProfile, type ParseResult,
} from "../contracts/index.ts";

/**
 * Why a career request gave no data. `not-found`: no such player or match (players who never finished a counted
 * match and do-not-track players have no career); `rate-limited` and `unavailable` are the API's own answers;
 * `offline`: no answer at all; `invalid`: an answer this build cannot read (an older client against a newer API).
 */
export type CareerFailure = "not-found" | "rate-limited" | "unavailable" | "offline" | "invalid";

export class CareerRequestError extends Error {
  readonly failure: CareerFailure;

  constructor(failure: CareerFailure, message: string) {
    super(message);
    this.name = "CareerRequestError";
    this.failure = failure;
  }
}

/** The public career API (packages/protocol/v0/README.md "Career API"); every method rejects with a CareerRequestError. */
export interface CareerSource {
  profile(playerId: string, mode: string): Promise<CareerProfile>;
  /** One page of recent matches, newest first; pass the previous page's `next_cursor` for the next one. */
  matches(playerId: string, mode: string, cursor: string | null): Promise<CareerMatchList>;
  match(matchId: string): Promise<CareerMatchDetail>;
}

export type HttpCareerSourceOptions = { fetch?: typeof fetch; timeoutMs?: number };

const ERROR_FAILURES = { "invalid-request": "invalid", "not-found": "not-found", "rate-limited": "rate-limited", unavailable: "unavailable" } as const;

/** `GET {controlPlane}/v0/...`: public and read-only, so it sends no credentials. */
export class HttpCareerSource implements CareerSource {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, options: HttpCareerSourceOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  profile(playerId: string, mode: string): Promise<CareerProfile> {
    if (!isCareerPlayerId(playerId)) return Promise.reject(new CareerRequestError("not-found", "Not a career player id"));
    return this.get(`${CAREER_PLAYERS_PATH}/${encodeURIComponent(playerId)}?mode=${encodeURIComponent(mode || CAREER_MODE_ALL)}`, parseCareerProfile);
  }

  matches(playerId: string, mode: string, cursor: string | null): Promise<CareerMatchList> {
    if (!isCareerPlayerId(playerId)) return Promise.reject(new CareerRequestError("not-found", "Not a career player id"));
    const query = new URLSearchParams({ mode: mode || CAREER_MODE_ALL });
    if (cursor) query.set("cursor", cursor);
    return this.get(`${CAREER_PLAYERS_PATH}/${encodeURIComponent(playerId)}/matches?${query}`, parseCareerMatchList);
  }

  match(matchId: string): Promise<CareerMatchDetail> {
    if (!isCareerMatchId(matchId)) return Promise.reject(new CareerRequestError("not-found", "Not a match id"));
    return this.get(`${CAREER_MATCHES_PATH}/${matchId}`, parseCareerMatchDetail);
  }

  private async get<T>(path: string, parse: (raw: unknown) => ParseResult<T>): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    let response: Response;
    let body: unknown = null;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, { headers: { accept: "application/json" }, signal: abort.signal });
      body = await response.json().catch(() => null);
    } catch (error) {
      throw new CareerRequestError("offline", abort.signal.aborted ? "Career API did not answer in time"
        : `Career API is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 200) {
      const parsed = parse(body);
      if (!parsed.ok) throw new CareerRequestError("invalid", `${path}: ${parsed.error.message}`);
      return parsed.value;
    }
    const rejected = parseCareerError(body);
    if (rejected.ok) throw new CareerRequestError(ERROR_FAILURES[rejected.value.error], `${path}: HTTP ${response.status} ${rejected.value.error}`);
    // A proxy in front of the API answers with its own page: judge by the status alone.
    if (response.status === 404) throw new CareerRequestError("not-found", `${path}: HTTP 404`);
    if (response.status === 429) throw new CareerRequestError("rate-limited", `${path}: HTTP 429`);
    throw new CareerRequestError("unavailable", `${path}: HTTP ${response.status}`);
  }
}
