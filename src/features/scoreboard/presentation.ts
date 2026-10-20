import type { Role, RoundState, ScoreboardModeIcon, ScoreboardPlayer, ScoreboardRoundReason, ScoreboardSideStats, TeamId } from "../../contracts/index.ts";
import type { HudPlayerView, HudTeamView, HudViewerPlayerView, RoundHudViewModel } from "../hud/model.ts";
import { DEFAULT_AVATAR_BY_SIDE, hudPlayerState, hudSideForRole, playerSlotColors, type HudPlayerState, type HudSide } from "../hud/presentation.ts";
import { formatScoreboardElapsed, scoreboardElapsedMs, type ScoreboardFrame, type ScoreboardStat, type ScoreboardViewState } from "./model.ts";

/**
 * CS2 fixes CT on top. SLGO's sides keep their gameplay meaning (`hudSideForRole`: SCP defends = CT, NTF attacks with
 * the keycard = T), so the SCP team is the top block. One constant flips it.
 */
export const SCOREBOARD_TOP_ROLE: Role = "scp";

export type ScoreboardColumn = Readonly<{
  stat: ScoreboardStat;
  label: string;
  /** Panorama cell width at 1080p. */
  width: number;
  align: "center" | "right";
}>;

const column = (stat: ScoreboardStat, label: string, width = 50, align: "center" | "right" = "center"): ScoreboardColumn => ({ stat, label, width, align });

/** The two stat sets (CS2 competitive row: `data-set` 0 and 1), then damage, which every page shows. */
export const SCOREBOARD_PAGES: Readonly<Record<1 | 2, readonly ScoreboardColumn[]>> = {
  1: [column("money", "金钱", 66, "right"), column("kills", "杀敌数"), column("deaths", "死亡数"), column("assists", "助攻数"), column("hsp", "爆%", 64)],
  2: [column("mvps", "MVP次数"), column("utilitydamage", "道具"), column("enemiesflashed", "致盲"), column("kdr", "KDR"), column("adr", "伤/局")],
};
export const SCOREBOARD_DAMAGE_COLUMN: ScoreboardColumn = column("damage", "伤害");

/** Stats SCP players cannot earn: blank on rows that show SCP-side stats (the plugin's hint board blanks 命% too). */
const HUMAN_ONLY_STATS: ReadonlySet<ScoreboardStat> = new Set(["hsp", "utilitydamage", "enemiesflashed"]);

/**
 * CS2 `sortOrder_tmm` after the online check: damage, kills, MVPs, assists (descending), deaths (ascending), then the
 * roster order. A clicked header goes first and keeps this chain for ties; there is no direction toggle.
 */
const SORT_CHAIN: readonly ScoreboardStat[] = ["damage", "kills", "mvps", "assists", "deaths"];
const ASCENDING: ReadonlySet<ScoreboardStat> = new Set(["deaths"]);

export const SCOREBOARD_SIDE_NAMES: Readonly<Record<Role, string>> = { ntf: "NTF", scp: "SCP" };

export const SCOREBOARD_MODE_ICONS: Readonly<Record<ScoreboardModeIcon, string>> = {
  competitive: "/assets/scoreboard/mode-competitive.svg",
  casual: "/assets/scoreboard/mode-casual.svg",
};

/** Timeline result icons: CS2 kill / bomb / defuser / timer with SLGO's analogues (the HUD's keycard and wire cutters). */
export const SCOREBOARD_REASON_ICONS: Readonly<Record<ScoreboardRoundReason, string>> = {
  elimination: "/assets/hud/skull.svg",
  generator_activated: "/assets/slui-svg/KeycardNTFCommander.svg",
  generator_deactivated: "/assets/icons/wire-cutters.svg",
  time_expired: "/assets/scoreboard/timer.svg",
};
export const SCOREBOARD_TROPHY_ICON = "/assets/scoreboard/trophy.svg";

export type ScoreboardCell = Readonly<{ stat: ScoreboardStat; text: string }>;

export type ScoreboardRowView = Readonly<{
  playerId: string;
  name: string;
  avatarUrl: string;
  fallbackAvatarUrl: string;
  slotColor: string;
  state: HudPlayerState;
  local: boolean;
  bot: boolean;
  /** Ping text; empty for bots (the bot icon) and when unknown. */
  ping: string;
  /** Round MVPs on the displayed side; the star shows when above 0. */
  mvps: number;
  /** The current page's cells then damage, in column order. */
  cells: readonly ScoreboardCell[];
}>;

export type ScoreboardTeamView = Readonly<{
  teamId: TeamId;
  role: Role;
  side: HudSide;
  score: number;
  sideName: string;
  aliveLabel: string;
  rows: readonly ScoreboardRowView[];
}>;

export type ScoreboardRoundSlot = Readonly<{
  round: number;
  /** Tick label every fifth round. */
  label: string | null;
  /** The finished round's winner: which block it sits by, the side colour it won with, its icon. */
  result: Readonly<{ position: "top" | "bottom"; role: Role; icon: string }> | null;
  /** Trophy where a team would clinch (CS2 `clinch-round`). */
  clinch: "top" | "bottom" | null;
  /** CS2 `.hilite`: finished rounds and the current one. */
  active: boolean;
  /** CS2 `past-clinch`: rounds after the earliest possible clinch fade. */
  pastClinch: boolean;
}>;

export type ScoreboardHalfScore = Readonly<{ top: number; bottom: number; topRole: Role; bottomRole: Role }>;

export type ScoreboardTimelineView = Readonly<{
  firstHalf: readonly ScoreboardRoundSlot[];
  secondHalf: readonly ScoreboardRoundSlot[];
  halfScores: readonly [ScoreboardHalfScore, ScoreboardHalfScore];
  /** Lit pips (0-4) per block; null without loss streaks. */
  lossBonus: Readonly<{ top: number; bottom: number }> | null;
}>;

export type ScoreboardView = Readonly<{
  modeName: string;
  modeIcon: string;
  elapsed: string;
  page: 1 | 2;
  /** The side switch exists only in the second half of a halftime mode. */
  sideSwitchAvailable: boolean;
  /** Showing first-half stats (`other`), after the fallback. */
  showingOtherSide: boolean;
  sortStat: ScoreboardStat;
  columns: readonly ScoreboardColumn[];
  top: ScoreboardTeamView;
  bottom: ScoreboardTeamView;
  /** CS2's competitive template; modes without halftime use the casual one (no timeline). */
  timeline: ScoreboardTimelineView | null;
}>;

/** States in which the scoreboard never shows (as the plugin's hint board). */
export const SCOREBOARD_HIDDEN_STATES: ReadonlySet<RoundState> = new Set(["Idle", "WaitingForPlayers"]);

const otherRole = (role: Role): Role => role === "ntf" ? "scp" : "ntf";

const EMPTY_STATS: ScoreboardSideStats = {
  rounds_played: 0, kills: 0, deaths: 0, assists: 0, damage: 0, headshot_kills: 0, mvps: 0, utility_damage: 0, enemies_flashed: 0,
};

/** One stat's sort value; NaN for a blank cell (CS2 `_lessthan` puts NaN below every number). */
function statValue(stat: ScoreboardStat, stats: ScoreboardSideStats, bucket: Role, money: number | null): number {
  if (bucket === "scp" && HUMAN_ONLY_STATS.has(stat)) return Number.NaN;
  switch (stat) {
    case "money": return money ?? Number.NaN;
    case "kills": return stats.kills;
    case "deaths": return stats.deaths;
    case "assists": return stats.assists;
    case "hsp": return stats.kills === 0 ? 0 : Math.round((100 * stats.headshot_kills) / stats.kills);
    case "mvps": return stats.mvps;
    case "utilitydamage": return stats.utility_damage;
    case "enemiesflashed": return stats.enemies_flashed;
    case "kdr": return stats.kills / Math.max(stats.deaths, 1);
    case "adr": return stats.rounds_played === 0 ? 0 : Math.round(stats.damage / stats.rounds_played);
    case "damage": return stats.damage;
  }
}

function statText(stat: ScoreboardStat, value: number): string {
  if (Number.isNaN(value)) return "";
  if (stat === "money") return `$${value}`;
  if (stat === "kdr") return value.toFixed(2);
  return String(value);
}

/** CS2 `_lessthan`: NaN is below every number, two NaNs are equal. */
function compareDescending(a: number, b: number): number {
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
  if (Number.isNaN(b)) return -1;
  return b - a;
}

type SortableRow = { row: ScoreboardRowView; online: boolean; index: number; values: Readonly<Record<ScoreboardStat, number>> };

/** Online first, then the clicked stat, then the competitive chain, then roster order. */
export function sortScoreboardRows<T extends SortableRow>(rows: readonly T[], sortStat: ScoreboardStat): T[] {
  const chain = [sortStat, ...SORT_CHAIN.filter((stat) => stat !== sortStat)];
  return [...rows].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    for (const stat of chain) {
      const order = ASCENDING.has(stat) ? -compareDescending(a.values[stat], b.values[stat]) : compareDescending(a.values[stat], b.values[stat]);
      if (order !== 0) return order;
    }
    return a.index - b.index;
  });
}

type SelectInput = {
  hud: RoundHudViewModel;
  frame: ScoreboardFrame | null;
  view: ScoreboardViewState;
  localPlayerId: string | null;
  nowMs: number;
};

function moneyOf(player: HudPlayerView | HudViewerPlayerView): number | null {
  return "loadout" in player ? player.loadout?.money ?? null : null;
}

/**
 * The scoreboard to draw, or null when it has nothing to show: no match snapshot, no `scoreboard.snapshot` from this
 * instance (an old plugin keeps its own hint board), or a waiting state.
 */
export function selectScoreboard({ hud, frame, view, localPlayerId, nowMs }: SelectInput): ScoreboardView | null {
  if (!hud.hasSnapshot || frame === null || SCOREBOARD_HIDDEN_STATES.has(hud.state)) return null;
  const board = frame.snapshot;
  const halftime = board.halftime_after_round;
  const secondHalf = halftime !== null && hud.round > halftime;
  const sideSwitchAvailable = secondHalf;
  const showingOtherSide = sideSwitchAvailable && view.side === "other";
  const columns = [...SCOREBOARD_PAGES[view.page], SCOREBOARD_DAMAGE_COLUMN];
  const statsById = new Map<string, ScoreboardPlayer>(board.players.map((player) => [player.player_id, player]));
  const slotColors = playerSlotColors(hud.teams);
  const topTeam = hud.teams.find((team) => team.role === SCOREBOARD_TOP_ROLE) ?? hud.teams[0];
  const bottomTeam = hud.teams.find((team) => team !== topTeam) ?? hud.teams[1];

  const teamView = (team: HudTeamView): ScoreboardTeamView => {
    const bucket: Role = showingOtherSide ? otherRole(team.role) : team.role;
    const side = hudSideForRole(team.role);
    // Money is the viewer's own team only (match.snapshot never carries the enemy's) and only for the current side.
    const showMoney = team.relation === "viewer" && !showingOtherSide;
    const sortable = team.players.map((player, index): SortableRow => {
      const scoreboardPlayer = statsById.get(player.player_id);
      const stats = scoreboardPlayer?.[bucket] ?? EMPTY_STATS;
      const money = showMoney ? moneyOf(player) : null;
      const values = Object.fromEntries(
        (["money", "kills", "deaths", "assists", "hsp", "mvps", "utilitydamage", "enemiesflashed", "kdr", "adr", "damage"] as const)
          .map((stat) => [stat, statValue(stat, stats, bucket, money)]),
      ) as Record<ScoreboardStat, number>;
      const bot = scoreboardPlayer?.is_bot ?? false;
      const row: ScoreboardRowView = {
        playerId: player.player_id,
        name: player.display_name,
        avatarUrl: player.avatar_url ?? DEFAULT_AVATAR_BY_SIDE[side],
        fallbackAvatarUrl: DEFAULT_AVATAR_BY_SIDE[side],
        slotColor: slotColors[player.player_id] ?? "#ffffff",
        state: hudPlayerState(player),
        local: player.player_id === localPlayerId,
        bot,
        ping: bot || scoreboardPlayer?.ping_ms == null ? "" : String(scoreboardPlayer.ping_ms),
        mvps: stats.mvps,
        cells: columns.map(({ stat }) => ({ stat, text: statText(stat, values[stat]) })),
      };
      return { row, online: player.is_online, index, values };
    });
    const alive = team.players.filter((player) => player.is_online && player.is_alive).length;
    return {
      teamId: team.teamId,
      role: team.role,
      side,
      score: team.score,
      sideName: SCOREBOARD_SIDE_NAMES[team.role],
      aliveLabel: `存活：${alive}/${team.players.length}`,
      rows: sortScoreboardRows(sortable, view.sortStat).map(({ row }) => row),
    };
  };

  return {
    modeName: board.mode_name,
    modeIcon: SCOREBOARD_MODE_ICONS[board.mode_icon],
    elapsed: formatScoreboardElapsed(scoreboardElapsedMs(frame, nowMs)),
    page: view.page,
    sideSwitchAvailable,
    showingOtherSide,
    sortStat: view.sortStat,
    columns,
    top: teamView(topTeam),
    bottom: teamView(bottomTeam),
    timeline: halftime === null ? null : selectTimeline(hud, frame, topTeam, bottomTeam, halftime),
  };
}

/** Rounds finished at this state: the current round counts once it ended. */
function roundsFinished(state: RoundState, round: number): number {
  return state === "RoundEnd" || state === "MatchEnd" ? round : Math.max(0, round - 1);
}

function selectTimeline(
  hud: Extract<RoundHudViewModel, { hasSnapshot: true }>,
  frame: ScoreboardFrame,
  topTeam: HudTeamView,
  bottomTeam: HudTeamView,
  halftime: number,
): ScoreboardTimelineView {
  const board = frame.snapshot;
  const results = new Map(board.rounds.map((round) => [round.round, round]));
  const finished = roundsFinished(hud.state, hud.round);
  // CS2 _UpdateRound: the earliest round each team could clinch; only the earlier one (both on a tie) gets the trophy.
  const topClinch = finished + board.score_to_win - topTeam.score;
  const bottomClinch = finished + board.score_to_win - bottomTeam.score;

  const slot = (round: number): ScoreboardRoundSlot => {
    const result = results.get(round);
    const future = round > finished;
    return {
      round,
      label: round % 5 === 0 ? String(round) : null,
      result: result && !future
        ? { position: result.winner_team_id === topTeam.teamId ? "top" : "bottom", role: result.winner_role, icon: SCOREBOARD_REASON_ICONS[result.reason] }
        : null,
      clinch: !future ? null
        : round === topClinch && topClinch <= bottomClinch ? "top"
          : round === bottomClinch && bottomClinch <= topClinch ? "bottom" : null,
      active: round <= finished + 1,
      pastClinch: future && (round > topClinch || round > bottomClinch),
    };
  };
  const rounds = Array.from({ length: board.max_rounds }, (_, index) => slot(index + 1));

  const wins = (teamId: TeamId, from: number, to: number) =>
    board.rounds.filter((round) => round.winner_team_id === teamId && round.round >= from && round.round <= to).length;
  // Each half's scores are coloured by the side the team played in that half.
  const swapped = hud.round > halftime;
  const firstTopRole = swapped ? otherRole(topTeam.role) : topTeam.role;
  const half = (from: number, to: number, topRole: Role): ScoreboardHalfScore => ({
    top: wins(topTeam.teamId, from, to),
    bottom: wins(bottomTeam.teamId, from, to),
    topRole,
    bottomRole: otherRole(topRole),
  });

  return {
    firstHalf: rounds.slice(0, halftime),
    secondHalf: rounds.slice(halftime),
    halfScores: [half(1, halftime, firstTopRole), half(halftime + 1, board.max_rounds, otherRole(firstTopRole))],
    lossBonus: board.loss_bonus === null ? null : { top: board.loss_bonus[topTeam.teamId], bottom: board.loss_bonus[bottomTeam.teamId] },
  };
}
