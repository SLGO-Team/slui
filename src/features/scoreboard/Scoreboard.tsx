import { useRef, useState, type CSSProperties } from "react";
import { useBackdropRegion } from "../../platform/backdrop";
import { ROLE_COLORS } from "../../shared/roleColors.ts";
import { useOverlayScale } from "../../shared/overlay.ts";
import type { ScoreboardMode, ScoreboardStat } from "./model.ts";
import {
  SCOREBOARD_TROPHY_ICON,
  type ScoreboardColumn,
  type ScoreboardHalfScore,
  type ScoreboardRoundSlot,
  type ScoreboardRowView,
  type ScoreboardTeamView,
  type ScoreboardTimelineView,
  type ScoreboardView,
} from "./presentation.ts";
import "./Scoreboard.css";

/** Row pitch at 1080p: 24px cells with 1px margins (Panorama `.sb-row`). */
const ROW_PITCH = 26;
const ICONS = {
  ping: "/assets/scoreboard/ping.svg",
  bot: "/assets/scoreboard/bot.svg",
  dead: "/assets/scoreboard/dead.svg",
  star: "/assets/scoreboard/star.svg",
  stats: "/assets/scoreboard/stats.svg",
  sideSwap: "/assets/scoreboard/side-swap.svg",
  emblem: { ntf: "/assets/bottomhud/emblem-ntf.svg", scp: "/assets/bottomhud/emblem-scp.svg" },
} as const;

const teamStyle = (role: ScoreboardTeamView["role"]) => ({ "--sb-team": ROLE_COLORS[role] }) as CSSProperties;

function Mask({ src, className }: { src: string; className: string }) {
  return <span className={className} style={{ "--sb-mask": `url("${src}")` } as CSSProperties} aria-hidden="true" />;
}

function Avatar({ row }: { row: ScoreboardRowView }) {
  const [failed, setFailed] = useState(false);
  return <span className="sb-cell sb-cell--avatar" style={{ "--sb-slot": row.slotColor } as CSSProperties}>
    <img src={failed ? row.fallbackAvatarUrl : row.avatarUrl} alt="" onError={() => setFailed(true)} />
  </span>;
}

function Row({ row, columns, sortStat, index }: { row: ScoreboardRowView; columns: readonly ScoreboardColumn[]; sortStat: ScoreboardStat; index: number }) {
  return <div className="sb-row" data-state={row.state} data-local={row.local || undefined} data-player-id={row.playerId}
    style={{ transform: `translateY(${index * ROW_PITCH}px)` }}>
    <span className="sb-cell sb-cell--status">{row.state === "dead" ? <Mask className="sb-icon sb-icon--dead" src={ICONS.dead} /> : null}</span>
    <span className="sb-cell sb-cell--ping">{row.bot ? <Mask className="sb-icon sb-icon--bot" src={ICONS.bot} /> : row.ping}</span>
    <span className="sb-cell sb-cell--flair" />
    <Avatar row={row} />
    <span className="sb-cell sb-cell--name"><span className="sb-name">{row.name}</span></span>
    {row.cells.map((cell, cellIndex) => {
      const { stat, width, align } = columns[cellIndex];
      return <span key={stat} className="sb-cell sb-cell--stat" data-stat={stat} data-sort={stat === sortStat || undefined}
        data-align={align} style={{ width }}>
        {stat === "mvps" ? (row.mvps > 0 ? <span className="sb-mvps"><Mask className="sb-icon sb-icon--star" src={ICONS.star} /><span className="sb-mvps__count">{row.mvps}</span></span> : null)
          : <span className="sb-value">{cell.text}</span>}
      </span>;
    })}
  </div>;
}

/** CS2 pauses re-sorting while the pointer is over a player row; new rows join at the end. */
function useStableOrder(rows: readonly ScoreboardRowView[], paused: boolean): readonly ScoreboardRowView[] {
  const order = useRef<readonly string[]>([]);
  if (!paused) {
    order.current = rows.map((row) => row.playerId);
    return rows;
  }
  const position = new Map(order.current.map((id, index) => [id, index]));
  const ordered = [...rows].sort((a, b) => (position.get(a.playerId) ?? Infinity) - (position.get(b.playerId) ?? Infinity));
  order.current = ordered.map((row) => row.playerId);
  return ordered;
}

function TeamBlock({ team, columns, sortStat, cursor }: { team: ScoreboardTeamView; columns: readonly ScoreboardColumn[]; sortStat: ScoreboardStat; cursor: boolean }) {
  const [hovered, setHovered] = useState(false);
  const rows = useStableOrder(team.rows, cursor && hovered);
  return <div className="sb-team" data-side={team.side} data-role={team.role} style={teamStyle(team.role)}>
    <div className="sb-team__info">
      <div className="sb-team__emblem">
        <Mask className="sb-icon sb-team__logo" src={ICONS.emblem[team.role]} />
        <span className="sb-team__score">{team.score}</span>
      </div>
      <span className="sb-team__name">{team.sideName}</span>
      <span className="sb-team__alive">{team.aliveLabel}</span>
    </div>
    <div className="sb-team__table" style={{ height: rows.length * ROW_PITCH }}
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      {rows.map((row) => <Row key={row.playerId} row={row} columns={columns} sortStat={sortStat}
        index={rows.indexOf(row)} />)}
    </div>
  </div>;
}

function Labels({ columns, sortStat, cursor, onSort }: { columns: readonly ScoreboardColumn[]; sortStat: ScoreboardStat; cursor: boolean; onSort(stat: ScoreboardStat): void }) {
  return <div className="sb-labels">
    <span className="sb-cell sb-cell--status" />
    <span className="sb-cell sb-cell--ping"><Mask className="sb-icon sb-icon--ping" src={ICONS.ping} /></span>
    <span className="sb-cell sb-cell--flair" />
    <span className="sb-cell sb-cell--avatar" />
    <span className="sb-cell sb-cell--name" />
    {columns.map(({ stat, label, width }) => <button key={stat} type="button" className="sb-cell sb-label" data-stat={stat}
      data-sort={stat === sortStat || undefined} style={{ width }} disabled={!cursor} tabIndex={-1} onClick={() => onSort(stat)}>
      <span className="sb-label__text">{label}</span>
    </button>)}
  </div>;
}

function HalfScores({ scores }: { scores: readonly [ScoreboardHalfScore, ScoreboardHalfScore] }) {
  const labels = ["前半场", "后半场"];
  return <div className="sb-timeline__halves">
    {scores.map((half, index) => <div key={labels[index]} className="sb-timeline__half">
      <span className="sb-timeline__half-score" style={{ color: ROLE_COLORS[half.topRole] }}>{half.top}</span>
      <span className="sb-timeline__phase">{labels[index]}</span>
      <span className="sb-timeline__half-score" style={{ color: ROLE_COLORS[half.bottomRole] }}>{half.bottom}</span>
    </div>)}
  </div>;
}

function RoundSlot({ slot }: { slot: ScoreboardRoundSlot }) {
  const result = slot.result;
  const winnerStyle = result ? teamStyle(result.role) : undefined;
  const mark = (position: "top" | "bottom") => {
    if (result?.position === position) {
      return <span className="sb-round__result sb-round__result--won" style={winnerStyle}><Mask className="sb-icon sb-round__icon" src={result.icon} /></span>;
    }
    if (slot.clinch === position) {
      return <span className="sb-round__result sb-round__result--clinch"><Mask className="sb-icon sb-round__icon" src={SCOREBOARD_TROPHY_ICON} /></span>;
    }
    return null;
  };
  return <div className="sb-round" data-round={slot.round} data-active={slot.active || undefined} data-past-clinch={slot.pastClinch || undefined}>
    <div className="sb-round__team sb-round__team--top">{mark("top")}</div>
    <span className="sb-round__tick" style={winnerStyle} data-won={result ? true : undefined} />
    <div className="sb-round__team sb-round__team--bottom">{mark("bottom")}</div>
    {slot.label ? <span className="sb-round__label" style={winnerStyle} data-won={result ? true : undefined}>{slot.label}</span> : null}
  </div>;
}

function LossBonus({ levels, top, bottom }: { levels: NonNullable<ScoreboardTimelineView["lossBonus"]>; top: ScoreboardTeamView; bottom: ScoreboardTeamView }) {
  const pips = (lit: number, team: ScoreboardTeamView, position: "top" | "bottom") => <span className={`sb-loss__pips sb-loss__pips--${position}`} style={teamStyle(team.role)}>
    {[1, 2, 3, 4].map((level) => <span key={level} className="sb-loss__pip" data-lit={level <= lit || undefined} />)}
  </span>;
  return <div className="sb-loss">
    {pips(levels.top, top, "top")}
    <span className="sb-loss__label">战败补偿</span>
    {pips(levels.bottom, bottom, "bottom")}
  </div>;
}

function Timeline({ timeline, top, bottom }: { timeline: ScoreboardTimelineView; top: ScoreboardTeamView; bottom: ScoreboardTeamView }) {
  return <div className="sb-timeline">
    <HalfScores scores={timeline.halfScores} />
    <div className="sb-timeline__rounds">
      <div className="sb-timeline__segments">
        {timeline.firstHalf.map((slot) => <RoundSlot key={slot.round} slot={slot} />)}
        <span className="sb-timeline__divider" />
        {timeline.secondHalf.map((slot) => <RoundSlot key={slot.round} slot={slot} />)}
      </div>
    </div>
    {timeline.lossBonus ? <LossBonus levels={timeline.lossBonus} top={top} bottom={bottom} /> : null}
  </div>;
}

export type ScoreboardProps = {
  view: ScoreboardView;
  mode: Exclude<ScoreboardMode, "hidden">;
  onSort(stat: ScoreboardStat): void;
  onCyclePage(): void;
  onToggleSide(): void;
};

/**
 * CS2's competitive scoreboard (scoreboard.xml / scoreboard.css, measured against the user's captures in the task
 * research `cs2-scoreboard-layout.md`) on the 1920x1080 overlay canvas: shown while the scoreboard key is held; in
 * cursor mode (`.mouse-active`) the headers sort and the buttons switch the stats page and the side shown.
 */
export function Scoreboard({ view, mode, onSort, onCyclePage, onToggleSide }: ScoreboardProps) {
  const scale = useOverlayScale();
  const cursor = mode === "cursor";
  const panel = useRef<HTMLElement>(null);
  // CSGOScoreboard has `world-blur: hudWorldBlur`; its 5 px corners are nearest DWM's small rounding.
  useBackdropRegion(panel, "small");
  return <div className="scoreboard-overlay" data-mode={mode}>
    <div className="scoreboard-canvas" style={{ "--scoreboard-scale": scale } as CSSProperties}>
      <section ref={panel} className="scoreboard" aria-label="计分板" data-page={view.page}>
        <header className="sb-meta">
          <div className="sb-meta__row sb-meta__row--title">
            <img className="sb-meta__logo" src={view.logo} alt="" />
            <span className="sb-meta__mode">{view.modeName}</span>
            <span className="sb-meta__time">{view.elapsed}</span>
          </div>
          <div className="sb-meta__row sb-meta__row--buttons">
            {view.showingOtherSide ? <span className="sb-meta__other-side">上半场</span> : null}
            <div className="sb-meta__buttons">
              {view.sideSwitchAvailable ? <button type="button" className="sb-meta__button" data-active={view.showingOtherSide || undefined}
                title="切换上半场 / 当前阵营数据" disabled={!cursor} tabIndex={-1} onClick={onToggleSide}>
                <Mask className="sb-icon sb-meta__button-icon" src={ICONS.sideSwap} />
              </button> : null}
              <button type="button" className="sb-meta__button" title="切换统计数据" disabled={!cursor} tabIndex={-1} onClick={onCyclePage}>
                <Mask className="sb-icon sb-meta__button-icon" src={ICONS.stats} />
              </button>
            </div>
          </div>
        </header>
        <Labels columns={view.columns} sortStat={view.sortStat} cursor={cursor} onSort={onSort} />
        <TeamBlock team={view.top} columns={view.columns} sortStat={view.sortStat} cursor={cursor} />
        {view.timeline ? <Timeline timeline={view.timeline} top={view.top} bottom={view.bottom} /> : <div className="sb-timeline sb-timeline--spacer" />}
        <TeamBlock team={view.bottom} columns={view.columns} sortStat={view.sortStat} cursor={cursor} />
        <div className="sb-spectators" />
        <footer className="sb-footer"><span className="sb-footer__hint">[MOUSE2] 启用光标</span></footer>
      </section>
    </div>
  </div>;
}
