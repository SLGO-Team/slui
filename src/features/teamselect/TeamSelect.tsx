import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Role, TeamCommand } from "../../contracts";
import { useBackdropRef } from "../../platform/backdrop";
import { useClockSelector } from "../../shared/clock.ts";
import { useOverlayScale } from "../../shared/overlay.ts";
import { createTeamSelectCommand } from "./model";
import { closeCommandFor, commandForSide, teamSelectErrorAt, type TeamSelectRow, type TeamSelectSideView, type TeamSelectView } from "./presentation";
import "./TeamSelect.css";

const ASSETS = "/assets/teamselect";
const EMBLEM: Readonly<Record<Role, string>> = { ntf: "/assets/bottomhud/emblem-ntf.svg", scp: "/assets/bottomhud/emblem-scp.svg" };
/** The side's illustration in place of CS2's team models (public/assets/teamselect/SOURCES.md). */
const ART: Readonly<Record<Role, string>> = { ntf: `${ASSETS}/ntf-squad.webp`, scp: `${ASSETS}/scp-group.webp` };
/** CS2 key binds: 1 joins T (NTF), 2 joins CT (SCP). */
const SIDE_KEYS: Readonly<Record<string, Role>> = { Digit1: "ntf", Numpad1: "ntf", Digit2: "scp", Numpad2: "scp" };

export type TeamSelectProps = {
  view: TeamSelectView;
  onCommand(command: TeamCommand): void;
  /** Debug captures start with this side hovered; the mouse still moves the highlight (CS2's follows the mouse). */
  initialHover?: Role | null;
  /** Debug captures skip the opening fade. */
  still?: boolean;
};

function Mask({ src, className }: { src: string; className: string }) {
  return <span className={className} style={{ "--ts-mask": `url("${src}")` } as CSSProperties} aria-hidden="true" />;
}

function Avatar({ row }: { row: TeamSelectRow }) {
  const [failed, setFailed] = useState(false);
  return <img className="ts-row__avatar" src={failed ? row.fallbackAvatarUrl : row.avatarUrl} alt="" onError={() => setFailed(true)} />;
}

function SideColumn({ side, hovered }: { side: TeamSelectSideView; hovered: boolean }) {
  return (
    <div className={`ts-col ts-col--${side.role}`} data-hover={hovered || undefined}
      style={{ "--ts-color": side.color } as CSSProperties}>
      <span className="ts-icon" aria-hidden="true">
        <Mask className="ts-icon__emblem" src={EMBLEM[side.role]} />
      </span>
      <div className="ts-labels">
        <span className="ts-title">{side.title}</span>
        <span className="ts-subtitle">{side.subtitle}</span>
      </div>
      <div className="ts-list">
        {side.rows.map((row) => (
          <div key={row.playerId} className="ts-row" data-online={row.online}>
            <Avatar row={row} />
            <span className="ts-row__status" aria-hidden="true" />
            <span className="ts-row__name">{row.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorBanner({ error }: { error: TeamSelectView["error"] }) {
  const selectText = useCallback((nowMs: number) => teamSelectErrorAt(error, nowMs), [error]);
  const text = useClockSelector(selectText, Object.is);
  // The text stays while the banner fades out (CS2 `.team-select-error.hidden`, 0.25 s).
  const shown = useRef<string | null>(null);
  if (text !== null) shown.current = text;
  return (
    <div className="ts-error" data-visible={text !== null || undefined} role="alert">
      <Mask className="ts-error__icon" src={`${ASSETS}/warning.svg`} />
      <span className="ts-error__label">{shown.current}</span>
    </div>
  );
}

/**
 * CS2's team select menu (teamselectmenu.xml) over the live game: SLUI's world blur instead of the 3D scene and an
 * illustration per side instead of its models, a half per side with its top gradient, round team icon, title, player
 * count and roster, the action bar and the join error.
 * The plugin owns the session; every choice goes out as a command and the plugin's rules decide.
 */
export const TeamSelect = memo(function TeamSelect({ view, onCommand, initialHover = null, still = false }: TeamSelectProps) {
  const scale = useOverlayScale();
  const backdrop = useBackdropRef();
  const [hovered, setHover] = useState<Role | null>(initialHover);

  const send = useCallback((command: TeamCommand | null) => {
    if (command !== null && !view.pending) onCommand(command);
  }, [onCommand, view.pending]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      const role = SIDE_KEYS[event.code];
      if (role) {
        event.preventDefault();
        send(commandForSide(view, role));
      } else if (event.code === "Escape" || event.code === "KeyM") {
        event.preventDefault();
        send(closeCommandFor(view));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send, view]);

  const [ntf, scp] = view.sides;
  return (
    <section className="ts-overlay" aria-label="选择队伍" data-forced={view.forced || undefined} data-pending={view.pending || undefined}
      style={{ "--ts-scale": scale } as CSSProperties}>
      <div ref={backdrop} className="ts-backdrop" />
      {/* The illustrations stand in for CS2's 3D models, so the band darkens their feet as it does the scene. */}
      <div className="ts-canvas" aria-hidden="true">
        <span className="ts-ground" />
        {[ntf, scp].map((side) => (
          <img key={side.role} className={`ts-art ts-art--${side.role}`} src={ART[side.role]} alt="" draggable={false}
            data-hover={hovered === side.role || undefined} style={{ "--ts-color": side.color } as CSSProperties} />
        ))}
      </div>
      <div className="ts-band" />
      {[ntf, scp].map((side) => (
        <button key={side.role} type="button" className={`ts-half ts-half--${side.role}`} aria-label={`加入 ${side.title}`}
          data-hover={hovered === side.role || undefined} style={{ "--ts-gradient": side.gradient } as CSSProperties}
          onMouseEnter={() => setHover(side.role)} onMouseLeave={() => setHover((current) => current === side.role ? null : current)}
          onClick={() => send(commandForSide(view, side.role))} />
      ))}
      <div className="ts-canvas">
        <SideColumn side={ntf} hovered={hovered === "ntf"} />
        <SideColumn side={scp} hovered={hovered === "scp"} />
        <div className="ts-actions">
          {view.forced ? null : (
            <button type="button" className="ts-action" onClick={() => send(closeCommandFor(view))}>
              <Mask className="ts-action__icon ts-action__icon--cancel" src={`${ASSETS}/cancel.svg`} />
              <span className="ts-action__label">取消</span>
            </button>
          )}
          <button type="button" className="ts-action" onClick={() => send(createTeamSelectCommand("spectator"))}>
            <Mask className="ts-action__icon ts-action__icon--camera" src={`${ASSETS}/camera.svg`} />
            <span className="ts-action__label">观察</span>
          </button>
          <button type="button" className="ts-action" onClick={() => send(createTeamSelectCommand("auto"))}>
            <Mask className="ts-action__icon ts-action__icon--refresh" src={`${ASSETS}/refresh.svg`} />
            <span className="ts-action__label">自动选择</span>
          </button>
        </div>
        <ErrorBanner error={view.error} />
      </div>
      {still ? null : <div key={view.sessionId} className="ts-fade" aria-hidden="true" />}
    </section>
  );
});
