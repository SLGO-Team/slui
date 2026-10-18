import { useState, type CSSProperties } from "react";
import { useOverlayScale } from "../../shared/overlay.ts";
import type { KillfeedNoticeView } from "./model.ts";
import { KILLFEED_HEADSHOT_ICON, KILLFEED_SUICIDE_ICON, type KillfeedPlayerView } from "./presentation.ts";
import "./KillFeed.css";

/** CS2 `.Available` -> shown: a new notice fades in over 0.2 s. A notice mounted later than that (replay, overlay re-enabled) just shows. */
const KILLFEED_ENTER_MS = 200;

function Name({ player }: { player: KillfeedPlayerView }) {
  return <span className="killfeed__name" style={{ color: player.color }}>{player.name}</span>;
}

type NoticeProps = { view: KillfeedNoticeView; still: boolean };

function Notice({ view, still }: NoticeProps) {
  const [mountedAtMs] = useState(Date.now);
  // The fade-out starts at the entry's own time, not on the next 250 ms UI tick; a negative delay starts it part-way.
  const style = { "--killfeed-fade-delay": `${view.fadeAtMs - mountedAtMs}ms` } as CSSProperties;
  const entering = !still && mountedAtMs - view.firstSeenAtMs < KILLFEED_ENTER_MS;
  const classes = [
    "killfeed__notice",
    view.viewer === "killer" ? "killfeed__notice--killer" : "",
    view.viewer === "victim" ? "killfeed__notice--victim" : "",
    still ? "" : "killfeed__notice--timed",
    entering ? "killfeed__notice--enter" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={classes} data-killfeed-entry={view.id} data-viewer={view.viewer ?? undefined} style={style}>
      <div className="killfeed__content">
        {view.killer ? <Name player={view.killer} /> : null}
        {view.assister ? (
          <>
            <span className="killfeed__plus">+</span>
            <Name player={view.assister} />
          </>
        ) : null}
        {view.weaponIcon ? <img className="killfeed__icon killfeed__weapon" src={view.weaponIcon} alt="" /> : null}
        {view.headshot ? <img className="killfeed__icon killfeed__headshot" src={KILLFEED_HEADSHOT_ICON} alt="" /> : null}
        {view.suicide ? <img className="killfeed__icon killfeed__suicide" src={KILLFEED_SUICIDE_ICON} alt="" /> : null}
        <Name player={view.victim} />
      </div>
    </div>
  );
}

export type KillFeedProps = {
  notices: readonly KillfeedNoticeView[];
  /** Debug captures: no enter or fade animation, so a still frame is deterministic. */
  still?: boolean;
};

/**
 * CS2 `CSGOHudDeathNotice` (huddeathnotice.xml / huddeathnotice.css) on the 1920x1080 overlay canvas: notices stack
 * down from the top-right corner, oldest on top.
 */
export function KillFeed({ notices, still = false }: KillFeedProps) {
  const scale = useOverlayScale();
  if (notices.length === 0) return null;
  return (
    <section className="killfeed-overlay" aria-label="击杀信息">
      <div className="killfeed-canvas" style={{ "--killfeed-scale": scale } as CSSProperties}>
        <div className="killfeed">
          {notices.map((view) => <Notice key={view.id} view={view} still={still} />)}
        </div>
      </div>
    </section>
  );
}
