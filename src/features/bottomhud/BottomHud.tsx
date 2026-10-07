import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { HudAmmo, HudKillKind, HudReserveIcon, Role } from "../../contracts/index.ts";
import { ROLE_COLORS } from "../../shared/roleColors.ts";
import { useOverlayScale } from "../../shared/overlay.ts";
import type { BottomHudView } from "./model.ts";
import {
  clipBarFraction,
  isLowClip,
  killCardsFor,
  MAX_FANNED_KILLS,
  odometerCells,
  odometerRows,
  ODOMETER_SYMBOLS,
  type KillCardPose,
  type KillCardsView,
  type KillCardView,
} from "./presentation.ts";
import "./BottomHud.css";

const ASSETS = "/assets/bottomhud";
const EMBLEM: Readonly<Record<Role, string>> = { ntf: `${ASSETS}/emblem-ntf.svg`, scp: `${ASSETS}/emblem-scp.svg` };
const PIP: Readonly<Record<HudKillKind, string>> = {
  default: `${ASSETS}/kill-pip-default.svg`,
  grenade: `${ASSETS}/kill-pip-grenade.svg`,
  shock: `${ASSETS}/kill-pip-shock.svg`,
};
const RESERVE_ICON: Readonly<Record<HudReserveIcon, string>> = {
  bullet: `${ASSETS}/reserve-bullet.svg`,
  shotgun_shell: `${ASSETS}/reserve-shotgun-shell.svg`,
  revolver_loader: `${ASSETS}/reserve-revolver-loader.svg`,
};

/** Panorama `on-kill` (0.7 s): brightness 6 for 30 %, then ease-out back to 1. */
const ON_KILL_KEYFRAMES: Keyframe[] = [
  { filter: "brightness(6)", offset: 0 },
  { filter: "brightness(6)", offset: 0.3, easing: "ease-out" },
  { filter: "brightness(1)", offset: 1 },
];
/** The circle's blurred fill reads light grey under `on-kill` (recording: white t0-250ms, normal by ~650ms). */
const DISC_FLASH_KEYFRAMES: Keyframe[] = [
  { opacity: 1, offset: 0 },
  { opacity: 1, offset: 0.36, easing: "ease-out" },
  { opacity: 0, offset: 0.93 },
  { opacity: 0, offset: 1 },
];
/** Panorama `jitter-number` on every shot (50 ms). */
const JITTER_KEYFRAMES: Keyframe[] = [
  { transform: "scale(1.15) translate(-3px, -4px)", filter: "brightness(3)" },
  { transform: "scale(1) translate(0, -2px)", filter: "brightness(5)", offset: 0.25 },
  { transform: "scale(1) translate(3px, 5px)", filter: "brightness(3)", offset: 0.5 },
  { transform: "none", filter: "brightness(1)" },
];
/** Panorama `reload` (0.3 s ease-in): the reserve icon drops out and comes back from above. */
const RELOAD_KEYFRAMES: Keyframe[] = [
  { transform: "translateY(0)", offset: 0 },
  { transform: "translateY(50px)", offset: 0.5 },
  { transform: "translateY(-50px)", offset: 0.5001 },
  { transform: "translateY(0)", offset: 1 },
];
/** Panorama `weapon--change` (0.1 s ease-in-out). */
const WEAPON_CHANGE_KEYFRAMES: Keyframe[] = [{ transform: "scale(0.75)" }, { transform: "scale(1)" }];

const animate = (element: Element | null, keyframes: Keyframe[], duration: number, easing = "linear") => {
  element?.animate(keyframes, { duration, easing });
};

/** Deterministic pseudo-random numbers for one burst's particles (the same kill always draws the same sparks). */
function seeded(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
}

type Burst = {
  id: number;
  count: number;
  /** Rotation of the new card (the light column follows it); 0 for the counter card. */
  pose: KillCardPose;
  /** The fan that collapses when the sixth kill turns it into the counter card. */
  collapsing: KillCardView[] | null;
};

/** White SLUI art drawn in the team colour through a mask (CS2 `hud-colorize-wash`). */
const art = (url: string) => ({ "--bhud-art": `url("${url}")` }) as CSSProperties;

const poseStyle = (pose: KillCardPose) => ({ "--bhud-card-x": `${pose.x}px`, "--bhud-card-y": `${pose.y}px`, "--bhud-card-deg": `${pose.deg}deg` }) as CSSProperties;

function KillCard({ card, fresh, top }: { card: KillCardView; fresh: boolean; top: boolean }) {
  return (
    <div className={`bhud-card${fresh ? " bhud-card--fresh" : ""}`} style={poseStyle(card.pose)} data-kill={card.index} data-kind={card.kind}>
      <span className="bhud-card__body" aria-hidden="true" />
      <span className="bhud-card__art" style={art(`${ASSETS}/${card.ace ? "kill-card-ace" : "kill-card"}.svg`)} aria-hidden="true" />
      {/* Only the top card's number shows; the next card covers the others in game. */}
      {card.ace || !top ? null : <span className="bhud-card__number">{card.index}</span>}
      <span className="bhud-card__art" style={art(PIP[card.kind])} aria-hidden="true" />
      <span className="bhud-card__flash" aria-hidden="true" />
    </div>
  );
}

function CounterCard({ count, kind, fresh, rising }: { count: number; kind: HudKillKind; fresh: boolean; rising: boolean }) {
  return (
    <div className={`bhud-card bhud-card--counter${fresh ? " bhud-card--fresh" : ""}${rising ? " bhud-card--rising" : ""}`}
      style={poseStyle({ x: 0, y: 0, deg: 0 })} data-kill={count} data-kind={kind}>
      <span className="bhud-card__body" aria-hidden="true" />
      <span className="bhud-card__art" style={art(`${ASSETS}/kill-card.svg`)} aria-hidden="true" />
      <span className="bhud-card__number">{count}</span>
      <span className="bhud-card__art" style={art(PIP[kind])} aria-hidden="true" />
      <span className="bhud-card__flash" aria-hidden="true" />
    </div>
  );
}

function KillCards({ cards, burst }: { cards: KillCardsView; burst: Burst | null }) {
  if (cards.mode === "none") return null;
  const collapsing = burst?.collapsing ?? null;
  return (
    <div className="bhud-kills" data-kills={cards.mode === "fan" ? cards.cards.length : cards.count}>
      <div className="bhud-kills__hand">
        {burst !== null && collapsing !== null ? collapsing.map((card) => (
          <div key={`c${burst.id}-${card.index}`} className="bhud-card-collapse">
            <KillCard card={card} fresh={false} top={card.index === collapsing.length} />
          </div>
        )) : null}
        {cards.mode === "fan"
          ? cards.cards.map((card) => (
            <KillCard key={card.index} card={card} fresh={burst !== null && burst.count === card.index} top={card.index === cards.cards.length} />
          ))
          : <CounterCard key={cards.count} count={cards.count} kind={cards.kind} fresh={burst !== null && burst.count === cards.count}
            rising={burst !== null && burst.count === cards.count && collapsing !== null} />}
      </div>
    </div>
  );
}

/** Light column, sparks and the flares along the strokes of one kill (particle systems in CS2, drawn shapes here). */
function KillBurst({ burst }: { burst: Burst }) {
  const random = seeded(burst.id * 97 + burst.count);
  const fanned = burst.count <= MAX_FANNED_KILLS;
  const sparks = fanned && burst.count >= 2 ? Array.from({ length: 6 + burst.count * 2 }, () => ({
    x: (random() * 2 - 1) * (60 + burst.count * 14),
    y: 4 + random() * 22,
    rise: 18 + random() * 46,
    delay: 60 + random() * 260,
    size: 2 + random() * 2.5,
  })) : [];
  const streaks = (count: number, reach: number, height: number) => Array.from({ length: count }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const along = random();
    return { x: side * (36 + along * reach), height: height * (0.25 + 0.75 * (1 - along) * random() + 0.15 * random()), delay: random() * 160 };
  });
  const skyline = fanned && burst.count >= 4 ? streaks(burst.count === 5 ? 34 : 22, burst.count === 5 ? 120 : 90, burst.count === 5 ? 46 : 32) : [];
  const ace = burst.count === MAX_FANNED_KILLS ? streaks(56, 250, 62) : [];
  return (
    <div className="bhud-burst" aria-hidden="true">
      {fanned ? (
        <div className="bhud-burst__column" style={poseStyle(burst.pose)}><span className="bhud-burst__beam" /></div>
      ) : null}
      {burst.collapsing ? <span className="bhud-burst__halo" /> : null}
      {sparks.map((spark, index) => (
        <span key={`s${index}`} className="bhud-burst__spark" style={{
          "--bhud-x": `${spark.x}px`, "--bhud-y": `${-spark.y}px`, "--bhud-rise": `${-spark.rise}px`,
          "--bhud-size": `${spark.size}px`, animationDelay: `${spark.delay}ms`,
        } as CSSProperties} />
      ))}
      {skyline.length > 0 ? <span className="bhud-burst__glow" /> : null}
      {skyline.map((streak, index) => (
        <span key={`k${index}`} className="bhud-burst__streak" style={{
          "--bhud-x": `${streak.x}px`, "--bhud-h": `${streak.height}px`, animationDelay: `${streak.delay + 200}ms`,
        } as CSSProperties} />
      ))}
      {ace.length > 0 ? <span className="bhud-burst__ace-glow" /> : null}
      {ace.map((streak, index) => (
        <span key={`a${index}`} className="bhud-burst__streak bhud-burst__streak--ace" style={{
          "--bhud-x": `${streak.x}px`, "--bhud-h": `${streak.height}px`, animationDelay: `${streak.delay + 2000}ms`,
        } as CSSProperties} />
      ))}
    </div>
  );
}

/** CS2 `DigitPanel` money: every character is a vertical strip that rolls straight to its new symbol. */
function Odometer({ balance }: { balance: number }) {
  const rows = odometerRows(balance, odometerCells(balance));
  // Keyed from the right, so a longer amount adds cells on the left and the others keep rolling.
  return (
    <span className="bhud-odometer" aria-label={`$${balance}`}>
      {rows.map((row, index) => (
        <span key={rows.length - index} className="bhud-odometer__cell">
          <span className="bhud-odometer__strip" style={{ transform: `translateY(${-row}em)` }}>
            {ODOMETER_SYMBOLS.map((symbol) => <span key={symbol} className="bhud-odometer__symbol">{symbol}</span>)}
          </span>
        </span>
      ))}
    </span>
  );
}

function Weapon({ ammo, still }: { ammo: HudAmmo; still: boolean }) {
  const blockRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const previous = useRef(ammo);
  useEffect(() => {
    const before = previous.current;
    previous.current = ammo;
    if (still || before === ammo) return;
    if (before.reserve_icon !== ammo.reserve_icon || before.clip_max !== ammo.clip_max) {
      animate(blockRef.current, WEAPON_CHANGE_KEYFRAMES, 100, "ease-in-out");
      return;
    }
    if (ammo.clip < before.clip) animate(clipRef.current, JITTER_KEYFRAMES, 50, "ease-out");
    else if (ammo.clip > before.clip && ammo.reserve < before.reserve) animate(iconRef.current, RELOAD_KEYFRAMES, 300, "ease-in");
  }, [ammo, still]);
  const low = isLowClip(ammo);
  return (
    <div ref={blockRef} className={`bhud-weapon${low ? " bhud-weapon--low" : ""}`} data-low={low ? "true" : undefined}>
      <div className="bhud-weapon__clip">
        {low ? <span className="bhud-weapon__clip-glow" aria-hidden="true">{ammo.clip}</span> : null}
        <span ref={clipRef} className="bhud-weapon__clip-label">{ammo.clip}</span>
        <span className="bhud-weapon__bar" aria-hidden="true">
          <span className="bhud-weapon__bar-fill" style={{ width: `${clipBarFraction(ammo) * 100}%` }} />
        </span>
      </div>
      <span className="bhud-weapon__reserve">{ammo.reserve}</span>
      <span className="bhud-weapon__icon-box">
        <span ref={iconRef} className="bhud-weapon__icon" style={art(RESERVE_ICON[ammo.reserve_icon])} aria-hidden="true" />
      </span>
    </div>
  );
}

function BottomHudRow({ view, still }: { view: BottomHudView; still: boolean }) {
  const litRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLSpanElement>(null);
  const [tracked, setTracked] = useState(() => ({ kills: view.kills, burst: null as Burst | null, seq: 0 }));
  // Derived during render, so the frame the kill arrives in already draws it. A first view or a shrinking
  // list (new round) never bursts.
  if (tracked.kills !== view.kills) {
    const grew = !still && view.kills.length > tracked.kills.length;
    let burst: Burst | null = null;
    if (grew) {
      const before = killCardsFor(tracked.kills);
      const after = killCardsFor(view.kills);
      const fresh = after.mode === "fan" ? after.cards[after.cards.length - 1] : null;
      burst = {
        id: tracked.seq + 1,
        count: view.kills.length,
        pose: fresh?.pose ?? { x: 0, y: 0, deg: 0 },
        collapsing: before.mode === "fan" && after.mode === "counter" ? before.cards : null,
      };
    } else if (view.kills.length === tracked.kills.length) {
      burst = tracked.burst;
    }
    setTracked({ kills: view.kills, burst, seq: grew ? tracked.seq + 1 : tracked.seq });
  }
  const burst = tracked.burst;
  useEffect(() => {
    if (burst === null) return;
    animate(litRef.current, ON_KILL_KEYFRAMES, 700);
    animate(discRef.current, DISC_FLASH_KEYFRAMES, 700);
  }, [burst]);

  const cards = killCardsFor(view.kills);
  return (
    <div className="bhud" data-role={view.role} data-still={still ? "true" : undefined}
      style={{ "--bhud-wash": ROLE_COLORS[view.role] } as CSSProperties}>
      <KillCards cards={cards} burst={burst} />
      {burst !== null ? <KillBurst key={burst.id} burst={burst} /> : null}
      <div ref={litRef} className="bhud__lit">
        <span className="bhud__stroke bhud__stroke--left" aria-hidden="true" />
        <span className="bhud__stroke bhud__stroke--right" aria-hidden="true" />
        <div className="bhud__balance"><Odometer balance={view.balance} /></div>
        <div className="bhud__center" aria-hidden="true">
          <span className="bhud__disc" />
          <span ref={discRef} className="bhud__disc-flash" />
          <span className="bhud__emblem" style={art(EMBLEM[view.role])} />
        </div>
        {view.ammo ? <Weapon ammo={view.ammo} still={still} /> : null}
      </div>
    </div>
  );
}

export type BottomHudProps = {
  view: BottomHudView | null;
  /** Debug captures: no motion, so a still frame is deterministic. */
  still?: boolean;
};

/**
 * CS2's bottom-centre health/ammo HUD (`hudhealthammocenter`) for SLGO: balance in the health slot, the
 * emblem with the round's kill cards, and the clip with its reserve rounds. Drawn on the 1920x1080 overlay
 * canvas; hidden while the local player is dead.
 */
export function BottomHud({ view, still = false }: BottomHudProps) {
  const scale = useOverlayScale();
  return (
    <section className="bhud-overlay" aria-label="底部状态栏">
      <div className="bhud-canvas" style={{ "--bhud-scale": scale } as CSSProperties}>
        {view ? <BottomHudRow view={view} still={still} /> : null}
      </div>
    </section>
  );
}
