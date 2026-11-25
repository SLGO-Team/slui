import { memo, useId, useMemo, type CSSProperties } from "react";
import { useOverlayScale } from "../../shared/overlay";
import { radarMarkerNumber, type MinimapViewModel, type RadarBombsite, type RadarKeycard } from "./model";
import type { MapGeometry } from "./resolver";
import { mapBlendLayers } from "./roomWash";
import { cameraToRadar, roomArtworkToWorld, type RadarMarker } from "./camera";
import { useMinimapView, type MinimapStore, type RadarControls, type RadarPreferences } from "./useMinimapFeature";
import { useBackdropRef } from "../../platform/backdrop";
import { PLAYER_COLORS } from "../hud/presentation";
import { ROLE_COLORS } from "../../shared/roleColors.ts";
import type { Role } from "../../contracts";
import "./MinimapRadar.css";

// The five CS2 teammate slot colours (both sides share the same set), one sRGB wash filter each.
const SLOT_COLORS = [...new Set([...PLAYER_COLORS.ct, ...PLAYER_COLORS.t].map((color) => color.toLowerCase()))];
const slotFilterKey = (color: string) => `slot-${color.replace("#", "").toLowerCase()}`;
const rgbOf = (color: string): [number, number, number] => {
  const value = Number.parseInt(color.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

type Props = Readonly<Record<string, unknown>>;
const sameFields = (a: Props, b: Props): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]));
};
/**
 * The selector builds a fresh marker / keycard / bombsite object on every displayed frame, though one standing still on a
 * still camera keeps every field. Their fields are all primitives, so equal fields render the same element: compare props
 * one level deep and let React skip that item's render.
 */
function sameItemProps(previous: Props, next: Props): boolean {
  const keys = Object.keys(previous);
  return keys.length === Object.keys(next).length && keys.every((key) => {
    const a = previous[key], b = next[key];
    return Object.is(a, b) || (typeof a === "object" && typeof b === "object" && a !== null && b !== null
      && Object.prototype.hasOwnProperty.call(next, key) && sameFields(a as Props, b as Props));
  });
}

function ColorWash({ id, rgb }: { id: string; rgb: readonly [number, number, number] }) {
  // Multiplying source RGB preserves black outlines and the artwork's alpha layers.
  return <filter id={id} colorInterpolationFilters="sRGB">
    <feColorMatrix type="matrix" values={`${rgb[0] / 255} 0 0 0 0  0 ${rgb[1] / 255} 0 0 0  0 0 ${rgb[2] / 255} 0 0  0 0 0 1 0`} />
  </filter>;
}

// The marker filters and the room layer depend only on the map, not the camera, so a per-frame camera
// update re-renders neither: it rewrites the one camera transform above the rooms.
const RadarFilters = memo(function RadarFilters({ id }: { id: string }) {
  return <svg className="minimap-radar__filters" width="0" height="0" aria-hidden="true"><defs>
    <ColorWash id={`${id}-ntf`} rgb={[30, 210, 255]} />
    <ColorWash id={`${id}-scp`} rgb={[236, 105, 114]} />
    <ColorWash id={`${id}-enemy`} rgb={[255, 25, 25]} />
    <ColorWash id={`${id}-self`} rgb={[255, 255, 255]} />
    <ColorWash id={`${id}-bombzone`} rgb={[255, 204, 0]} />
    {/* The keycard's neutral wash where CS2 CreateBombPack keeps its orange #ff9b25 default: SLGO uses the SL NTF
        Captain (指挥官) role colour #003dca instead (user decision 2026-11-17). */}
    <ColorWash id={`${id}-commander`} rgb={[0, 61, 202]} />
    {/* CS2 #SpeakingOnMap / #SpeakingOffMap wash-color #78ff00 over the source's #68ac4b fill. */}
    <ColorWash id={`${id}-speaking`} rgb={[120, 255, 0]} />
    {SLOT_COLORS.map((color) => <ColorWash key={color} id={`${id}-${slotFilterKey(color)}`} rgb={rgbOf(color)} />)}
  </defs></svg>;
});

const MapRooms = memo(function MapRooms({ geometry, blend }: { geometry: MapGeometry; blend: boolean }) {
  // A room of an unknown shape has no artwork and is not drawn; it still names a place for the location title. The
  // image is the artwork already washed in its zone colour (roomWash.ts): no filter to re-rasterize per camera move.
  return geometry.rooms.flatMap(({ artwork, ...room }) => artwork ? [<g key={room.id} className="minimap-map__room" data-room-id={room.id}
    data-zone={room.zone} data-prefab={room.prefabName} data-generic={artwork.generic} data-artwork={artwork.href}>
    <image href={(blend ? artwork.blendHref : artwork.washedHref) ?? artwork.href} width={artwork.width} height={artwork.height}
      transform={roomArtworkToWorld(artwork)} preserveAspectRatio="xMidYMid meet" />
  </g>] : []);
});

function RadarMap({ className, clipId, radar, blend, style }: { className: string; clipId: string; radar: MinimapViewModel;
  blend: boolean; style?: CSSProperties }) {
  const { geometry, camera, viewSize } = radar;
  return <svg className={className} width={viewSize} height={viewSize} viewBox={`0 0 ${viewSize} ${viewSize}`} aria-hidden="true" style={style}>
    <defs><clipPath id={clipId}>
      {radar.shape === "square" ? <rect x="1" y="1" width={viewSize - 2} height={viewSize - 2} />
        : <circle cx={viewSize / 2} cy={viewSize / 2} r={viewSize / 2 - 1} />}
    </clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
      {geometry && camera ? <g className="minimap-map__camera" transform={cameraToRadar(camera)}>
        <MapRooms geometry={geometry} blend={blend} />
      </g> : null}
    </g>
  </svg>;
}

function FrozenMarker({ marker, className, wash }: { marker: RadarMarker; className: string; wash: string }) {
  // CS2 PI_Ghost / PI_Death: frozen pose, no heading, alpha fades out; the ghost uses the offmap arrow at the edge,
  // the death X stays a death X at the clamped edge position.
  const ghost = marker.status === "last-known";
  return <span className={`minimap-marker ${className}${marker.edge ? " minimap-marker--edge" : ""}`}
    data-player-id={marker.playerId} data-visibility={marker.visibility} data-role={marker.role} data-status={marker.status} data-edge={marker.edge}
    style={{ left: marker.x, top: marker.y, opacity: marker.opacity, "--marker-filter": wash } as CSSProperties}>
    {ghost && marker.edge
      ? <span className="minimap-marker__direction" style={{ transform: `rotate(${marker.edgeAngle}deg)` }}>
        <img className="minimap-marker__edge-icon" src="/assets/minimap/offmap-arrow.svg" alt="" />
      </span>
      : <img className={ghost ? "minimap-marker__ghost" : "minimap-marker__death"}
        src={`/assets/minimap/${ghost ? "marker-ghost.svg" : "marker-death.svg"}`} alt="" />}
  </span>;
}

const KEYCARD_ICON = "/assets/slui-svg/KeycardNTFCommander.svg";

const KeycardItem = memo(function KeycardItem({ keycard, observer, teammateColors, filterPrefix }: { keycard: RadarKeycard; observer: boolean;
  teammateColors: boolean; filterPrefix: string }) {
  // CS2 RI_BombDefuserPackage: the pack icon, plus the pulsing #DroppedBomb ring whenever it is on the ground and the red
  // #PlantedBomb ring as well once planted in a generator (client.dll shows both); a planted pack also pulses a red glow
  // (PlantedBombAnimateRed). A card no longer seen fades out at its last seen spot (m_fBombAlpha). Clamped to the edge it
  // keeps only the icon. Wash as CS2 CreateBombPack: red for the opponent's card, the neutral wash for a viewer on neither
  // side and whenever teammate colours are off (where 0x180ec16b0 keeps its default; SLGO's is the NTF Captain blue),
  // plain white for the owning side.
  const wash = keycard.hostile ? "enemy" : observer || !teammateColors ? "commander" : null;
  const ground = keycard.state !== "carried" && !keycard.edge;
  return <span className="minimap-keycard-drop" data-edge={keycard.edge} data-status={keycard.status} data-state={keycard.state}
    data-hostile={keycard.hostile} data-observer={observer}
    style={{ left: keycard.x, top: keycard.y, opacity: keycard.opacity,
      "--keycard-wash": wash ? `url(#${filterPrefix}-${wash})` : undefined } as CSSProperties}>
    {ground ? <span className="minimap-keycard-drop__pulse minimap-keycard-drop__pulse--dropped" /> : null}
    {ground && keycard.state === "planted" ? <span className="minimap-keycard-drop__pulse minimap-keycard-drop__pulse--planted" /> : null}
    <img className={`minimap-keycard-drop__icon${keycard.state === "planted" ? " minimap-keycard-drop__icon--planted" : ""}`}
      src={KEYCARD_ICON} alt="" />
  </span>;
}, sameItemProps);

// SLUI-drawn letters in the CS2 BombZoneA/B style (white); later letters have no CS2 image and are drawn as text in the same style.
const BOMBSITE_ICONS: Readonly<Record<string, string>> = {
  A: "/assets/minimap/bombsite-a.svg",
  B: "/assets/minimap/bombsite-b.svg",
};

const BombsiteIcon = memo(function BombsiteIcon({ site, filterPrefix }: { site: RadarBombsite; filterPrefix: string }) {
  // CS2 .BombZone: yellow-washed letter with a dark outline at the site's centre, always upright (the marker layer
  // never rotates). In range it uses the smaller, fainter .BombZone_OnMap tier; clamped to the edge the larger one.
  const icon = BOMBSITE_ICONS[site.label];
  return <span className="minimap-bombsite" data-label={site.label} data-edge={site.edge}
    style={{ left: site.x, top: site.y, "--bombsite-wash": `url(#${filterPrefix}-bombzone)` } as CSSProperties}>
    {icon ? <img className="minimap-bombsite__icon" src={icon} alt="" /> : <span className="minimap-bombsite__letter">{site.label}</span>}
  </span>;
}, sameItemProps);

const PlayerMarker = memo(function PlayerMarker({ marker, filterPrefix, slotColor, observer, teammateColors, number }: { marker: RadarMarker;
  filterPrefix: string; slotColor?: string; observer: boolean; teammateColors: boolean; number: string | null }) {
  const enemy = marker.hostile;
  const self = marker.visibility === "self";
  // The followed marker (self, or the spectated teammate / observed player) shows its view sector and heading.
  const facing = self || marker.followed;
  // Friendly players (self included) wear their slot colour like the HUD and chat; opponents stay CS2 red. CS2 never
  // applies teammate colours for an observer (client.dll 0x180ecd9b0 skips the wash in number mode), so a team-less
  // observer sees the side colours, here SLGO's role colours (user decision 2026-11-17). With teammate colours off
  // (`teammateColorRule`: casual, or more than 10 players) CS2 writes no override at all, so self is the side colour too.
  const slot = teammateColors && !enemy && !observer && slotColor && SLOT_COLORS.includes(slotColor.toLowerCase()) ? slotFilterKey(slotColor) : null;
  const wash = enemy ? "enemy" : slot ?? (self && teammateColors ? "self" : marker.role === "scp" ? "scp" : "ntf");
  if (marker.status === "last-known") return <FrozenMarker marker={marker} className="minimap-marker--last-known" wash={`url(#${filterPrefix}-enemy)`} />;
  if (marker.status === "dead") return <FrozenMarker marker={marker} className="minimap-marker--dead" wash={`url(#${filterPrefix}-${wash})`} />;
  return <span className={`minimap-marker${enemy ? " minimap-marker--enemy" : ""}${facing ? " minimap-marker--self" : ""}${marker.edge ? " minimap-marker--edge" : ""}`}
    data-player-id={marker.playerId} data-visibility={marker.visibility} data-role={marker.role} data-status={marker.status} data-edge={marker.edge}
    data-hostile={marker.hostile} data-followed={marker.followed} data-selected={marker.selected} data-keycard={marker.hasKeycard}
    data-speaking={marker.speaking}
    style={{ left: marker.x, top: marker.y, "--marker-filter": `url(#${filterPrefix}-${wash})`,
      ...((observer || !teammateColors) && !enemy && marker.hasKeycard ? { "--pack-wash": `url(#${filterPrefix}-commander)` } : {}) } as CSSProperties}>
    <span className="minimap-marker__direction" style={{ transform: `rotate(${marker.edge ? marker.edgeAngle : marker.yaw}deg)` }}>
      {facing && !marker.edge ? <img className="minimap-marker__view-angle" src="/assets/minimap/view-cone.svg" alt="" /> : null}
      {/* CS2 #SpeakingOnMap / #SpeakingOffMap follow #ViewFrustrum in #PI_FirstRotated: under the dot and the edge arrow,
          turning with them. The plugin sends `speaking` only for live teammates (v8). */}
      {marker.speaking ? <img className={marker.edge ? "minimap-marker__speaking-offmap" : "minimap-marker__speaking"}
        src={`/assets/minimap/${marker.edge ? "speaking-offmap.svg" : "speaking-onmap.svg"}`} alt=""
        style={{ filter: `url(#${filterPrefix}-speaking)` }} /> : null}
      {!marker.edge && (!enemy || facing) ? <img className="minimap-marker__heading" src="/assets/minimap/heading-arrow.svg" alt="" /> : null}
      {marker.edge ? <img className="minimap-marker__edge-icon" src="/assets/minimap/offmap-arrow.svg" alt="" /> : null}
    </span>
    {!marker.edge ? <img className="minimap-marker__dot"
      src={`/assets/minimap/${enemy ? "marker-enemy.svg" : "marker-dot.svg"}`} alt="" /> : null}
    {/* CS2 #Selected is the last child of #PI_FirstRotated: over the dot, turning with the heading, never washed. */}
    {marker.selected ? <span className="minimap-marker__direction" style={{ transform: `rotate(${marker.yaw}deg)` }}>
      <img className="minimap-marker__selected" src="/assets/minimap/selected.svg" alt="" />
    </span> : null}
    {/* CS2 #PlayerNumber sits in #PI_NonRotated: always upright. */}
    {number !== null ? <span className="minimap-marker__number">{number}</span> : null}
    {/* CS2 draws the bomb package over its carrier, tinted like the carrier (slot colour, red for an enemy; NTF Captain blue for
        a viewer on neither side or with teammate colours off). */}
    {marker.hasKeycard ? <img className="minimap-marker__keycard" src={KEYCARD_ICON} alt="" /> : null}
  </span>;
}, sameItemProps);

export function MinimapRadar({ radar, playerColors = {}, teammateColors = true, playerNumbers = {}, role = null, generatorActive = false }: {
  radar: MinimapViewModel;
  playerColors?: Readonly<Record<string, string>>;
  /** `teammateColorRule(hud).slots`: false draws friendly players and their keycard in the side colours. */
  teammateColors?: boolean;
  /** CS2 observer numbers (`playerObserverNumbers`); drawn only for a team-less observer (`radarMarkerNumber`). */
  playerNumbers?: Readonly<Record<string, string>>; role?: Role | null;
  /** A generator overload is running (SLGO's planted bomb): the round frame pulses red like CS2 RadarBombPlantPulse. */
  generatorActive?: boolean }) {
  const scale = useOverlayScale();
  // The radar re-renders on every displayed frame; its filter id only changes with the React id.
  const reactId = useId();
  const id = useMemo(() => reactId.replace(/:/g, ""), [reactId]);
  const { camera, viewSize } = radar;
  // #Radar__Round--Inner / #Radar__Square--Inner have `world-blur: hudWorldBlur`; the "模糊背景" preference turns it off.
  const viewport = useBackdropRef({ enabled: radar.effects.blurBackground });
  const blend = radar.effects.mapBlend;
  const layers = blend ? mapBlendLayers(radar.preferences.backgroundAlpha) : null;
  // No radar area at all until a server instance is connected (user decision 2026-10-19).
  if (!radar.connected) return null;
  return <div className="minimap-overlay" aria-label="战术雷达">
    <div className="minimap-design-canvas" style={{ "--minimap-scale": scale } as CSSProperties}>
      <section className="minimap-radar" data-availability={radar.availability} data-camera={camera?.mode ?? "none"}
        data-orientation={radar.preferences.orientation} data-full-map={radar.fullMap} data-viewer-alive={radar.viewerAlive}
        data-shape={radar.shape} data-map-blend={radar.effects.mapBlend} data-blur-background={radar.effects.blurBackground}
        data-hud-scale={radar.preferences.hudScale} data-generator-active={generatorActive}
        data-map-scale={radar.activeMapScale} data-icon-scale={radar.iconScale} data-alternate-zoom={radar.alternateZoomActive} data-dynamic-zoom={radar.dynamicZoomActive}
        style={{ "--radar-hud-scale": radar.preferences.hudScale, "--radar-view-size": `${viewSize}px`,
          "--radar-background-alpha": radar.preferences.backgroundAlpha,
          ...(layers ? { "--radar-room-opacity": layers.roomOpacity } : {}),
          // The frame and title wear the viewer's SLGO team colour like the bottom HUD; a team-less observer keeps the CSS default.
          ...(role ? { "--radar-accent": ROLE_COLORS[role] } : {}) } as CSSProperties}>
        <RadarFilters id={id} />
        <div ref={viewport} className="minimap-radar__viewport">
          {/* With mapBlend the base is one group at the background alpha over an opaque fill (roomWash.ts mapBlendLayers). */}
          <div className="minimap-radar__base">
            <div className="minimap-radar__background" />
            <RadarMap className="minimap-radar__map" clipId={`${id}-clip`} radar={radar} blend={blend} />
            {layers && layers.roomOpacity < 1 ? <div className="minimap-radar__dim" /> : null}
          </div>
          {layers && layers.liftOpacity > 0 ? <RadarMap className="minimap-radar__lift" clipId={`${id}-lift-clip`} radar={radar}
            blend style={{ opacity: layers.liftOpacity }} /> : null}
          <div className="minimap-radar__markers" aria-hidden="true" style={{ "--radar-icon-scale": radar.iconScale } as CSSProperties}>
            {radar.bombsites.map((site) => <BombsiteIcon key={site.label} site={site} filterPrefix={id} />)}
            {radar.keycard ? <KeycardItem keycard={radar.keycard} observer={radar.observer} teammateColors={teammateColors} filterPrefix={id} /> : null}
            {radar.markers.map((marker) => <PlayerMarker key={marker.playerId} marker={marker} filterPrefix={id}
              slotColor={playerColors[marker.playerId]} observer={radar.observer} teammateColors={teammateColors}
              number={radarMarkerNumber(marker, radar.observer, playerNumbers)} />)}
          </div>
          <div className="minimap-radar__border" />
        </div>
        <div className="minimap-radar__location">{radar.locationLabel}</div>
      </section>
    </div>
  </div>;
}

/** The radar bound to the minimap store: its per-frame clock re-renders this subtree, not the overlay. */
export function LiveMinimapRadar({ store, preferences, controls, playerColors, teammateColors, playerNumbers, role, generatorActive }: {
  store: MinimapStore; preferences?: Partial<RadarPreferences>; controls?: Partial<RadarControls>;
  playerColors?: Readonly<Record<string, string>>; teammateColors?: boolean; playerNumbers?: Readonly<Record<string, string>>;
  role?: Role | null; generatorActive?: boolean }) {
  return <MinimapRadar radar={useMinimapView(store, { preferences, controls })} playerColors={playerColors} teammateColors={teammateColors}
    playerNumbers={playerNumbers} role={role} generatorActive={generatorActive} />;
}
