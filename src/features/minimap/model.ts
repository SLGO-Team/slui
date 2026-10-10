import { MINIMAP_DEAD_MS, MINIMAP_KEYCARD_FADE_MS, MINIMAP_LAST_KNOWN_MS, type ConnectionStatus, type MinimapDiagnostic, type MinimapInit,
  type MinimapBombsite, type MinimapCommanderKeycard, type MinimapPosition, type MinimapPositions, type MinimapPositionsEvent, type SlgoEvent } from "../../contracts";
import { assertSupportedMap, mapDescriptorKey, type MapGeometry } from "./resolver.ts";
import { clampToRadar, createRadarCamera, positionMarker, radarShape, type RadarCamera, type RadarMarker, type RadarPoint, type RadarShape } from "./camera.ts";
import { normalizeRadarPreferences, type RadarPreferences, type RadarControls, type RadarRenderCapabilities } from "./preferences.ts";
import { advanceDynamicZoom, dynamicZoomTarget, dynamicZoomTargets, type DynamicZoomState } from "./dynamicZoom.ts";

type Source = { serverId: string; instanceId: string };
type MapIdentity = Source & { roundId: string; mapId: string };
/** `sampledAtMs` is the plugin's capture time (envelope `sent_at`), on the server's clock. */
type Frame = { payload: MinimapPositions; receivedAtMs: number; sampledAtMs: number };
type ClockSample = Pick<Frame, "receivedAtMs" | "sampledAtMs">;
/** The plugin-clock instant the radar shows, last advanced at local `updatedAtMs`. */
type Playout = { renderAtMs: number; updatedAtMs: number };
export type MinimapAvailability = "live" | "waiting-viewpoint" | "syncing" | "loading" | "stale" | "disconnected" | "invalid" | "incompatible";
export type MinimapState = {
  connectionStatus: ConnectionStatus;
  source: Source | null;
  baselineAccepted: boolean;
  sequence: number;
  identity: MapIdentity | null;
  init: MinimapInit | null;
  knownMaps: Readonly<Record<string, string>>;
  requestToken: number;
  geometry: MapGeometry | null;
  /**
   * The bombsites of the init that produced `geometry`, committed together with it once their rooms validate.
   * Static map data: kept with the geometry when positions go stale or the connection drops, cleared whenever the
   * geometry is (`NO_MAP`) and replaced when the next init resolves.
   */
  bombsites: readonly MinimapBombsite[];
  frame: Frame | null;
  /**
   * Committed frames, oldest first, ending with `frame`: only those the playout can still interpolate
   * from. Poses are only read for players the latest frame still authorizes, with matching visibility.
   */
  frames: readonly Frame[];
  /** Receipt vs capture time of the frames in the last `PLAYOUT_WINDOW_MS`, for the playout delay. */
  clock: readonly ClockSample[];
  playout: Playout | null;
  pendingFrame: Frame | null;
  visibilityRevision: number;
  authorizationKey: string | null;
  availability: MinimapAvailability;
  focused: boolean;
  focusRevision: number;
  scoreboardArmed: boolean;
  preferences: RadarPreferences;
  alternateZoomRequested: boolean;
  alternateZoomArmed: boolean;
  dynamicZoom: DynamicZoomState | null;
  radarUpdatedAtMs: number;
};

export const initialMinimapState: MinimapState = {
  connectionStatus: "signed-out", source: null, baselineAccepted: false, sequence: -1,
  identity: null, init: null, knownMaps: {}, requestToken: 0, geometry: null, bombsites: [],
  frame: null, frames: [], clock: [], playout: null, pendingFrame: null, visibilityRevision: -1,
  authorizationKey: null, availability: "syncing", focused: false, focusRevision: -1, scoreboardArmed: false,
  preferences: normalizeRadarPreferences(), alternateZoomRequested: false, alternateZoomArmed: false,
  dynamicZoom: null, radarUpdatedAtMs: 0,
};

export type MinimapAction =
  | { type: "connection"; status: ConnectionStatus }
  | { type: "event"; event: SlgoEvent; receivedAtMs: number }
  | { type: "diagnostic"; diagnostic: MinimapDiagnostic }
  | { type: "resolved"; token: number; descriptorKey: string; geometry: MapGeometry; nowMs: number }
  | { type: "resolve-error"; token: number }
  | { type: "focus"; focused: boolean; revision: number }
  | { type: "radar-options"; preferences?: Partial<RadarPreferences>; controls?: Partial<RadarControls>; nowMs: number }
  | { type: "tick"; nowMs: number };

export function minimapStaleAfterMs(init: MinimapInit | null): number {
  return Math.max(1_000, 3_000 / (init?.position_update_hz ?? 15));
}

function clearDynamic(state: MinimapState, availability: MinimapAvailability): MinimapState {
  return { ...state, frame: null, frames: [], clock: [], playout: null, pendingFrame: null, scoreboardArmed: false,
    alternateZoomArmed: false, dynamicZoom: null, availability };
}

function clearInit(state: MinimapState, availability: MinimapAvailability): MinimapState {
  return { ...clearDynamic(state, availability), init: null, identity: null,
    requestToken: state.requestToken + 1, visibilityRevision: -1, authorizationKey: null };
}

// The geometry and its bombsites are one unit: every path that drops the map drops both, so the sites can never
// outlive or mismatch the geometry they were validated against.
const NO_MAP = { geometry: null, bombsites: [] } as const satisfies Pick<MinimapState, "geometry" | "bombsites">;

function matchesSource(state: MinimapState, serverId: string, instanceId: string): boolean {
  return state.source?.serverId === serverId && state.source.instanceId === instanceId;
}

// Same shape as the plugin's Signature: the keycard holder and the keycard item's status are authorization too.
function authorizationKey(payload: MinimapPositions): string {
  const keycard = payload.commander_keycard;
  return JSON.stringify([payload.viewer.player_id, payload.viewer.team_id,
    payload.positions.map((position) => [position.player_id, position.team_id, position.visibility, position.status, position.has_commander_keycard])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    keycard ? [keycard.status, keycard.state] : null]);
}

function validRooms(frame: Frame, geometry: MapGeometry): boolean {
  const poses = [...frame.payload.positions, ...(frame.payload.viewpoint ? [frame.payload.viewpoint] : []),
    ...(frame.payload.commander_keycard ? [frame.payload.commander_keycard] : [])];
  return poses.every((pose) => pose.room_id === null || geometry.roomById.get(pose.room_id)?.zone === pose.zone);
}

function commitFrame(state: MinimapState, frame: Frame, nowMs: number): MinimapState {
  if (nowMs - frame.receivedAtMs > minimapStaleAfterMs(state.init)) return clearDynamic(state, "stale");
  if (!state.geometry || !validRooms(frame, state.geometry)) return clearDynamic(state, "invalid");
  // A capture time that goes backwards (server clock step) starts a new timeline.
  const continuous = state.frame !== null && frame.sampledAtMs >= state.frame.sampledAtMs;
  const clock = continuous ? state.clock.filter((sample) => frame.receivedAtMs - sample.receivedAtMs <= PLAYOUT_WINDOW_MS) : [];
  return { ...state, frame, frames: [...(continuous ? state.frames : []), frame].slice(-MAX_PLAYOUT_FRAMES),
    clock: [...clock, { receivedAtMs: frame.receivedAtMs, sampledAtMs: frame.sampledAtMs }],
    playout: continuous ? state.playout : null, pendingFrame: null,
    visibilityRevision: frame.payload.visibility_revision, authorizationKey: authorizationKey(frame.payload),
    scoreboardArmed: state.focused && (state.scoreboardArmed || !frame.payload.scoreboard_visible),
    alternateZoomArmed: state.focused && (state.alternateZoomArmed || !state.alternateZoomRequested),
    availability: frame.payload.viewpoint ? "live" : "waiting-viewpoint" };
}

function receivePositions(state: MinimapState, event: MinimapPositionsEvent, receivedAtMs: number): MinimapState {
  if (state.frame && receivedAtMs - state.frame.receivedAtMs > minimapStaleAfterMs(state.init)) state = clearDynamic(state, "stale");
  const next = { ...state, sequence: event.sequence };
  if (!state.init || !state.identity) return clearDynamic(next, state.availability);
  if (event.round_id !== state.identity.roundId || event.payload.map_id !== state.identity.mapId) return clearDynamic(next, "invalid");
  const key = authorizationKey(event.payload);
  if (event.payload.visibility_revision < state.visibilityRevision
    || (event.payload.visibility_revision === state.visibilityRevision && key !== state.authorizationKey)) return clearDynamic(next, "invalid");
  const frame = { payload: event.payload, receivedAtMs, sampledAtMs: Date.parse(event.sent_at) };
  if (state.geometry && !validRooms(frame, state.geometry)) return clearDynamic(next, "invalid");
  return state.geometry ? commitFrame(next, frame, receivedAtMs)
    : { ...next, frame: null, frames: [], clock: [], playout: null, pendingFrame: frame, availability: "loading" };
}

function reduceMapState(state: MinimapState, action: Exclude<MinimapAction, { type: "radar-options" }>): MinimapState {
  if (action.type === "connection") {
    if (action.status === state.connectionStatus) return state;
    if (action.status === "live") return { ...state, connectionStatus: action.status };
    if (action.status === "ended") {
      return { ...clearInit({ ...state, connectionStatus: action.status, baselineAccepted: false, source: null, sequence: -1 }, "disconnected"),
        ...NO_MAP };
    }
    const next = clearInit({ ...state, connectionStatus: action.status, baselineAccepted: false },
      action.status === "incompatible" ? "incompatible" : action.status === "stale" ? "stale" : "disconnected");
    return ["signed-out", "unauthorized", "route-pending", "discovering", "connecting"].includes(action.status)
      ? { ...next, ...NO_MAP } : next;
  }
  if (action.type === "focus") {
    if (action.revision <= state.focusRevision) return state;
    return { ...state, focused: action.focused, focusRevision: action.revision,
      scoreboardArmed: action.focused === state.focused ? state.scoreboardArmed : false,
      alternateZoomArmed: action.focused === state.focused ? state.alternateZoomArmed : false };
  }
  if (action.type === "tick") {
    const frame = state.frame ?? state.pendingFrame;
    return frame && action.nowMs - frame.receivedAtMs > minimapStaleAfterMs(state.init) ? clearDynamic(state, "stale") : state;
  }
  if (action.type === "resolved") {
    if (action.token !== state.requestToken || !state.init || !state.identity || !state.baselineAccepted
      || action.descriptorKey !== mapDescriptorKey(state.init) || action.geometry.descriptorKey !== action.descriptorKey) return state;
    // Like a frame's poses, a bombsite room must belong to its zone; a mismatch rejects the whole init.
    if (!state.init.bombsites.every((site) => site.room_id === null || action.geometry.roomById.get(site.room_id)?.zone === site.zone)) {
      return clearInit({ ...state, ...NO_MAP }, "invalid");
    }
    const next = { ...state, geometry: action.geometry, bombsites: state.init.bombsites, availability: "syncing" as const };
    return state.pendingFrame ? commitFrame(next, state.pendingFrame, action.nowMs) : next;
  }
  if (action.type === "resolve-error") return action.token === state.requestToken ? clearInit({ ...state, ...NO_MAP }, "incompatible") : state;
  if (action.type === "diagnostic") {
    const diagnostic = action.diagnostic;
    if (!state.baselineAccepted || !matchesSource(state, diagnostic.serverId, diagnostic.instanceId) || diagnostic.sequence <= state.sequence) return state;
    const next = { ...state, sequence: diagnostic.sequence };
    const availability = diagnostic.kind === "invalid-payload" ? "invalid" : "incompatible";
    return diagnostic.eventType === "minimap.init" || diagnostic.kind !== "invalid-payload"
      ? clearInit({ ...next, ...NO_MAP }, availability) : clearDynamic(next, availability);
  }

  const { event, receivedAtMs } = action;
  if (event.type === "sidecar.baseline") {
    if (state.baselineAccepted && matchesSource(state, event.server_id, event.instance_id) && event.sequence <= state.sequence) return state;
    return { ...clearInit(state, "syncing"), source: { serverId: event.server_id, instanceId: event.instance_id },
      baselineAccepted: true, sequence: event.sequence, ...NO_MAP };
  }
  if (event.type !== "minimap.init" && event.type !== "minimap.positions") return state;
  if (!state.baselineAccepted) return state;
  if (!matchesSource(state, event.server_id, event.instance_id)) return { ...clearInit(state, "syncing"), baselineAccepted: false, ...NO_MAP };
  if (event.sequence <= state.sequence) return state;
  if (event.type === "minimap.positions") return receivePositions(state, event, receivedAtMs);
  const next = clearInit({ ...state, sequence: event.sequence }, "loading");
  try { assertSupportedMap(event.payload); } catch { return { ...next, ...NO_MAP, availability: "incompatible" }; }
  const descriptor = mapDescriptorKey(event.payload);
  const physicalKey = JSON.stringify([event.server_id, event.instance_id, event.payload.map_id]);
  if (state.knownMaps[physicalKey] && state.knownMaps[physicalKey] !== descriptor) return { ...next, ...NO_MAP, availability: "incompatible" };
  return { ...next, init: event.payload,
    identity: { serverId: event.server_id, instanceId: event.instance_id, roundId: event.round_id, mapId: event.payload.map_id },
    knownMaps: { ...state.knownMaps, [physicalKey]: descriptor }, ...NO_MAP };
}

// Poses are shown on the plugin's capture timeline, not by arrival: frames are captured every
// ~67 ms but arrive unevenly (in game: 61/61/80 ms), so interpolating from each arrival held
// and jumped the map every few frames. The playout runs behind the latest capture by the
// worst recent transit delay plus the longest capture gap, so the next frame is normally
// already there; it never extrapolates and holds at the newest pose if one is later than that.
const PLAYOUT_WINDOW_MS = 3_000;
/** The playout clock catches up with a moved target at most 5% faster or slower than real time, below what the eye notices. */
const PLAYOUT_MAX_SLEW = 0.05;
/** Beyond this the playout jumps instead of slewing (a resumed stream). */
const PLAYOUT_SNAP_MS = 250;
const MAX_PLAYOUT_FRAMES = 8;

function playoutTarget(state: MinimapState, nowMs: number): number | null {
  if (state.clock.length === 0) return null;
  let gap = 1_000 / (state.init?.position_update_hz ?? 15), offset = Infinity;
  state.clock.forEach((sample, index) => {
    // The plugin-minus-local clock offset of the slowest recent frame.
    offset = Math.min(offset, sample.sampledAtMs - sample.receivedAtMs);
    if (index > 0) gap = Math.max(gap, sample.sampledAtMs - state.clock[index - 1].sampledAtMs);
  });
  return nowMs + offset - gap;
}

function advancePlayout(state: MinimapState, nowMs: number): Playout | null {
  const target = playoutTarget(state, nowMs);
  if (target === null) return null;
  const previous = state.playout;
  if (!previous || nowMs < previous.updatedAtMs) return { renderAtMs: target, updatedAtMs: nowMs };
  const elapsed = nowMs - previous.updatedAtMs;
  const predicted = previous.renderAtMs + elapsed;
  const error = target - predicted;
  if (Math.abs(error) > PLAYOUT_SNAP_MS) return { renderAtMs: target, updatedAtMs: nowMs };
  const correction = Math.max(-PLAYOUT_MAX_SLEW * elapsed, Math.min(PLAYOUT_MAX_SLEW * elapsed, error));
  return { renderAtMs: predicted + correction, updatedAtMs: nowMs };
}

/** Drops frames the playout has passed: it keeps the last capture at or before `renderAtMs` onward. */
function playableFrames(frames: readonly Frame[], renderAtMs: number): readonly Frame[] {
  let first = 0;
  for (let index = 0; index < frames.length; index += 1) if (frames[index].sampledAtMs <= renderAtMs) first = index;
  return first === 0 ? frames : frames.slice(first);
}

function radarContext(state: MinimapState, nowMs: number, preferences: RadarPreferences) {
  const frame = state.frame && nowMs - state.frame.receivedAtMs <= minimapStaleAfterMs(state.init) ? state.frame : null;
  const fullMap = Boolean(frame && state.focused && state.scoreboardArmed && frame.payload.scoreboard_visible);
  const { positions, fading, viewpoint } = interpolatedRadarPoses(state, frame, nowMs);
  const alternateZoomActive = Boolean(frame && viewpoint && state.focused && !fullMap
    && state.alternateZoomArmed && state.alternateZoomRequested);
  const selectedScale = alternateZoomActive ? preferences.alternateMapScale : preferences.mapScale;
  const dynamicZoomActive = Boolean(preferences.dynamicZoom && state.focused && frame && viewpoint && state.geometry && !fullMap);
  const identity = JSON.stringify([state.identity, frame?.payload.viewer.player_id, frame?.payload.viewer.team_id, viewpoint?.player_id, viewpoint?.zone,
    radarShape(preferences, fullMap), preferences.orientation, preferences.alwaysCentered, selectedScale]);
  return { frame, positions, fading, fullMap, viewpoint, alternateZoomActive, selectedScale, dynamicZoomActive, identity };
}

// One pure transition coordinates camera-only timers with the authoritative map
// lifecycle. It stores scalars/identities, never a separate history of enemy poses:
// the playout's few buffered frames are read only under the latest frame's authorization.
export function minimapReducer(state: MinimapState, action: MinimapAction): MinimapState {
  const nowMs = "nowMs" in action ? action.nowMs : action.type === "event" ? action.receivedAtMs
    : action.type === "diagnostic" ? action.diagnostic.receivedAtMs : state.radarUpdatedAtMs;
  let next: MinimapState;
  if (action.type === "radar-options") {
    const fresh = state.frame && nowMs - state.frame.receivedAtMs <= minimapStaleAfterMs(state.init);
    const alternateZoomRequested = action.controls?.alternateZoomActive === true;
    next = { ...state, preferences: normalizeRadarPreferences(action.preferences), alternateZoomRequested,
      alternateZoomArmed: Boolean(fresh && state.focused && (!alternateZoomRequested || state.alternateZoomArmed)) };
  } else {
    next = reduceMapState(state, action);
    // Ignored wire events must remain true no-ops, including presentation clocks.
    if (next === state && action.type !== "tick") return state;
  }
  const context = radarContext(next, nowMs, next.preferences);
  const dynamicZoom = context.dynamicZoomActive && next.geometry && context.viewpoint && context.frame
    ? advanceDynamicZoom(next.dynamicZoom, {
      identity: context.identity,
      targets: JSON.stringify(dynamicZoomTargets(context.positions, context.viewpoint)
        .map((position) => [position.player_id, position.team_id, position.visibility]).sort((a, b) => a[0].localeCompare(b[0]))),
      targetScale: dynamicZoomTarget(next.geometry, context.viewpoint, context.positions, next.preferences, context.selectedScale),
      selectedScale: context.selectedScale, nowMs,
    }) : null;
  const playout = context.frame ? advancePlayout(next, nowMs) : null;
  return { ...next, dynamicZoom, playout, frames: playout ? playableFrames(next.frames, playout.renderAtMs) : next.frames,
    radarUpdatedAtMs: nowMs };
}

const STATUS_LABELS: Record<MinimapAvailability, string> = {
  live: "实时", "waiting-viewpoint": "等待视点", syncing: "等待同步", loading: "地图加载中", stale: "位置已过期",
  disconnected: "连接已断开", invalid: "位置数据无效", incompatible: "地图版本不兼容",
};

export type MinimapViewModel = {
  availability: MinimapAvailability;
  statusLabel: string;
  geometry: MapGeometry | null;
  camera: RadarCamera | null;
  markers: RadarMarker[];
  /** The commander keycard item the plugin authorized for this viewer (CS2 bomb package), or null once faded out. */
  keycard: RadarKeycard | null;
  /** Bombsite letters (CS2 BombZoneA/B), static map data shown whenever the map is; clamped to the edge like markers. */
  bombsites: RadarBombsite[];
  shape: RadarShape;
  viewSize: 250 | 290;
  preferences: RadarPreferences;
  fullMap: boolean;
  viewerAlive: boolean | null;
  zoneLabel: string;
  locationLabel: string;
  effects: { mapBlend: boolean; blurBackground: boolean; pageBackdrop: boolean };
  activeMapScale: number;
  alternateZoomActive: boolean;
  dynamicZoomActive: boolean;
};

/** `hostile` = the card belongs to the other team than the viewer (CS2 draws the enemy's C4 red). */
export type RadarKeycard = RadarPoint & { status: MinimapCommanderKeycard["status"]; state: MinimapCommanderKeycard["state"];
  opacity: number; hostile: boolean };

export type RadarBombsite = RadarPoint & { label: string };

export function shortestAngle(from: number, to: number, amount: number): number {
  return from + ((to - from + 540) % 360 - 180) * amount;
}

/** The player's pose in a buffered frame, if it is the same live, equally visible marker as in the latest frame. */
function bufferedPose(frame: Frame, latest: MinimapPosition): MinimapPosition | undefined {
  const pose = frame.payload.positions.find((position) => position.player_id === latest.player_id);
  return pose && pose.status === "live" && pose.zone === latest.zone && pose.visibility === latest.visibility
    && pose.team_id === latest.team_id ? pose : undefined;
}

/** The latest marker at its pose at plugin time `renderAtMs`: interpolated between captures, never extrapolated. */
function playoutPosition(latest: MinimapPosition, frames: readonly Frame[], renderAtMs: number | null): MinimapPosition {
  const next = renderAtMs === null ? -1 : frames.findIndex((frame) => frame.sampledAtMs >= renderAtMs);
  const to = next === -1 ? undefined : bufferedPose(frames[next], latest);
  if (renderAtMs === null || !to) return latest;
  const pose = (x: number, z: number, yaw: number) => ({ ...latest, x, y: to.y, z, yaw_degrees: yaw, room_id: to.room_id });
  const from = next > 0 ? bufferedPose(frames[next - 1], latest) : undefined;
  if (!from) return pose(to.x, to.z, to.yaw_degrees);
  const amount = (renderAtMs - frames[next - 1].sampledAtMs) / (frames[next].sampledAtMs - frames[next - 1].sampledAtMs);
  return pose(from.x + (to.x - from.x) * amount, from.z + (to.z - from.z) * amount, shortestAngle(from.yaw_degrees, to.yaw_degrees, amount));
}

/**
 * CS2 SetupIconsFromStates fade: last-known `?` and death `X` go linearly from 1 to 0 over 6 s / 4 s.
 * The plugin-side age at capture is advanced by the local monotonic clock since receipt; an expired
 * marker is not drawn even if a later frame still carries it (null).
 */
export function markerOpacity(position: MinimapPosition, receivedAtMs: number, nowMs: number): number | null {
  if (position.status === "live") return 1;
  const lifetime = position.status === "last-known" ? MINIMAP_LAST_KNOWN_MS : MINIMAP_DEAD_MS;
  const age = position.status_age_ms + Math.max(0, nowMs - receivedAtMs);
  return age >= lifetime ? null : Math.min(1, Math.max(0, 1 - age / lifetime));
}

/** CS2 bomb fade: once its side stops seeing it, the card fades from 1 to 0 over 8 s (BOMB_FADE_TIME). */
export function keycardOpacity(keycard: MinimapCommanderKeycard, receivedAtMs: number, nowMs: number): number | null {
  if (keycard.status === "live") return 1;
  const age = keycard.status_age_ms + Math.max(0, nowMs - receivedAtMs);
  return age >= MINIMAP_KEYCARD_FADE_MS ? null : Math.min(1, Math.max(0, 1 - age / MINIMAP_KEYCARD_FADE_MS));
}

function interpolatedRadarPoses(state: MinimapState, frame: Frame | null, nowMs: number) {
  const renderAtMs = state.playout ? state.playout.renderAtMs + (nowMs - state.playout.updatedAtMs) : null;
  // Only live markers are interpolated and may drive the camera or dynamic zoom; last-known and death
  // markers are frozen poses owned by the plugin's CS2 state machine.
  const positions = frame?.payload.positions.filter((position) => position.status === "live")
    .map((position) => playoutPosition(position, state.frames, renderAtMs)) ?? [];
  const fading = frame ? frame.payload.positions.flatMap((position) => {
    const opacity = position.status === "live" ? null : markerOpacity(position, frame.receivedAtMs, nowMs);
    return opacity === null ? [] : [{ position, opacity }];
  }) : [];
  const currentViewpoint = frame?.payload.viewpoint;
  const viewpoint = currentViewpoint
    ? positions.find((position) => position.player_id === currentViewpoint.player_id) ?? currentViewpoint : null;
  return { positions, fading, viewpoint };
}

export function selectMinimap(state: MinimapState, nowMs: number, preferences?: Partial<RadarPreferences>,
  renderCapabilities: Partial<RadarRenderCapabilities> = {}): MinimapViewModel {
  const stale = state.frame !== null && nowMs - state.frame.receivedAtMs > minimapStaleAfterMs(state.init);
  const frame = stale ? null : state.frame;
  const availability = stale ? "stale" : state.availability;
  const normalized = normalizeRadarPreferences(preferences ?? state.preferences);
  const context = radarContext(state, nowMs, normalized);
  const { fullMap, alternateZoomActive, dynamicZoomActive } = context;
  const shape = radarShape(normalized, fullMap);
  const targetMapScale = dynamicZoomActive && state.geometry && context.viewpoint
    ? dynamicZoomTarget(state.geometry, context.viewpoint, context.positions, normalized, context.selectedScale)
    : context.selectedScale;
  const activeMapScale = dynamicZoomActive && state.dynamicZoom?.identity === context.identity
    ? Math.min(targetMapScale, state.dynamicZoom.scale) : targetMapScale;
  // Dynamic fitting, camera and markers share the same displayed poses. A newly
  // authorized target is included even while the followed viewpoint interpolates.
  const { positions, viewpoint } = context;
  const currentViewpoint = frame?.payload.viewpoint;
  const camera = state.geometry ? createRadarCamera(state.geometry, viewpoint, normalized, fullMap, activeMapScale) : null;
  // Frozen last-known / death markers render beneath live markers. Observed players of the other team keep the
  // enemy style; a team-less spectator sees every observed player in its team color.
  const viewerTeam = frame?.payload.viewer.team_id ?? null;
  const decorate = (marker: RadarMarker, teamId: string): RadarMarker => ({ ...marker,
    hostile: viewerTeam !== null && teamId !== viewerTeam,
    followed: Boolean(viewpoint && marker.status === "live" && marker.playerId === viewpoint.player_id) });
  const markers = camera ? [...context.fading.map(({ position, opacity }) => decorate(positionMarker(position, camera, opacity), position.team_id)),
    ...positions.map((position) => decorate(positionMarker(position, camera), position.team_id))] : [];
  const item = frame?.payload.commander_keycard;
  const keycardAlpha = item && frame ? keycardOpacity(item, frame.receivedAtMs, nowMs) : null;
  const keycard = camera && item && keycardAlpha !== null
    ? { ...clampToRadar(item, camera), status: item.status, state: item.state, opacity: keycardAlpha,
      hostile: viewerTeam !== null && item.team_id !== viewerTeam } : null;
  const bombsites = camera ? state.bombsites.map((site) => ({ ...clampToRadar(site, camera), label: site.label })) : [];
  const locationRoom = currentViewpoint?.room_id ? state.geometry?.roomById.get(currentViewpoint.room_id) : null;
  const locationLabel = currentViewpoint
    ? locationRoom?.label ?? (currentViewpoint.zone === "Entrance" ? "办公区" : "重收容区") : "两区概览";
  const pageBackdrop = renderCapabilities.pageBackdrop === true;
  return { availability, statusLabel: STATUS_LABELS[availability], geometry: state.geometry, camera, markers, keycard, bombsites,
    shape, viewSize: shape === "square" ? 290 : 250, locationLabel,
    effects: { mapBlend: normalized.mapBlend, blurBackground: normalized.blurBackground && pageBackdrop, pageBackdrop },
    activeMapScale, alternateZoomActive, dynamicZoomActive,
    preferences: normalized, fullMap, viewerAlive: frame?.payload.viewer.is_alive ?? null,
    zoneLabel: !camera || camera.mode === "overview" ? "办公区 / 重收容区" : camera.zone === "Entrance" ? "办公区" : "重收容区" };
}
