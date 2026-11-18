import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { ReplayCommand, ReplayDemo, Role } from "../../contracts";
import { useBackdropRef } from "../../platform/backdrop.ts";
import { useOverlayVisible } from "../../platform/overlayVisibility.ts";
import { useOverlayScale } from "../../shared/overlay.ts";
import { ROLE_COLORS } from "../../shared/roleColors.ts";
import type { RoundHudViewModel } from "../hud/model.ts";
import { createSeekPacer, killSeekPositionMs, REPLAY_KILL_LEAD_MS, REPLAY_STEP_MS, replayControl, replayPov, replayUnload } from "./commands.ts";
import {
  actionStartAt,
  currentRoundAt,
  cyclePlayer,
  highlightIntervalAt,
  nextKillAfter,
  REPLAY_HIGHLIGHT_FADE_MS,
  replayIntervalIndexAt,
  replayPlaybackOf,
  replayPlayerOrder,
  replayPlayerRows,
  replayPositionAt,
  replaySlotTeams,
  replayTimelineEvents,
  roundCountAt,
  timelineGeometry,
  type ReplayFeatureState,
  type ReplayPlayerRow,
} from "./model.ts";
import type { ReplayHighlights } from "./useReplayHighlights.ts";
import { formatDemoTime, formatSpeedLabel, REPLAY_SPEED_STOP_NORMAL, REPLAY_SPEED_STOPS, REPLAY_TEXT, speedStopFor } from "./presentation.ts";
import "./ReplayController.css";

// A manual React recreation of CS2's demo controller (panorama/layout/hud/huddemocontroller.xml / .css / .js, the
// current game version) on the overlay canvas; ids follow the Panorama ones. Design 11-07-demo-replay-slui §12 and
// 11-17-demo-replay-bar-fixes list what SLGO changes (10 s step, no tick or settings, the recordings button in the
// settings button's place, highlights driven by SLUI, the double-confirmed quit).

export type ReplayBarMode = "minimal" | "full";

export type ReplayControllerProps = {
  mode: ReplayBarMode;
  replay: ReplayFeatureState;
  hud: RoundHudViewModel;
  catalogOpen: boolean;
  highlights: ReplayHighlights;
  /** How long until the command budget allows another command (the seek pacer waits for it). */
  commandWaitMs(): number;
  onCommand(command: ReplayCommand, seekMs?: number | null): void;
  onToggleCatalog(): void;
  /** Esc with nothing else to close: back to the minimal bar. */
  onLeaveFull(): void;
};

const STEP_SECONDS = REPLAY_STEP_MS / 1_000;
/** #Slider #SliderThumb width (Panorama HorizontalSlider): the travel is the track minus it. */
const THUMB_PX = 16;
const SPEED_THUMB_PX = 16;
const QUIT_CONFIRM_MS = 3_000;

/** `text` PLAY_TIP: the play button's, read when drawn (CS2 `ShowPlayButtonTooltip` updates it on a click). */
type Tooltip = { text: string; x: number; y: number };
type TipHandlers = { onMouseEnter(event: ReactMouseEvent<HTMLElement>): void; onMouseLeave(): void };
const PLAY_TIP = "play";
type Popup = "players" | "round" | null;

/** The element's box in canvas units (the canvas is scaled by the overlay scale). */
function canvasBox(element: Element, canvas: HTMLElement | null, scale: number) {
  const box = element.getBoundingClientRect();
  const origin = canvas?.getBoundingClientRect() ?? { left: 0, top: 0 };
  return { left: (box.left - origin.left) / scale, top: (box.top - origin.top) / scale, width: box.width / scale, height: box.height / scale };
}

export const ReplayController = memo(function ReplayController({ mode, replay, hud, catalogOpen, highlights, commandWaitMs, onCommand, onToggleCatalog, onLeaveFull }: ReplayControllerProps) {
  const scale = useOverlayScale();
  const visible = useOverlayVisible();
  const full = mode === "full";
  const canvasRef = useRef<HTMLDivElement>(null);
  const contents = useBackdropRef();
  const current = replay.current?.state ?? null;
  const demo: ReplayDemo | null = current?.demo ?? null;
  const povSlot = current?.pov_slot ?? null;
  // The playback shown: optimistic while play / pause / speed commands are on their way (no snap back).
  const playback = useMemo(() => replayPlaybackOf(replay), [replay]);
  const paused = playback === null || !playback.playing;
  const highlightsOn = highlights.active;

  // --- Position: painted every animation frame while playing (never through React state) -------------------------
  const sliderRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const roundRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const positionNow = useCallback(() => replayPositionAt(replay, Date.now()), [replay]);
  const paint = useCallback(() => {
    const position = positionNow();
    if (!demo || !position) return;
    const positionMs = dragRef.current ?? position.positionMs;
    sliderRef.current?.style.setProperty("--replay-progress", String(Math.min(1, Math.max(0, positionMs / Math.max(1, demo.duration_ms)))));
    if (timeRef.current) timeRef.current.textContent = `${formatDemoTime(positionMs)} / ${formatDemoTime(demo.duration_ms)}`;
    if (roundRef.current) roundRef.current.textContent = String(roundCountAt(demo.timeline, positionMs));
  }, [demo, positionNow]);
  useLayoutEffect(paint);
  const running = !paused && visible && !dragging;
  useEffect(() => {
    if (!running) return undefined;
    let frame = 0;
    const tick = () => {
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paint, running]);

  // --- Seeks: drags send on release; steps are merged (≤ 2 seeks a second, within the command budget) --------------
  const positionRef = useRef(positionNow);
  positionRef.current = positionNow;
  const waitRef = useRef(commandWaitMs);
  waitRef.current = commandWaitMs;
  const pacer = useMemo(() => createSeekPacer({
    now: Date.now,
    waitMs: () => waitRef.current(),
    schedule(callback, ms) {
      const timer = window.setTimeout(callback, ms);
      return () => window.clearTimeout(timer);
    },
    send(seek) {
      const position = positionRef.current();
      const target = "position_ms" in seek ? seek.position_ms : (position?.positionMs ?? 0) + seek.delta_ms;
      const clamped = position ? Math.min(position.durationMs, Math.max(0, target)) : null;
      onCommand(replayControl({ action: "seek", ...seek } as Parameters<typeof replayControl>[0]), clamped);
    },
  }), [onCommand]);
  useEffect(() => () => pacer.cancel(), [pacer]);

  // --- Timeline geometry -------------------------------------------------------------------------------------------
  const geometry = useMemo(() => demo ? timelineGeometry(demo, replaySlotTeams(demo, hud)) : null, [demo, hud]);
  const events = useMemo(() => demo ? replayTimelineEvents(demo, povSlot) : [], [demo, povSlot]);
  const fractionAt = useCallback((clientX: number) => {
    const slider = sliderRef.current;
    if (!slider) return 0;
    const box = slider.getBoundingClientRect();
    const thumb = THUMB_PX * scale;
    return Math.min(1, Math.max(0, (clientX - box.left - thumb / 2) / Math.max(1, box.width - thumb)));
  }, [scale]);
  const onSliderDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!full || !demo || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = fractionAt(event.clientX) * demo.duration_ms;
    setDragging(true);
    paint();
  };
  const onSliderMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null || !demo) return;
    dragRef.current = fractionAt(event.clientX) * demo.duration_ms;
    paint();
  };
  const finishDrag = (send: boolean) => {
    const target = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (send && target !== null) pacer.seekTo(Math.round(target));
    paint();
  };

  // --- Popups, tooltip, quit confirmation -------------------------------------------------------------------------
  const [popup, setPopup] = useState<{ kind: Popup; left: number; width?: number }>({ kind: null, left: 0 });
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [quitArmed, setQuitArmed] = useState(false);
  useEffect(() => {
    if (!quitArmed) return undefined;
    const timer = window.setTimeout(() => setQuitArmed(false), QUIT_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [quitArmed]);
  // Leaving the full bar drops its transient state; a drag in progress is cancelled, never sent.
  useEffect(() => {
    if (full) return;
    setPopup({ kind: null, left: 0 });
    setTooltip(null);
    setQuitArmed(false);
    dragRef.current = null;
    setDragging(false);
  }, [full]);
  const tip = (text: string): TipHandlers => ({
    onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => {
      const box = canvasBox(event.currentTarget, canvasRef.current, scale);
      setTooltip({ text, x: box.left + box.width / 2, y: box.top });
    },
    onMouseLeave: () => setTooltip(null),
  });
  const openPopup = (kind: Exclude<Popup, null>, anchor: Element, end?: Element) => {
    if (popup.kind === kind) return setPopup({ kind: null, left: 0 });
    const box = canvasBox(anchor, canvasRef.current, scale);
    const right = end ? canvasBox(end, canvasRef.current, scale) : null;
    setPopup({ kind, left: box.left, width: right ? right.left + right.width - box.left : undefined });
    setTooltip(null);
  };

  // --- Players ------------------------------------------------------------------------------------------------------
  const groups = useMemo(() => demo ? replayPlayerRows(demo, hud, povSlot) : [], [demo, hud, povSlot]);
  const order = useMemo(() => replayPlayerOrder(groups), [groups]);
  // SLGO's faction colours (SCP red, NTF blue) where CS2 colours the names CT / T.
  const roleOf = useMemo(() => {
    const roles = new Map<number, Role>();
    for (const group of groups) if (group.role) for (const row of group.rows) roles.set(row.slot, group.role);
    return roles;
  }, [groups]);
  const watched = order.find((row) => row.slot === povSlot) ?? null;
  const lastPovRef = useRef<number | null>(null);
  if (povSlot !== null) lastPovRef.current = povSlot;
  const spectate = useCallback((slot: number | null) => {
    if (slot !== povSlot) onCommand(replayPov(slot));
  }, [onCommand, povSlot]);

  // --- Actions --------------------------------------------------------------------------------------------------------
  const position = () => positionNow()?.positionMs ?? 0;
  const setSpeedStop = useCallback((stop: number) => {
    const speed = REPLAY_SPEED_STOPS[stop];
    if (!playback) return;
    if (speed === 0) {
      if (playback.playing) onCommand(replayControl({ action: "pause" }));
      return;
    }
    if (speed !== playback.speed) onCommand(replayControl({ action: "speed", speed }));
    if (!playback.playing) onCommand(replayControl({ action: "play" }));
  }, [onCommand, playback]);
  // CS2 OnPlayClicked: paused -> 1x and play; playing -> pause. At the end SLGO restarts from the beginning.
  const onPlay = useCallback(() => {
    const now = positionNow();
    if (!now) return;
    if (now.atEnd) {
      onCommand(replayControl({ action: "seek", position_ms: 0 }), 0);
      onCommand(replayControl({ action: "play" }));
      return;
    }
    setSpeedStop(now.playing ? 0 : REPLAY_SPEED_STOP_NORMAL);
  }, [onCommand, positionNow, setSpeedStop]);
  const rounds = demo?.timeline.rounds ?? [];
  const stepRound = useCallback((step: 1 | -1) => {
    if (!demo) return;
    const starts: { round: number; atMs: number }[] = [];
    for (const mark of demo.timeline.rounds) if (starts[starts.length - 1]?.round !== mark.round) starts.push({ round: mark.round, atMs: mark.at_ms });
    if (starts.length === 0) return;
    const at = positionNow()?.positionMs ?? 0;
    const index = starts.findIndex((start) => start.atMs > at) - 1;
    const currentIndex = index < -1 ? starts.length - 1 : index;
    // CS2 OnStepInterval: the neighbouring interval, clamped to the first and the last.
    const target = starts[Math.min(starts.length - 1, Math.max(0, currentIndex + step))];
    onCommand(replayControl({ action: "round", round: target.round }), target.atMs);
  }, [demo, onCommand, positionNow]);
  // Highlights mode (CS2 `bIsPlayingHighlights`): the round controls step through the highlight intervals.
  const stepHighlight = (step: -1 | 0 | 1) => {
    const list = highlights.intervals;
    if (list.length === 0) return;
    const index = replayIntervalIndexAt(list, position());
    pacer.seekTo(list[Math.min(list.length - 1, Math.max(0, index + step))].startMs);
  };
  const restartRound = () => {
    if (!demo) return;
    const round = currentRoundAt(demo.timeline, position());
    if (round === null) pacer.seekTo(demo.timeline.warmup?.start_ms ?? 0);
    else onCommand(replayControl({ action: "round", round }), demo.timeline.rounds.find((mark) => mark.round === round)?.at_ms ?? null);
  };
  const nextEvent = () => {
    if (!demo) return;
    if (highlightsOn) {
      // CS2 OnGotoNextHighlightEvent: the watched player's next kill or death, 2 s before it, without changing player.
      const at = position();
      const next = events.find((event) => event.atMs - REPLAY_KILL_LEAD_MS > at);
      if (next) pacer.seekTo(killSeekPositionMs(next.atMs));
      return;
    }
    const next = nextKillAfter(demo.timeline, position(), REPLAY_KILL_LEAD_MS);
    if (!next) return;
    pacer.seekTo(next.seekMs);
    if (next.killerSlot !== null) spectate(next.killerSlot);
  };
  const toggleCamera = () => {
    if (povSlot !== null) return spectate(null);
    const selectable = order.filter((row) => row.selectable);
    const previous = selectable.find((row) => row.slot === lastPovRef.current);
    const target = previous ?? selectable[0];
    if (target) spectate(target.slot);
  };
  const quit = () => {
    if (!quitArmed) return setQuitArmed(true);
    setQuitArmed(false);
    onCommand(replayUnload());
  };

  // --- Keys inside the console (fixed, design §5.2); the console holds the keyboard -------------------------------
  const keysRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keysRef.current = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (catalogOpen && event.key !== "Escape") return;
    const handled = (() => {
      switch (event.key) {
        case "Escape":
          if (dragRef.current !== null) finishDrag(false);
          else if (popup.kind !== null) setPopup({ kind: null, left: 0 });
          else if (catalogOpen) return false; // the catalog panel closes itself
          else onLeaveFull();
          return true;
        case " ": if (!event.repeat) onPlay(); return true;
        case "ArrowLeft": pacer.seekBy(-REPLAY_STEP_MS); return true;
        case "ArrowRight": pacer.seekBy(REPLAY_STEP_MS); return true;
        case "ArrowUp":
        case "ArrowDown": {
          if (!playback || event.repeat) return true;
          const stop = playback.playing ? speedStopFor(playback.speed) : 0;
          setSpeedStop(Math.min(REPLAY_SPEED_STOPS.length - 1, Math.max(0, stop + (event.key === "ArrowUp" ? 1 : -1))));
          return true;
        }
        case "PageUp": if (!event.repeat) { if (highlightsOn) stepHighlight(-1); else stepRound(-1); } return true;
        case "PageDown": if (!event.repeat) { if (highlightsOn) stepHighlight(1); else stepRound(1); } return true;
        case ".": if (!event.repeat) onCommand(replayControl({ action: "step" })); return true;
        default: return false;
      }
    })();
    if (handled) event.preventDefault();
  };
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (event: KeyboardEvent) => keysRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  // --- Status line (SLGO's own: CS2 has no load states) ------------------------------------------------------------
  const status = replay.notice?.text
    ?? (current?.loading ? REPLAY_TEXT.loading(current.loading.match_id) : null)
    ?? (current?.load_error ? REPLAY_TEXT.loadFailed(current.load_error.match_id, current.load_error.reason) : null)
    ?? (demo === null ? REPLAY_TEXT.noDemo : null);

  const speedStop = playback ? (playback.playing ? speedStopFor(playback.speed) : 0) : 0;
  const speedLabel = formatSpeedLabel(playback?.playing ? playback.speed : 0);
  const actionStart = demo ? actionStartAt(demo.timeline, position()) : null;
  const playerPrevRef = useRef<HTMLButtonElement>(null);
  const playerNextRef = useRef<HTMLButtonElement>(null);
  const disabled = demo === null;

  return (
    <section className="replay-overlay" aria-label="回放控制">
      <div ref={canvasRef} className="replay-canvas" data-mode={mode} data-highlights={highlightsOn || undefined} style={{ "--replay-scale": scale } as CSSProperties}>
        <div className="replay-root">
          {status ? <div className="replay-status" role="status">{status}</div> : null}
          {full && popup.kind === "players" ? (
            <div className="replay-popup replay-player-list" style={{ left: popup.left, width: popup.width }}>
              {order.map((row) => <PlayerEntry key={row.slot} row={row} role={roleOf.get(row.slot) ?? null}
                onSelect={() => { spectate(row.slot); setPopup({ kind: null, left: 0 }); }} />)}
            </div>
          ) : null}
          {full && popup.kind === "round" ? (
            <div className="replay-popup replay-round-menu" style={{ left: popup.left }}>
              {highlightsOn ? (
                <button type="button" className="replay-popup__entry" onClick={() => { stepHighlight(0); setPopup({ kind: null, left: 0 }); }}>{REPLAY_TEXT.highlightStart}</button>
              ) : <button type="button" className="replay-popup__entry" onClick={() => { restartRound(); setPopup({ kind: null, left: 0 }); }}>{REPLAY_TEXT.roundStart}</button>}
              {!highlightsOn && actionStart !== null ? (
                <button type="button" className="replay-popup__entry" onClick={() => { pacer.seekTo(actionStart); setPopup({ kind: null, left: 0 }); }}>{REPLAY_TEXT.actionStart}</button>
              ) : null}
            </div>
          ) : null}
          <div ref={contents} className="replay-contents">
            <div ref={sliderRef} className="replay-slider-row" data-dragging={dragging || undefined}
              onPointerDown={onSliderDown} onPointerMove={onSliderMove}
              onPointerUp={() => finishDrag(true)} onPointerCancel={() => finishDrag(false)}>
              <div className="replay-round-markers">
                {geometry?.warmup ? <span className="replay-round-marker replay-round-marker--warmup"
                  style={{ "--start": geometry.warmup.start, "--end": geometry.warmup.end } as CSSProperties} /> : null}
                {geometry?.rounds.map((band, index) => (
                  <span key={`${band.round}-${band.atMs}`} className={`replay-round-marker replay-round-marker--${index % 2 === 0 ? "even" : "odd"}`}
                    data-first={index === 0 && !geometry.warmup ? true : undefined} data-last={index === geometry.rounds.length - 1 ? true : undefined}
                    style={{ "--start": band.start, "--end": band.end } as CSSProperties} />
                ))}
              </div>
              {highlightsOn && demo ? (
                <div className="replay-highlight-markers">
                  {highlights.intervals.map((interval) => (
                    <span key={interval.startMs} className="replay-highlight-marker" style={{
                      "--start": interval.startMs / Math.max(1, demo.duration_ms), "--end": interval.endMs / Math.max(1, demo.duration_ms),
                    } as CSSProperties} />
                  ))}
                </div>
              ) : null}
              <div className="replay-highlight-icons">
                {events.map((event, index) => (
                  <button key={`${event.atMs}-${index}`} type="button" tabIndex={-1} className={`replay-highlight-icon replay-highlight-icon--${event.kind}`}
                    style={{ "--at": event.at } as CSSProperties} aria-label={event.kind === "kill" ? "击杀" : "死亡"}
                    onPointerDown={(pointer) => pointer.stopPropagation()}
                    onClick={() => pacer.seekTo(killSeekPositionMs(event.atMs))} />
                ))}
              </div>
              {demo ? <span className="replay-slider-thumb" /> : null}
            </div>
            {full ? (
              <div className="replay-control-row">
                <button type="button" className="replay-play" data-paused={paused || undefined} disabled={disabled}
                  aria-label={paused ? REPLAY_TEXT.tooltip.play : REPLAY_TEXT.tooltip.pause} onClick={onPlay} {...tip(PLAY_TIP)}>
                  <span className="replay-play__icon replay-play__icon--play" />
                  <span className="replay-play__icon replay-play__icon--pause" />
                </button>
                <div className="replay-speed">
                  <SpeedSlider stop={speedStop} disabled={disabled} scale={scale} onStop={setSpeedStop} />
                  <span className="replay-speed__label">{speedLabel}</span>
                </div>
                <div className="replay-time">
                  <span>{REPLAY_TEXT.timeLabel}</span>
                  <span ref={timeRef} className="replay-time__value" />
                </div>
                <div className="replay-group replay-time-controls">
                  <Interactive label={REPLAY_TEXT.minusSeconds(STEP_SECONDS)} disabled={disabled} tip={tip(REPLAY_TEXT.tooltip.stepBackward(STEP_SECONDS))}
                    onClick={() => pacer.seekBy(-REPLAY_STEP_MS)} />
                  <span className="replay-icon replay-icon--clock" aria-hidden="true" />
                  <Interactive label={REPLAY_TEXT.plusSeconds(STEP_SECONDS)} disabled={disabled} tip={tip(REPLAY_TEXT.tooltip.stepForward(STEP_SECONDS))}
                    onClick={() => pacer.seekBy(REPLAY_STEP_MS)} />
                </div>
                <div className="replay-group replay-round-controls">
                  <Interactive icon="skip" mirrored disabled={disabled || (highlightsOn ? highlights.intervals.length === 0 : rounds.length === 0)}
                    label={REPLAY_TEXT.tooltip.roundPrev} iconOnly tip={tip(REPLAY_TEXT.tooltip.roundPrev)}
                    onClick={() => highlightsOn ? stepHighlight(-1) : stepRound(-1)} />
                  <button type="button" className="replay-interactive replay-round-restart" disabled={disabled}
                    onClick={(event) => openPopup("round", event.currentTarget)}>
                    {/* CS2 #IntervalLabel: 「高光时刻」 with the number hidden in highlights mode. */}
                    <span>{highlightsOn ? REPLAY_TEXT.highlight : REPLAY_TEXT.round}</span>
                    <span ref={roundRef} className="replay-round-number" hidden={highlightsOn} />
                  </button>
                  <Interactive icon="skip" disabled={disabled || (highlightsOn ? highlights.intervals.length === 0 : rounds.length === 0)}
                    label={REPLAY_TEXT.tooltip.roundNext} iconOnly tip={tip(REPLAY_TEXT.tooltip.roundNext)}
                    onClick={() => highlightsOn ? stepHighlight(1) : stepRound(1)} />
                </div>
                <div className="replay-group replay-player-controls">
                  <button ref={playerPrevRef} type="button" className="replay-interactive replay-player-step" disabled={disabled} aria-label={REPLAY_TEXT.tooltip.playerPrev}
                    {...tip(REPLAY_TEXT.tooltip.playerPrev)} onClick={() => spectate(cyclePlayer(order, povSlot, -1))}>
                    <span className="replay-icon replay-icon--arrow" />
                  </button>
                  <button type="button" className="replay-interactive replay-player-name" disabled={disabled}
                    style={nameColor(watched ? roleOf.get(watched.slot) ?? null : null)} {...tip(REPLAY_TEXT.tooltip.playerList)}
                    onClick={(event) => playerPrevRef.current && playerNextRef.current ? openPopup("players", playerPrevRef.current, playerNextRef.current) : openPopup("players", event.currentTarget)}>
                    {watched?.name ?? REPLAY_TEXT.playerNone}
                  </button>
                  <button ref={playerNextRef} type="button" className="replay-interactive replay-player-step replay-player-step--next" disabled={disabled}
                    aria-label={REPLAY_TEXT.tooltip.playerNext} {...tip(REPLAY_TEXT.tooltip.playerNext)} onClick={() => spectate(cyclePlayer(order, povSlot, 1))}>
                    <span className="replay-icon replay-icon--arrow" />
                  </button>
                </div>
                <button type="button" className="replay-interactive replay-next-event" disabled={disabled} aria-label={REPLAY_TEXT.tooltip.nextEvent}
                  {...tip(REPLAY_TEXT.tooltip.nextEvent)} onClick={nextEvent}>
                  <span className="replay-icon replay-icon--double-arrows" />
                  <span className="replay-icon replay-icon--crosshair" />
                </button>
                <span className="replay-spacer" />
                <button type="button" className="replay-interactive replay-camera" disabled={disabled} {...tip(REPLAY_TEXT.tooltip.cameraMode)} onClick={toggleCamera}>
                  <span className="replay-icon replay-icon--camera" />
                  <span className="replay-camera__label">{povSlot === null ? REPLAY_TEXT.cameraFree : REPLAY_TEXT.cameraFirstPerson}</span>
                </button>
                <button type="button" className="replay-interactive replay-square replay-highlights" data-active={highlightsOn || undefined}
                  data-disabled={disabled || highlights.disabled || undefined} aria-label={REPLAY_TEXT.tooltip.highlights} aria-pressed={highlightsOn}
                  {...tip(REPLAY_TEXT.tooltip.highlights)} onClick={() => { if (!disabled && !highlights.disabled) highlights.toggle(); }}>
                  <span className="replay-icon replay-icon--film" />
                </button>
                {/* SLGO's recordings list where CS2 has its settings button (SLUI has no settings popup). */}
                <button type="button" className="replay-interactive replay-square replay-catalog-button" data-active={catalogOpen || undefined} aria-label={REPLAY_TEXT.tooltip.catalog}
                  {...tip(REPLAY_TEXT.tooltip.catalog)} onClick={onToggleCatalog}>
                  <span className="replay-icon replay-icon--list" />
                </button>
                <button type="button" className="replay-interactive replay-end" data-armed={quitArmed || undefined} disabled={disabled}
                  {...tip(REPLAY_TEXT.tooltip.endPlaybackAll)} onClick={quit}>
                  {quitArmed ? REPLAY_TEXT.quitConfirm : REPLAY_TEXT.quit}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {full && tooltip ? (
          <div className="replay-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            {tooltip.text === PLAY_TIP ? (paused ? REPLAY_TEXT.tooltip.play : REPLAY_TEXT.tooltip.pause) : tooltip.text}
          </div>
        ) : null}
      </div>
    </section>
  );
});

function Interactive({ label, icon, iconOnly, mirrored, disabled, tip, onClick }: {
  label: string;
  icon?: "skip";
  iconOnly?: boolean;
  mirrored?: boolean;
  disabled?: boolean;
  tip: TipHandlers;
  onClick(): void;
}): ReactNode {
  return (
    <button type="button" className={`replay-interactive${icon ? " replay-interactive--icon" : ""}`} disabled={disabled}
      aria-label={iconOnly ? label : undefined} onClick={onClick} {...tip}>
      {icon ? <span className={`replay-icon replay-icon--${icon}`} data-mirrored={mirrored || undefined} /> : label}
    </button>
  );
}

function nameColor(role: Role | null): CSSProperties | undefined {
  return role === null ? undefined : { "--replay-name-color": ROLE_COLORS[role] } as CSSProperties;
}

function PlayerEntry({ row, role, onSelect }: { row: ReplayPlayerRow; role: Role | null; onSelect(): void }) {
  return (
    <button type="button" className="replay-popup__entry replay-player-entry" style={nameColor(role)}
      data-dead={!row.alive || undefined} data-selected={row.isPov || undefined} disabled={!row.selectable} onClick={onSelect}>
      <span className="replay-player-entry__skull" aria-hidden="true" />
      <span className="replay-player-entry__name">{row.name}</span>
    </button>
  );
}

/**
 * CS2 #SpeedSliderContainer: a stop slider over its tick row (pause glyph, widening ticks, 1 / 2 / 4 arrows). Only the
 * slider strip (track and thumb) takes the pointer; the ticks are a label row, as in CS2. Like CS2's
 * `SliderValueChanged`, every new stop under the pointer applies at once; the bar then shows the optimistic playback,
 * so releasing never snaps back.
 */
function SpeedSlider({ stop, disabled, scale, onStop }: { stop: number; disabled: boolean; scale: number; onStop(stop: number): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? stop;
  const choose = (next: number) => {
    setPreview(next);
    if (next !== shown) onStop(next);
  };
  const last = REPLAY_SPEED_STOPS.length - 1;
  const stopAt = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return stop;
    const thumb = SPEED_THUMB_PX * scale;
    return Math.round(Math.min(1, Math.max(0, (clientX - box.left - thumb / 2) / Math.max(1, box.width - thumb))) * last);
  };
  return (
    <div ref={ref} className="replay-speed__slider" data-disabled={disabled || undefined} style={{ "--stop": shown / last } as CSSProperties}>
      <div className="replay-speed__ticks" aria-hidden="true">
        {REPLAY_SPEED_STOPS.map((speed, index) => (
          <span key={speed} className="replay-speed__tick" style={{ "--at": index / last } as CSSProperties}>
            {speed === 0 ? <span className="replay-speed__pause" />
              : speed >= 1 ? Array.from({ length: speed }, (_, arrow) => <span key={arrow} className="replay-speed__arrow" />)
                : <span className="replay-speed__bar" style={{ width: index }} />}
          </span>
        ))}
      </div>
      <span className="replay-speed__track" />
      <span className="replay-speed__thumb" />
      <span className="replay-speed__hit"
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          choose(stopAt(event.clientX));
        }}
        onPointerMove={(event) => { if (preview !== null) choose(stopAt(event.clientX)); }}
        onPointerUp={() => setPreview(null)}
        onPointerCancel={() => setPreview(null)} />
    </div>
  );
}

/**
 * CS2 `demo_highlight_fade_duration` (0.25 s): black over the game before a highlight jump and back after it, under
 * every HUD element. Painted per frame from the playback position while highlights play; clear when paused.
 */
export function ReplayHighlightFade({ replay, highlights }: { replay: ReplayFeatureState; highlights: ReplayHighlights }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useOverlayVisible();
  const running = highlights.active && highlights.intervals.length > 0 && visible;
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    if (!running) {
      element.style.opacity = "0";
      return undefined;
    }
    const list = highlights.intervals;
    let frame = 0;
    const tick = () => {
      const position = replayPositionAt(replay, Date.now());
      let opacity = 0;
      if (position !== null && position.playing) {
        const index = highlightIntervalAt(list, position.positionMs);
        const speed = Math.max(0.01, position.speed);
        if (index < 0) opacity = 1;
        else {
          const sinceStart = (position.positionMs - list[index].startMs) / speed;
          const untilEnd = (list[index].endMs - position.positionMs) / speed;
          const fadeIn = 1 - sinceStart / REPLAY_HIGHLIGHT_FADE_MS;
          const fadeOut = index + 1 < list.length ? 1 - untilEnd / REPLAY_HIGHLIGHT_FADE_MS : 0;
          opacity = Math.min(1, Math.max(0, fadeIn, fadeOut));
        }
      }
      element.style.opacity = String(opacity);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [highlights.intervals, replay, running]);
  return <div ref={ref} className="replay-highlight-fade" aria-hidden="true" />;
}
