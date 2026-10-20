import type { ScoreboardPlayer, ScoreboardRound, ScoreboardSideStats, ScoreboardSnapshot, TeamId } from "../contracts/index.ts";

/**
 * Mock `scoreboard.snapshot` data for the HUD debug build. The two scoreboard scenes pin the debug HUD's match too
 * (`scoreboardSceneMatch`): `scoreboard-competitive` is round 15 of 24 (second half, so the side switch and the
 * timeline are live) with the standard roster's alive / dead / offline mix; `scoreboard-casual` is 10v10 under the
 * casual rules (no halftime, no timeline). Every other scene gets a casual board for the standard roster, so the
 * scoreboard key works in any preview.
 */
export const SCOREBOARD_SCENES = ["scoreboard-competitive", "scoreboard-casual"] as const;
export type ScoreboardScene = (typeof SCOREBOARD_SCENES)[number];

export type ScoreboardSceneMatch = Readonly<{
  round: number;
  maxRounds: number;
  scores: Readonly<Record<TeamId, number>>;
  /** Fill both teams to ten players (the debug HUD's large roster). */
  largeRoster: boolean;
}>;

const isScoreboardScene = (scene: string): scene is ScoreboardScene => (SCOREBOARD_SCENES as readonly string[]).includes(scene);

export function scoreboardSceneMatch(scene: string): ScoreboardSceneMatch | null {
  if (!isScoreboardScene(scene)) return null;
  return scene === "scoreboard-competitive"
    ? { round: 15, maxRounds: 24, scores: { "team-a": 6, "team-b": 8 }, largeRoster: false }
    : { round: 7, maxRounds: 15, scores: { "team-a": 4, "team-b": 2 }, largeRoster: true };
}

/** The mock roster's ids (provider.ts) and the large-roster fill-ins (hudDebug.ts). */
const MOCK_IDS: Readonly<Record<TeamId, readonly string[]>> = {
  "team-a": [
    ...Array.from({ length: 5 }, (_, index) => `76561198${String(index + 1).padStart(9, "0")}`),
    ...Array.from({ length: 5 }, (_, index) => `hud-large-team-a-${String(index + 6).padStart(2, "0")}`),
  ],
  "team-b": [
    ...Array.from({ length: 5 }, (_, index) => `76561198${String(index + 6).padStart(9, "0")}`),
    ...Array.from({ length: 5 }, (_, index) => `hud-large-team-b-${String(index + 6).padStart(2, "0")}`),
  ],
};

/** Deterministic stats: the seed varies them per player and side, and NTF-only stats stay 0 on the SCP side. */
function stats(seed: number, roundsPlayed: number, ntf: boolean): ScoreboardSideStats {
  if (roundsPlayed === 0) return { rounds_played: 0, kills: 0, deaths: 0, assists: 0, damage: 0, shots_fired: 0, shots_hit: 0, mvps: 0, utility_damage: 0, enemies_flashed: 0 };
  const kills = (seed * 7) % (roundsPlayed + 4);
  const damage = kills * 92 + ((seed * 37) % 160);
  return {
    rounds_played: roundsPlayed,
    kills,
    deaths: (seed * 5) % (roundsPlayed + 1),
    assists: (seed * 3) % 5,
    damage,
    shots_fired: ntf ? roundsPlayed * 18 + ((seed * 11) % 30) : 0,
    shots_hit: ntf ? Math.floor((roundsPlayed * 18 + ((seed * 11) % 30)) * (0.2 + (seed % 5) * 0.06)) : 0,
    mvps: seed % 4 === 0 ? 2 : seed % 3 === 0 ? 1 : 0,
    utility_damage: ntf ? Math.min(damage, (seed * 13) % 90) : 0,
    enemies_flashed: ntf ? seed % 4 : 0,
  };
}

/** Round history of the competitive scene: team-a played SCP in the first half, NTF from round 13. */
const COMPETITIVE_ROUNDS: readonly ScoreboardRound[] = [
  [1, "team-b", "elimination"], [2, "team-b", "generator_activated"], [3, "team-a", "generator_deactivated"],
  [4, "team-a", "time_expired"], [5, "team-b", "elimination"], [6, "team-b", "elimination"], [7, "team-a", "elimination"],
  [8, "team-b", "generator_activated"], [9, "team-a", "time_expired"], [10, "team-b", "elimination"],
  [11, "team-a", "elimination"], [12, "team-b", "generator_activated"], [13, "team-a", "generator_activated"],
  [14, "team-b", "generator_deactivated"],
].map(([round, team, reason]) => {
  const firstHalf = (round as number) <= 12;
  const teamAIsScp = firstHalf;
  const winnerIsScp = (team === "team-a") === teamAIsScp;
  return { round: round as number, winner_team_id: team as TeamId, winner_role: winnerIsScp ? "scp" : "ntf", reason: reason as ScoreboardRound["reason"] };
});

export function scoreboardSnapshotForScene(scene: string): ScoreboardSnapshot {
  const competitive = scene === "scoreboard-competitive";
  // team-a plays NTF now; in the competitive second half it played SCP for 12 rounds and NTF for 2.
  const players: ScoreboardPlayer[] = (["team-a", "team-b"] as const).flatMap((team) => MOCK_IDS[team].map((playerId, index): ScoreboardPlayer => {
    const seed = index + (team === "team-a" ? 3 : 11);
    const nowNtf = team === "team-a";
    const currentRounds = competitive ? 2 : 6;
    const otherRounds = competitive ? 12 : 0;
    const current = stats(seed, currentRounds, nowNtf);
    const other = stats(seed + 5, otherRounds, !nowNtf);
    const bot = playerId.startsWith("hud-large") && index % 2 === 1;
    return {
      player_id: playerId,
      ping_ms: bot ? null : 18 + ((seed * 17) % 70),
      is_bot: bot,
      ntf: nowNtf ? current : other,
      scp: nowNtf ? other : current,
    };
  }));
  return competitive
    ? {
      mode_name: "竞技模式", mode_icon: "competitive", elapsed_ms: 1_504_000, max_rounds: 24, score_to_win: 13, halftime_after_round: 12,
      rounds: [...COMPETITIVE_ROUNDS], loss_bonus: { "team-a": 0, "team-b": 2 }, players,
    }
    : {
      mode_name: "休闲模式", mode_icon: "casual", elapsed_ms: 591_000, max_rounds: 15, score_to_win: 8, halftime_after_round: null,
      rounds: [], loss_bonus: null, players,
    };
}

/** URL pins for captures (debug build): `scoreboard=passive|cursor`, `scoreboardPage=2`, `scoreboardSide=other`. */
export type ScoreboardDebugPins = Readonly<{ mode: "passive" | "cursor" | null; page: 1 | 2; side: "current" | "other" }>;

export function readScoreboardDebugPins(search: string = window.location.search): ScoreboardDebugPins {
  const params = new URLSearchParams(search);
  const mode = params.get("scoreboard");
  return {
    mode: mode === "passive" || mode === "cursor" ? mode : null,
    page: params.get("scoreboardPage") === "2" ? 2 : 1,
    side: params.get("scoreboardSide") === "other" ? "other" : "current",
  };
}
