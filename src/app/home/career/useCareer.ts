import { useCallback, useEffect, useState } from "react";
import type { CareerMatchDetail, CareerMatchSummary, CareerProfile } from "../../../contracts/index.ts";
import { CareerRequestError, type CareerFailure, type CareerSource } from "../../../platform/career.ts";

export type Loaded<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "failed"; failure: CareerFailure };

export type MatchPage = {
  items: CareerMatchSummary[];
  nextCursor: string | null;
  /** A later page is on its way, or the last attempt to get one failed. */
  more: "idle" | "loading" | CareerFailure;
};

const failureOf = (error: unknown): CareerFailure => {
  if (error instanceof CareerRequestError) return error.failure;
  console.error("Career request failed", error);
  return "offline";
};

/** Profile and the first page of recent matches for one player and mode; `reload` asks again. */
export function useCareer(source: CareerSource, playerId: string, mode: string) {
  const [attempt, setAttempt] = useState(0);
  const [profile, setProfile] = useState<Loaded<CareerProfile>>({ kind: "loading" });
  const [matches, setMatches] = useState<Loaded<MatchPage>>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    setProfile({ kind: "loading" });
    setMatches({ kind: "loading" });
    source.profile(playerId, mode).then((value) => { if (active) setProfile({ kind: "ready", value }); },
      (error: unknown) => { if (active) setProfile({ kind: "failed", failure: failureOf(error) }); });
    source.matches(playerId, mode, null).then((value) => {
      if (active) setMatches({ kind: "ready", value: { items: value.items, nextCursor: value.next_cursor, more: "idle" } });
    }, (error: unknown) => { if (active) setMatches({ kind: "failed", failure: failureOf(error) }); });
    return () => { active = false; };
  }, [source, playerId, mode, attempt]);

  const loadMore = useCallback(() => {
    if (matches.kind !== "ready" || !matches.value.nextCursor || matches.value.more === "loading") return;
    const cursor = matches.value.nextCursor;
    setMatches({ kind: "ready", value: { ...matches.value, more: "loading" } });
    source.matches(playerId, mode, cursor).then((page) => setMatches((current) => {
      // Dropped when the player, mode or first page changed meanwhile.
      if (current.kind !== "ready" || current.value.nextCursor !== cursor) return current;
      const seen = new Set(current.value.items.map((item) => item.match_id));
      return { kind: "ready", value: { items: [...current.value.items, ...page.items.filter((item) => !seen.has(item.match_id))], nextCursor: page.next_cursor, more: "idle" } };
    }), (error: unknown) => setMatches((current) => current.kind === "ready" && current.value.nextCursor === cursor
      ? { kind: "ready", value: { ...current.value, more: failureOf(error) } } : current));
  }, [matches, source, playerId, mode]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { profile, matches, loadMore, reload };
}

/** One match detail; `reload` asks again. */
export function useCareerMatch(source: CareerSource, matchId: string) {
  const [attempt, setAttempt] = useState(0);
  const [match, setMatch] = useState<Loaded<CareerMatchDetail>>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    setMatch({ kind: "loading" });
    source.match(matchId).then((value) => { if (active) setMatch({ kind: "ready", value }); },
      (error: unknown) => { if (active) setMatch({ kind: "failed", failure: failureOf(error) }); });
    return () => { active = false; };
  }, [source, matchId, attempt]);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { match, reload };
}
