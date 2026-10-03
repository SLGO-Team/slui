import { type CSSProperties } from "react";
import {
  formatRoundClock,
  type HudPlayerView,
  type HudTeamView,
  type HudViewerPlayerView,
  type RoundHudViewModel,
} from "./model";
import {
  avatarSource,
  DEFAULT_AVATAR_BY_SIDE,
  HUD_GENERATOR_PULSE_SECONDS,
  hudAuxPower,
  hudHealthPercent,
  hudPlayerState,
  hudShieldPercent,
  hudSideForRole,
  PLAYER_COLORS,
  resolveHudTeams,
  type HudPresentationVariant,
  type HudSide,
  type TopHudArmor,
  type TopHudPlayerMeta,
  type TopHudPlayerMetaById,
} from "./presentation";
import { useOverlayScale } from "../../shared/overlay.ts";
import "./HudTeamCounter.css";

export type HudTeamCounterProps = {
  hud: RoundHudViewModel;
  playerMeta?: TopHudPlayerMetaById;
  variant?: HudPresentationVariant;
};

type PlayerSlotProps = {
  side: HudSide;
  index: number;
  meta?: TopHudPlayerMeta;
  showEquipment: boolean;
  shieldType: "ahp" | "hume";
  variant: HudPresentationVariant;
} & (
  | { player: HudViewerPlayerView; showHealth: true }
  | { player: HudPlayerView; showHealth: false }
);

const ARMOR_ICON_BY_TYPE: Readonly<Record<TopHudArmor, string>> = {
  light: "/assets/slui-svg/ArmorLight.svg",
  combat: "/assets/slui-svg/ArmorCombat.svg",
  heavy: "/assets/slui-svg/ArmorHeavy.svg",
};

function EquipmentSummary({ meta, armorEnabled }: { meta?: TopHudPlayerMeta; armorEnabled: boolean }) {
  const money = meta?.money !== undefined && Number.isFinite(meta.money)
    ? `$${Math.max(0, Math.trunc(meta.money))}`
    : null;
  const utility = meta?.utility ?? [];
  const visibleUtility = utility.slice(0, 8);
  const armorSource = armorEnabled && meta?.armor ? ARMOR_ICON_BY_TYPE[meta.armor] : null;
  const utilityClassName = visibleUtility.length > 4
    ? "hud-player__equipment-row hud-player__equipment-row--utility hud-player__equipment-row--utility-wrapped"
    : "hud-player__equipment-row hud-player__equipment-row--utility";

  return (
    <div className="hud-player__equipment">
      <div className="hud-player__equipment-background" aria-hidden="true">
        <span className="hud-player__equipment-blur" />
        <span className="hud-player__equipment-fill" />
      </div>
      <div className="hud-player__equipment-content">
        <div className="hud-player__equipment-row hud-player__equipment-row--money">
          {money ? (
            <div className={`hud-player__money${money.length >= 6 ? " hud-player__money--shrink" : ""}`}>
              {money}
            </div>
          ) : null}
        </div>
        {meta?.weapon ? (
          <div className="hud-player__equipment-row hud-player__equipment-row--weapon" title={meta.weapon.label}>
            <img src={meta.weapon.src} alt="" draggable={false} />
          </div>
        ) : <div className="hud-player__equipment-row hud-player__equipment-row--weapon" />}
        <div
          className={utilityClassName}
          aria-label={visibleUtility.map((item) => item.label).join(", ")}
        >
          {visibleUtility.map((item, index) => (
            <img key={`${item.src}-${index}`} src={item.src} alt="" draggable={false} />
          ))}
        </div>
        <div className="hud-player__equipment-row hud-player__equipment-row--special">
          {armorSource ? (
            <img className="hud-player__armor" src={armorSource} alt="" draggable={false} />
          ) : null}
          {meta?.hasC4 ? (
            <img className="hud-player__c4" src="/assets/slui-svg/KeycardNTFCommander.svg" alt="" draggable={false} />
          ) : null}
          {meta?.hasDefuser ? (
            <img className="hud-player__defuser" src="/assets/icons/wire-cutters.svg" alt="" draggable={false} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function KillFlags({ kills }: { kills: number }) {
  if (kills <= 0) return null;

  return (
    <div className="hud-player__kills" aria-label={`${kills} kills`}>
      {kills <= 5
        ? Array.from({ length: kills }, (_, index) => (
          <img key={index} className="hud-player__kill-flag" src="/assets/hud/skull.svg" alt="" draggable={false} />
        ))
        : (
          <>
            <img className="hud-player__kill-flag" src="/assets/hud/skull.svg" alt="" draggable={false} />
            <span className="hud-player__kills-count">x{kills}</span>
          </>
        )}
    </div>
  );
}

function PlayerSlot(props: PlayerSlotProps) {
  const { player, side, index, meta, showEquipment, shieldType, variant } = props;
  const state = hudPlayerState(player);
  const fallback = DEFAULT_AVATAR_BY_SIDE[side];
  const source = avatarSource(player, side);
  // An alive SCP-079 has no health or shield: its aux power takes the health bar's place.
  const aux = props.showHealth ? hudAuxPower(props.player) : null;
  const healthPercent = aux ? aux.percent : props.showHealth ? hudHealthPercent(props.player) : null;
  const shieldPercent = props.showHealth && !aux ? hudShieldPercent(props.player) : null;
  const healthUnknown = props.showHealth && healthPercent === null;
  const showShield = shieldPercent !== null && (shieldPercent > 0 || shieldType === "hume");
  // The detailed bars print the absolute values; the caps only scale the fill.
  const healthValue = aux ? aux.value : props.showHealth ? props.player.health ?? 0 : 0;
  const shieldValue = props.showHealth ? props.player.shield ?? 0 : 0;
  const style = {
    "--hud-player-color": PLAYER_COLORS[side][index % PLAYER_COLORS[side].length],
    ...(healthPercent === null ? {} : { "--hud-health": `${healthPercent}%` }),
    ...(shieldPercent === null ? {} : { "--hud-shield": `${shieldPercent}%` }),
  } as CSSProperties;

  return (
    <div
      className={`hud-player hud-player--${side} hud-player--${state} hud-player--${variant}${healthUnknown ? " hud-player--health-unknown" : ""}`}
      data-player-state={state}
      data-health={props.showHealth ? (healthUnknown ? "unknown" : "visible") : "hidden"}
      data-shield={showShield ? shieldType : "hidden"}
      data-variant={variant}
      style={style}
      title={`${player.display_name} - ${state}`}
    >
      <div className="hud-player__name">{player.display_name}</div>
      <div className="hud-player__portrait">
        <img className="hud-player__fallback" src={fallback} alt="" />
        {source !== fallback ? (
          <img
            key={source}
            className="hud-player__steam-avatar"
            src={source}
            alt=""
            draggable={false}
            onError={(event) => { event.currentTarget.hidden = true; }}
          />
        ) : null}
      </div>
      {props.showHealth ? (
        <div
          className={`hud-player__health${aux ? " hud-player__health--aux" : ""}`}
          aria-label={healthUnknown ? "Health unknown" : `${aux ? "Aux power" : "Health"} ${Math.round(healthValue)}`}
        >
          {healthUnknown ? (
            <span className="hud-player__health-unknown">?</span>
          ) : (
            <>
              <span className="hud-player__health-fill" />
              {variant === "detailed" && state === "alive" ? (
                <span className="hud-player__health-value">{Math.round(healthValue)}</span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {showShield ? (
        <div
          className={`hud-player__shield hud-player__shield--${shieldType}`}
          aria-label={`${shieldType === "hume" ? "Hume shield" : "AHP"} ${Math.round(shieldValue)}`}
        >
          <span />
          {variant === "detailed" && state === "alive" ? (
            <span className="hud-player__shield-value">{Math.round(shieldValue)}</span>
          ) : null}
        </div>
      ) : null}
      <KillFlags kills={player.kills} />
      {showEquipment ? <EquipmentSummary meta={meta} armorEnabled={side === "t"} /> : null}
    </div>
  );
}

function TeamPlayers({
  playerMeta,
  team,
  placement,
  variant,
}: {
  playerMeta?: TopHudPlayerMetaById;
  team: HudTeamView;
  placement: "left" | "right";
  variant: HudPresentationVariant;
}) {
  const side = hudSideForRole(team.role);
  const shieldType = team.role === "scp" ? "hume" : "ahp";
  return (
    <div
      className={`hud-team hud-team--${placement} hud-team--${side} hud-team--${team.relation}`}
      data-team-id={team.teamId}
      data-current-role={team.role}
    >
      {team.relation === "viewer"
        ? team.players.map((player, index) => (
          <PlayerSlot
            key={player.player_id}
            player={player}
            side={side}
            index={index}
            meta={playerMeta?.[player.player_id]}
            showEquipment
            shieldType={shieldType}
            showHealth
            variant={variant}
          />
        ))
        : team.players.map((player, index) => (
          <PlayerSlot
            key={player.player_id}
            player={player}
            side={side}
            index={index}
            meta={playerMeta?.[player.player_id]}
            showEquipment={false}
            shieldType={shieldType}
            showHealth={false}
            variant={variant}
          />
        ))}
    </div>
  );
}

type HudClockProps = Pick<
  Extract<RoundHudViewModel, { hasSnapshot: true }>,
  "clockMode" | "clockSeconds" | "generatorPulse" | "paused"
>;

function RoundClock({ clockMode, clockSeconds, generatorPulse, paused }: HudClockProps) {
  // The timer box keeps its size in every mode so the scores and counts never move.
  const warning = clockMode === "round" && clockSeconds <= 10 && !paused;
  const className = `hud-scoreboard__timer hud-scoreboard__timer--${clockMode}${warning ? " hud-scoreboard__timer--warning" : ""}`;
  if (clockMode === "hidden") return <div className={className} data-clock-mode={clockMode} />;
  if (clockMode === "generator") {
    // No digits: a red commander keycard blinking like CS2's planted bomb. Keyed by tier so the
    // animation only restarts when the blink speed changes, not on every clock tick.
    const pulse = generatorPulse ?? "slow";
    return (
      <div className={className} data-clock-mode={clockMode} data-generator-pulse={pulse}>
        <span
          key={pulse}
          className="hud-scoreboard__timer-keycard"
          style={{ animationDuration: `${HUD_GENERATOR_PULSE_SECONDS[pulse]}s` }}
          role="img"
          aria-label="发电机过载中"
        />
      </div>
    );
  }
  return (
    <div className={className} data-clock-mode={clockMode}>
      <span className="hud-scoreboard__timer-value">{formatRoundClock(clockSeconds)}</span>
      {clockMode === "pause" ? <span className="hud-scoreboard__timer-label">暂停</span> : null}
    </div>
  );
}

function PlayerCount({ side, alive }: { side: HudSide; alive: number }) {
  return (
    <span className={`hud-alive-count hud-alive-count--${side}`} title={`${alive} alive`}>
      <span className="hud-alive-count__person" aria-hidden="true" />
      <span>{alive}</span>
    </span>
  );
}

export function HudTeamCounter({ hud, playerMeta, variant = "compact" }: HudTeamCounterProps) {
  const scale = useOverlayScale();

  if (!hud.hasSnapshot) {
    return (
      <section className="hud-overlay" aria-label="Round status" data-hud-availability={hud.availability}>
        <div className="hud-design-canvas" style={{ "--hud-overlay-scale": scale } as CSSProperties}>
          <div className="hud-empty-state">{hud.statusLabel}</div>
        </div>
      </section>
    );
  }

  const teams = resolveHudTeams(hud);
  const leftSide = hudSideForRole(teams.left.role);
  const rightSide = hudSideForRole(teams.right.role);

  return (
    <section className="hud-overlay" aria-label="Round status" data-hud-availability={hud.availability}>
      <div className="hud-design-canvas" style={{ "--hud-overlay-scale": scale } as CSSProperties}>
        <div className={`hud-team-counter hud-team-counter--${variant}`} data-hud="team-counter" data-hud-variant={variant}>
          <TeamPlayers
            playerMeta={playerMeta}
            team={teams.left}
            placement="left"
            variant={variant}
          />
          <div className="hud-scoreboard">
            <RoundClock
              clockMode={hud.clockMode}
              clockSeconds={hud.clockSeconds}
              generatorPulse={hud.generatorPulse}
              paused={hud.paused}
            />
            <div className="hud-scoreboard__scores">
              <span className={`hud-score hud-score--${leftSide}`}>{teams.left.score}</span>
              <span className={`hud-score hud-score--${rightSide}`}>{teams.right.score}</span>
            </div>
            <div className="hud-scoreboard__counts">
              <PlayerCount side={leftSide} alive={teams.left.aliveCount} />
              <PlayerCount side={rightSide} alive={teams.right.aliveCount} />
            </div>
          </div>
          <TeamPlayers
            playerMeta={playerMeta}
            team={teams.right}
            placement="right"
            variant={variant}
          />
        </div>
      </div>
    </section>
  );
}
