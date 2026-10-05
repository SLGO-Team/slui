import { memo, useId, type CSSProperties } from "react";
import { useOverlayScale } from "../../shared/overlay";
import type { MinimapViewModel, RadarBombsite, RadarKeycard } from "./model";
import type { MapGeometry } from "./resolver";
import { cameraToRadar, roomArtworkToWorld, type RadarCamera, type RadarMarker } from "./camera";
import { useMinimapView, type MinimapStore, type RadarControls, type RadarPreferences, type RadarRenderCapabilities } from "./useMinimapFeature";
import { PLAYER_COLORS } from "../hud/presentation";
import "./MinimapRadar.css";

// The five CS2 teammate slot colours (both sides share the same set), one sRGB wash filter each.
const SLOT_COLORS = [...new Set([...PLAYER_COLORS.ct, ...PLAYER_COLORS.t].map((color) => color.toLowerCase()))];
const slotFilterKey = (color: string) => `slot-${color.replace("#", "").toLowerCase()}`;
const rgbOf = (color: string): [number, number, number] => {
  const value = Number.parseInt(color.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

function ColorWash({ id, rgb }: { id: string; rgb: readonly [number, number, number] }) {
  // Multiplying source RGB preserves black outlines and the artwork's alpha layers.
  return <filter id={id} colorInterpolationFilters="sRGB">
    <feColorMatrix type="matrix" values={`${rgb[0] / 255} 0 0 0 0  0 ${rgb[1] / 255} 0 0 0  0 0 ${rgb[2] / 255} 0 0  0 0 0 1 0`} />
  </filter>;
}

// The filters and the room layer depend only on the map, not the camera, so a per-frame camera
// update re-renders neither: it rewrites the one camera transform above the rooms.
const RadarFilters = memo(function RadarFilters({ id }: { id: string }) {
  return <svg className="minimap-radar__filters" width="0" height="0" aria-hidden="true"><defs>
    <ColorWash id={`${id}-hcz`} rgb={[80, 92, 91]} />
    <ColorWash id={`${id}-entrance`} rgb={[90, 96, 80]} />
    <ColorWash id={`${id}-ntf`} rgb={[30, 210, 255]} />
    <ColorWash id={`${id}-scp`} rgb={[236, 105, 114]} />
    <ColorWash id={`${id}-enemy`} rgb={[255, 25, 25]} />
    <ColorWash id={`${id}-self`} rgb={[255, 255, 255]} />
    <ColorWash id={`${id}-bombzone`} rgb={[255, 204, 0]} />
    {SLOT_COLORS.map((color) => <ColorWash key={color} id={`${id}-${slotFilterKey(color)}`} rgb={rgbOf(color)} />)}
  </defs></svg>;
});

const MapRooms = memo(function MapRooms({ geometry, activeZone, filterPrefix }: {
  geometry: MapGeometry; activeZone: RadarCamera["zone"]; filterPrefix: string }) {
  return geometry.rooms.map((room) => <g key={room.id} className="minimap-map__room" data-room-id={room.id} data-zone={room.zone}
    data-prefab={room.prefabName} data-active={activeZone === null || activeZone === room.zone}
    filter={`url(#${filterPrefix}-${room.zone === "Entrance" ? "entrance" : "hcz"})`}>
    <image href={room.artwork.href} width={room.artwork.width} height={room.artwork.height}
      transform={roomArtworkToWorld(room.artwork)} preserveAspectRatio="xMidYMid meet" />
  </g>);
});

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

function KeycardItem({ keycard, filterPrefix }: { keycard: RadarKeycard; filterPrefix: string }) {
  // CS2 RI_BombDefuserPackage: the small pack icon, plus the pulsing #DroppedBomb ring on the ground or the red
  // #PlantedBomb ring once planted in a generator; a card no longer seen fades out at its last seen spot
  // (m_fBombAlpha). Clamped to the edge it keeps only the icon.
  // Like the CS2 bomb, an opponent's card is red; the owning side (and team-less observers) see the plain white card.
  return <span className="minimap-keycard-drop" data-edge={keycard.edge} data-status={keycard.status} data-state={keycard.state}
    data-hostile={keycard.hostile}
    style={{ left: keycard.x, top: keycard.y, opacity: keycard.opacity,
      "--keycard-wash": keycard.hostile ? `url(#${filterPrefix}-enemy)` : undefined } as CSSProperties}>
    {keycard.state !== "carried" && !keycard.edge ? <span className="minimap-keycard-drop__pulse" /> : null}
    <img className="minimap-keycard-drop__icon" src={KEYCARD_ICON} alt="" />
  </span>;
}

// SLUI-drawn letters in the CS2 BombZoneA/B style (white); later letters have no CS2 image and are drawn as text in the same style.
const BOMBSITE_ICONS: Readonly<Record<string, string>> = {
  A: "/assets/minimap/bombsite-a.svg",
  B: "/assets/minimap/bombsite-b.svg",
};

function BombsiteIcon({ site, filterPrefix }: { site: RadarBombsite; filterPrefix: string }) {
  // CS2 .BombZone: yellow-washed letter with a dark outline at the site's centre, always upright (the marker layer
  // never rotates). In range it uses the smaller, fainter .BombZone_OnMap tier; clamped to the edge the larger one.
  const icon = BOMBSITE_ICONS[site.label];
  return <span className="minimap-bombsite" data-label={site.label} data-edge={site.edge}
    style={{ left: site.x, top: site.y, "--bombsite-wash": `url(#${filterPrefix}-bombzone)` } as CSSProperties}>
    {icon ? <img className="minimap-bombsite__icon" src={icon} alt="" /> : <span className="minimap-bombsite__letter">{site.label}</span>}
  </span>;
}

function PlayerMarker({ marker, filterPrefix, slotColor }: { marker: RadarMarker; filterPrefix: string; slotColor?: string }) {
  const enemy = marker.hostile;
  const self = marker.visibility === "self";
  // The followed marker (self, or the spectated teammate / observed player) shows its view sector and heading.
  const facing = self || marker.followed;
  // Friendly players (self included) wear their slot colour like the HUD and chat; opponents stay CS2 red.
  const slot = !enemy && slotColor && SLOT_COLORS.includes(slotColor.toLowerCase()) ? slotFilterKey(slotColor) : null;
  const wash = enemy ? "enemy" : slot ?? (self ? "self" : marker.role === "scp" ? "scp" : "ntf");
  if (marker.status === "last-known") return <FrozenMarker marker={marker} className="minimap-marker--last-known" wash={`url(#${filterPrefix}-enemy)`} />;
  if (marker.status === "dead") return <FrozenMarker marker={marker} className="minimap-marker--dead" wash={`url(#${filterPrefix}-${wash})`} />;
  return <span className={`minimap-marker${enemy ? " minimap-marker--enemy" : ""}${facing ? " minimap-marker--self" : ""}${marker.edge ? " minimap-marker--edge" : ""}`}
    data-player-id={marker.playerId} data-visibility={marker.visibility} data-role={marker.role} data-status={marker.status} data-edge={marker.edge}
    data-hostile={marker.hostile} data-followed={marker.followed} data-keycard={marker.hasKeycard}
    style={{ left: marker.x, top: marker.y, "--marker-filter": `url(#${filterPrefix}-${wash})` } as CSSProperties}>
    <span className="minimap-marker__direction" style={{ transform: `rotate(${marker.edge ? marker.edgeAngle : marker.yaw}deg)` }}>
      {facing && !marker.edge ? <img className="minimap-marker__view-angle" src="/assets/minimap/view-cone.svg" alt="" /> : null}
      {!marker.edge && (!enemy || facing) ? <img className="minimap-marker__heading" src="/assets/minimap/heading-arrow.svg" alt="" /> : null}
      {marker.edge ? <img className="minimap-marker__edge-icon" src="/assets/minimap/offmap-arrow.svg" alt="" /> : null}
    </span>
    {!marker.edge ? <img className="minimap-marker__dot"
      src={`/assets/minimap/${enemy ? "marker-enemy.svg" : "marker-dot.svg"}`} alt="" /> : null}
    {/* CS2 draws the bomb package over its carrier, tinted like the carrier (slot colour, red for an enemy). */}
    {marker.hasKeycard ? <img className="minimap-marker__keycard" src={KEYCARD_ICON} alt="" /> : null}
  </span>;
}

export function MinimapRadar({ radar, playerColors = {} }: { radar: MinimapViewModel; playerColors?: Readonly<Record<string, string>> }) {
  const scale = useOverlayScale();
  const id = useId().replace(/:/g, "");
  const { geometry, camera, viewSize } = radar;
  const showStatus = radar.availability !== "live" || radar.viewerAlive === false;
  return <div className="minimap-overlay" aria-label="战术雷达">
    <div className="minimap-design-canvas" style={{ "--minimap-scale": scale } as CSSProperties}>
      <section className="minimap-radar" data-availability={radar.availability} data-camera={camera?.mode ?? "none"}
        data-orientation={radar.preferences.orientation} data-full-map={radar.fullMap} data-viewer-alive={radar.viewerAlive}
        data-shape={radar.shape} data-map-blend={radar.effects.mapBlend} data-blur-background={radar.effects.blurBackground}
        data-page-backdrop={radar.effects.pageBackdrop} data-hud-scale={radar.preferences.hudScale}
        data-map-scale={radar.activeMapScale} data-alternate-zoom={radar.alternateZoomActive} data-dynamic-zoom={radar.dynamicZoomActive}
        style={{ "--radar-hud-scale": radar.preferences.hudScale, "--radar-view-size": `${viewSize}px`,
          "--radar-background-alpha": radar.preferences.backgroundAlpha } as CSSProperties}>
        <RadarFilters id={id} />
        <div className="minimap-radar__viewport">
          <div className="minimap-radar__background" />
          <svg className="minimap-radar__map" width={viewSize} height={viewSize} viewBox={`0 0 ${viewSize} ${viewSize}`} aria-hidden="true">
            <defs><clipPath id={`${id}-clip`}>
              {radar.shape === "square" ? <rect x="1" y="1" width={viewSize - 2} height={viewSize - 2} />
                : <circle cx={viewSize / 2} cy={viewSize / 2} r={viewSize / 2 - 1} />}
            </clipPath></defs>
            <g clipPath={`url(#${id}-clip)`}>
              {geometry && camera ? <g className="minimap-map__camera" transform={cameraToRadar(camera)}>
                <MapRooms geometry={geometry} activeZone={camera.zone} filterPrefix={id} />
              </g> : null}
            </g>
          </svg>
          <div className="minimap-radar__markers" aria-hidden="true">
            {radar.bombsites.map((site) => <BombsiteIcon key={site.label} site={site} filterPrefix={id} />)}
            {radar.keycard ? <KeycardItem keycard={radar.keycard} filterPrefix={id} /> : null}
            {radar.markers.map((marker) => <PlayerMarker key={marker.playerId} marker={marker} filterPrefix={id}
              slotColor={playerColors[marker.playerId]} />)}
          </div>
          <div className="minimap-radar__border" />
          {!geometry ? <span className="minimap-radar__empty">{radar.statusLabel}</span> : null}
        </div>
        <div className="minimap-radar__location">{radar.locationLabel}</div>
        {showStatus ? <div className="minimap-radar__status" role="status">
          {radar.availability !== "live" ? <span>{radar.statusLabel}</span> : null}
          {radar.viewerAlive === false ? <span className="minimap-radar__spectating">队伍视野</span> : null}
        </div> : null}
      </section>
    </div>
  </div>;
}

/** The radar bound to the minimap store: its per-frame clock re-renders this subtree, not the overlay. */
export function LiveMinimapRadar({ store, preferences, controls, renderCapabilities, playerColors }: { store: MinimapStore;
  preferences?: Partial<RadarPreferences>; controls?: Partial<RadarControls>; renderCapabilities?: Partial<RadarRenderCapabilities>;
  playerColors?: Readonly<Record<string, string>> }) {
  return <MinimapRadar radar={useMinimapView(store, { preferences, controls, renderCapabilities })} playerColors={playerColors} />;
}
