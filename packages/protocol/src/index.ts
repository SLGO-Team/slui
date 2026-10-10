export const PROTOCOL_VERSION = 0 as const;
export const SUPPORTED_SCHEMA_VERSION = 1 as const;
export const MINIMAP_SCHEMA_VERSION = 5 as const;
/** At most one bombsite per letter A-Z. */
export const MINIMAP_MAX_BOMBSITES = 26 as const;
/** CS2 GHOST_FADE_TIME: a last-known marker lives this long after the enemy was last spotted. */
export const MINIMAP_LAST_KNOWN_MS = 6000 as const;
/** CS2 DEAD_FADE_TIME: a death marker lives this long after the death. */
export const MINIMAP_DEAD_MS = 4000 as const;
/** CS2 BOMB_FADE_TIME: a commander keycard no longer seen fades out at its last seen position over this long. */
export const MINIMAP_KEYCARD_FADE_MS = 8000 as const;

export type TeamId = "team-a" | "team-b";
export type Role = "ntf" | "scp";
export type RoundState =
  | "Idle"
  | "WaitingForPlayers"
  | "PreRoundWait"
  | "BuyPhase"
  | "ActionPhase"
  | "RoundEnd"
  | "MatchEnd";

export type IdentityMode =
  | "local-steamid"
  | "session-ticket"
  | "openid"
  | "device-signature";

const IDENTITY_MODES: readonly string[] = ["local-steamid", "session-ticket", "openid", "device-signature"] satisfies readonly IdentityMode[];

export type ServerRoute = {
  protocolVersion: typeof PROTOCOL_VERSION;
  identityMode: IdentityMode;
  steamId: string;
  serverId: string;
  instanceId: string;
  sidecarEndpoint: string;
  sessionToken: string;
  expiresAt: string;
};

export type ProtocolEnvelope<T = Record<string, unknown>, TType extends string = string> = {
  protocol_version: typeof PROTOCOL_VERSION;
  schema_version: number;
  event_id: string;
  server_id: string;
  instance_id: string;
  round_id?: string | null;
  sequence: number;
  type: TType;
  sent_at?: string;
  payload: T;
};

export type MatchLoadoutArmor = "light" | "combat" | "heavy";

/**
 * A teammate's money and equipment (viewer's own team only, like health/shield).
 * Item ids use the shop.snapshot `item_id` vocabulary; NTF primary is an ItemType name,
 * SCP primary is the current role (RoleTypeId name). A dead teammate carries money only.
 */
export type MatchPlayerLoadout = {
  money: number;
  primary_item_id: string | null;
  utility_item_ids: string[];
  armor: MatchLoadoutArmor | null;
  has_commander_keycard: boolean;
  has_generator_upgrade: boolean;
};

export type MatchPlayer = {
  player_id: string;
  display_name: string;
  avatar_url?: string | null;
  is_online: boolean;
  is_alive: boolean;
  health?: number | null;
  shield?: number | null;
  /** Caps of `health` / `shield` (viewer's own team only, like them). Absent from older plugins, which scaled both to 100. */
  max_health?: number | null;
  max_shield?: number | null;
  /** SCP-079 auxiliary power and its cap (viewer's own team, alive SCP-079 only); 079 has no health or shield. */
  aux_power?: number | null;
  max_aux_power?: number | null;
  /** Kills in the current round (the top HUD skulls, as in CS2), reset when the buy phase starts; not the match total. */
  kills?: number;
  /** Viewer's own team only; `null` for an offline teammate. Absent for the other team and for spectators. */
  loadout?: MatchPlayerLoadout | null;
};

export type MatchTeam = {
  team_id: TeamId;
  role: Role;
  display_name: string;
  score: number;
  players: MatchPlayer[];
};

export type MatchSnapshot = {
  viewer_team_id: TeamId | null;
  state: RoundState;
  round: number;
  max_rounds: number;
  phase_remaining_ms: number;
  phase_paused: boolean;
  /** Generator overload time left (smallest over all activating generators); null/absent when none runs. */
  generator_remaining_ms?: number | null;
  /** Tactical pause time left; null/absent when no pause runs. */
  pause_remaining_ms?: number | null;
  teams: [MatchTeam, MatchTeam];
};

export type MinimapInit = {
  minimap_schema_version: typeof MINIMAP_SCHEMA_VERSION;
  map_id: string;
  game_version: "14.2.7";
  map_generator: "@scpsl-tools/map-seed";
  map_generator_version: "1.0.0";
  map_schema_version: 1;
  seed: number;
  holiday: "None" | "Christmas" | "Halloween" | "AprilFools";
  coordinate_system: "unity-world-xz";
  position_update_hz: number;
  /**
   * Bombsites (SLGO generator sites) of this map generation, static for the `map_id`. The plugin alone decides the
   * set, letters and positions; the array order carries no meaning (the letter is the identity). May be empty.
   */
  bombsites: MinimapBombsite[];
};

/**
 * `observed` = shown because the plugin's observation rights (the same rule as nametags and first-person
 * spectating) let this viewer watch that player, e.g. a dead Casual player or an authorized spectator.
 * It is never the viewer, never a teammate of an assigned viewer, and never `last-known`.
 */
export type Visibility = "self" | "teammate" | "spotted-by-self" | "spotted-by-teammate" | "observed";
/** live = real-time pose; last-known = frozen pose of an enemy no longer spotted; dead = death marker. */
export type MarkerStatus = "live" | "last-known" | "dead";
export type MinimapZone = "Entrance" | "HeavyContainment";
export type MinimapPose = {
  x: number;
  y: number;
  z: number;
  yaw_degrees: number;
  zone: MinimapZone;
  room_id: string | null;
};
/**
 * A bombsite centre (CS2 radar `BombZoneA/B`): where the plugin places that site's generator. `label` is one
 * uppercase letter A-Z, unique within the init.
 */
export type MinimapBombsite = Omit<MinimapPose, "yaw_degrees"> & { label: string };
export type MinimapViewer = {
  player_id: string;
  team_id: TeamId | null;
  is_alive: boolean;
};
export type MinimapViewpoint = MinimapPose & { player_id: string };
export type MinimapPosition = MinimapPose & {
  player_id: string;
  team_id: TeamId;
  role: Role;
  visibility: Visibility;
  status: MarkerStatus;
  /** Milliseconds since the marker entered its status; always 0 for live. */
  status_age_ms: number;
  /**
   * Holds the commander keycard (SLGO's C4), at most one marker per frame and only a live one. Like the CS2 bomb
   * carrier, an opponent spotted while holding it reveals the card too.
   */
  has_commander_keycard: boolean;
};
/**
 * Where the commander keycard was when seen: on a holder, lying on the ground, or planted in a generator the NTF
 * side started (CS2 planted bomb).
 */
export type MinimapKeycardState = "carried" | "dropped" | "planted";
/**
 * The commander keycard as a radar item when no visible marker holds it (CS2 bomb package): a pose without heading.
 * `live` = seen this frame, which only a dropped or planted card can be (a seen holder is flagged on its marker);
 * `last-known` = frozen where this viewer's side last saw it, fading over `MINIMAP_KEYCARD_FADE_MS`.
 */
export type MinimapCommanderKeycard = Omit<MinimapPose, "yaw_degrees"> & {
  /** The match team the card belongs to (the side currently playing NTF); opponents of it see the card red. */
  team_id: TeamId;
  status: Exclude<MarkerStatus, "dead">;
  status_age_ms: number;
  state: MinimapKeycardState;
};

export type MinimapPositions = {
  minimap_schema_version: typeof MINIMAP_SCHEMA_VERSION;
  map_id: string;
  visibility_revision: number;
  viewer: MinimapViewer;
  viewpoint: MinimapViewpoint | null;
  scoreboard_visible: boolean;
  positions: MinimapPosition[];
  /**
   * The commander keycard item this viewer knows of, or null (the plugin decides: the NTF side and NTF observers
   * always see a dropped card; the SCP side only while one of its players sees it, then a fading last-known item).
   * Always null while a marker in this frame holds the card.
   */
  commander_keycard: MinimapCommanderKeycard | null;
};

export type ShopItem = {
  item_id: string;
  name: string;
  description?: string;
  icon_url?: string | null;
  price: number;
  quantity: number | null;
  /** Remaining purchasable quantity; null means unlimited. */
  category_id?: string | null;
  /** Quantity already owned by the viewer, when supplied by the plugin. */
  owned_quantity?: number | null;
  purchasable: boolean;
  unavailable_reason?: string | null;
};

export type ShopCategory = { id: string; label: string; order: number };

export type ShopSnapshot = {
  balance: number;
  /** Plugin-authoritative minimum money required for the next round. */
  next_round_min_money?: number | null;
  items: ShopItem[];
  window_open: boolean;
  categories?: ShopCategory[];
};

export type ChatScope = "global" | "team" | "spectator";
export type ChatMessage = {
  message_id: string;
  scope: ChatScope;
  sender_id: string;
  sender_name: string;
  team_id?: TeamId | null;
  role?: Role | null;
  body: string;
  sent_at: string;
  /** The client command that produced this message; absent for messages sent from the game. */
  command_id?: string | null;
};

/** Semantic colour of a notice segment; the client maps it to its own palette. */
export type ChatNoticeTone = "default" | "money" | "muted";
export type ChatNoticeSegment = { text: string; tone: ChatNoticeTone };
/** A plugin notice in the chat history (money, joins, ...): text without a sender. */
export type ChatNotice = {
  notice_id: string;
  segments: ChatNoticeSegment[];
  sent_at: string;
};
export const MAX_CHAT_NOTICE_SEGMENTS = 8;
export const MAX_CHAT_NOTICE_LENGTH = 512;

/** Semantic style of a HUD message (plugin `HudTone`); the client maps it to its own palette. */
export const HUD_TONES = ["default", "success", "warning", "info", "gold", "match_point", "final_round", "ntf_team", "scp_team"] as const;
export type HudTone = (typeof HUD_TONES)[number];
/** Longest HUD text (UTF-16 code units, as JS `length` and C# `string.Length` count). */
export const MAX_HUD_TEXT_LENGTH = 256;
/** Upper bound of every HUD `*_ms` value (one day). */
export const MAX_HUD_REMAINING_MS = 86_400_000;
/** Literal token the plugin leaves in `text` for the client to draw as a local `m:ss` countdown. */
export const HUD_TIME_REMAINING_TOKEN = "{time_remaining}";
/** Literal token for the same countdown drawn as whole seconds rounded up (`40`, ..., `1`, `0`). */
export const HUD_SECONDS_REMAINING_TOKEN = "{seconds_remaining}";

/**
 * One slot of the plugin's per-player message board. All times are remaining milliseconds at the envelope's
 * `sent_at`, interpolated with the client's receive time only.
 */
export type HudSlotMessage = {
  /** Plugin board sequence; changes on every write, including countdown rewrites. */
  message_id: string;
  /** Catalog key (CS2 localisation key or SLGO_*); a style hook only, never shown. */
  key: string;
  /** Plugin-resolved plain text (may contain `\n`); may contain `HUD_TIME_REMAINING_TOKEN`. */
  text: string;
  tone: HudTone;
  /** Time until the message expires on its own; null = until replaced or cleared. */
  visible_remaining_ms: number | null;
  /** Value of the countdown token; non-null exactly when `text` contains one. */
  countdown_remaining_ms: number | null;
};
export type HudProgress = { remaining_ms: number; total_ms: number };
export type HudProgressMessage = HudSlotMessage & { progress: HudProgress };
/** `hud.messages`: the viewer's four message slots, top to bottom on screen (CS2 progress bar, alerts, high and low hints). */
export type HudMessagesSnapshot = {
  progress: HudProgressMessage | null;
  alert: HudSlotMessage | null;
  hint_high: HudSlotMessage | null;
  hint_low: HudSlotMessage | null;
};

export type RoundResultTeam = "ntf" | "scp";
/** Viewer-relative outcome: `draw` exactly when `winner_team` is null, `observer` for a viewer without a side. */
export type RoundResultOutcome = "won" | "lost" | "draw" | "observer";
export const ROUND_RESULT_OUTCOMES = ["won", "lost", "draw", "observer"] as const satisfies readonly RoundResultOutcome[];
export type RoundResultMvp = {
  /** SteamID64; the avatar comes from the player's `match.snapshot` entry. */
  player_id: string;
  display_name: string;
  /** Plugin-resolved award label, e.g. 最多击杀MVP（3杀）. */
  reason_text: string;
  music_kit_name: string | null;
};
export type RoundResultPanel = {
  /** One per plugin ShowRoundResult call. */
  result_id: string;
  /** null = draw, which only a match end can be. */
  winner_team: RoundResultTeam | null;
  is_match_end: boolean;
  /** Plugin-resolved, viewer-relative title. */
  title: { text: string; outcome: RoundResultOutcome };
  /** The line under the title (end reason today, a fun fact later). */
  subtitle_text: string | null;
  mvp: RoundResultMvp | null;
  /** Panel hold time left at `sent_at`. */
  visible_remaining_ms: number;
};
/** `round.result`: the win panel, or null once it ended early (new round, match restart). */
export type RoundResultSnapshot = { panel: RoundResultPanel | null };

/** Reserve-ammo icon of the held firearm (CS2 per-ammo reserve icons). */
export const HUD_RESERVE_ICONS = ["bullet", "shotgun_shell", "revolver_loader"] as const;
export type HudReserveIcon = (typeof HUD_RESERVE_ICONS)[number];
/** Kill-card pip: `grenade` for explosions, `shock` for Micro-HID, `default` for every other kill. */
export const HUD_KILL_KINDS = ["default", "grenade", "shock"] as const;
export type HudKillKind = (typeof HUD_KILL_KINDS)[number];
/** Largest ammo count `hud.status` carries (the plugin's counters are 16-bit). */
export const MAX_HUD_AMMO = 65_535;
/** Most kills one `hud.status` lists for a round. */
export const MAX_HUD_ROUND_KILLS = 64;
export type HudAmmo = {
  /** Rounds ready to fire (magazine + chambered), as the game's own counter shows. */
  clip: number;
  /** Clip capacity, at least 1; the clip bar and the low-ammo threshold use it. A chambered round may exceed it. */
  clip_max: number;
  /** Reserve rounds of this firearm (not magazines). */
  reserve: number;
  reserve_icon: HudReserveIcon;
};
/** `hud.status`: the viewer's own bottom-HUD state (one recipient; sent only to clients declaring `hud-status`). */
export type HudStatusSnapshot = {
  /** Held firearm; null when the held item is not a firearm (SCP, unarmed, Micro-HID, keycard, ...) or the player is dead. */
  ammo: HudAmmo | null;
  /** One entry per kill this round, in order; reset when the buy phase starts (same rule as match.snapshot `kills`). */
  round_kills: HudKillKind[];
};

export type ShopPurchaseCommand = {
  kind: "command.shop.purchase";
  command_id: string;
  item_id: string;
  quantity: number;
};
export type ChatSendCommand = {
  kind: "command.chat.send";
  command_id: string;
  scope: ChatScope;
  body: string;
};
export type SlgoCommand = ShopPurchaseCommand | ChatSendCommand;

export type CommandResult = {
  command_id: string;
  command_kind: SlgoCommand["kind"];
  status: "accepted" | "rejected" | "duplicate" | "failed";
  reason?: string;
};

export type BaselineEvent = ProtocolEnvelope<{ baseline: true }, "sidecar.baseline">;
export type MatchSnapshotEvent = ProtocolEnvelope<MatchSnapshot, "match.snapshot"> & { sent_at: string };
export type MinimapInitEvent = ProtocolEnvelope<MinimapInit, "minimap.init"> & { round_id: string; sent_at: string };
export type MinimapPositionsEvent = ProtocolEnvelope<MinimapPositions, "minimap.positions"> & { round_id: string; sent_at: string };
export type HudMessagesEvent = ProtocolEnvelope<HudMessagesSnapshot, "hud.messages"> & { sent_at: string };
export type RoundResultEvent = ProtocolEnvelope<RoundResultSnapshot, "round.result"> & { sent_at: string };
export type HudStatusEvent = ProtocolEnvelope<HudStatusSnapshot, "hud.status">;

export type SlgoEvent =
  | BaselineEvent
  | MatchSnapshotEvent
  | MinimapInitEvent
  | MinimapPositionsEvent
  | HudMessagesEvent
  | RoundResultEvent
  | HudStatusEvent
  | ProtocolEnvelope<ShopSnapshot, "shop.snapshot">
  | ProtocolEnvelope<ChatMessage, "chat.message">
  | ProtocolEnvelope<ChatNotice, "chat.notice">
  | ProtocolEnvelope<CommandResult, "command.result">;

export type ParseErrorCode =
  | "invalid-json"
  | "invalid-envelope"
  | "unsupported-protocol"
  | "unsupported-schema"
  | "unsupported-minimap-schema"
  | "unsupported-minimap-map"
  | "invalid-route"
  | "invalid-payload"
  | "unsupported-event-type"
  | "stale-sequence"
  | "wrong-instance"
  | "baseline-required"
  | "expired-route"
  | "unauthorized"
  | "not-in-game"
  | "rate-limited";

export type ParseError = { code: ParseErrorCode; message: string; eventId?: string };
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseError };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isTeamId = (value: unknown): value is TeamId => value === "team-a" || value === "team-b";
const isRole = (value: unknown): value is Role => value === "ntf" || value === "scp";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const ENVELOPE_KEYS = new Set([
  "protocol_version",
  "schema_version",
  "event_id",
  "server_id",
  "instance_id",
  "round_id",
  "sequence",
  "type",
  "sent_at",
  "payload",
]);

function error(code: ParseErrorCode, message: string, eventId?: string): ParseResult<never> {
  return { ok: false, error: { code, message, eventId } };
}

export function parseEnvelope(raw: unknown): ParseResult<ProtocolEnvelope> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return error("invalid-json", "Event payload is not valid JSON");
    }
  }
  if (!isRecord(value)) return error("invalid-envelope", "Envelope must be an object");
  if (Object.keys(value).some((key) => !ENVELOPE_KEYS.has(key))) return error("invalid-envelope", "Envelope contains unsupported fields");
  const eventId = value.event_id;
  if (value.protocol_version !== PROTOCOL_VERSION) return error("unsupported-protocol", "Unsupported protocol version", typeof eventId === "string" ? eventId : undefined);
  if (value.schema_version !== SUPPORTED_SCHEMA_VERSION) return error("unsupported-schema", "Unsupported schema version", typeof eventId === "string" ? eventId : undefined);
  if (!isNonEmptyString(eventId) || !isNonEmptyString(value.server_id) || !isNonEmptyString(value.instance_id) || !isNonEmptyString(value.type) || !isRecord(value.payload)) {
    return error("invalid-envelope", "Envelope identity, type, and payload are required", typeof eventId === "string" ? eventId : undefined);
  }
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0) return error("invalid-envelope", "Sequence must be a non-negative safe integer", eventId);
  if (value.round_id !== undefined && value.round_id !== null && !isNonEmptyString(value.round_id)) return error("invalid-envelope", "Round id must be a non-empty string or null", eventId);
  if (value.sent_at !== undefined && (!isNonEmptyString(value.sent_at) || !Number.isFinite(Date.parse(value.sent_at)))) return error("invalid-envelope", "Sent timestamp must be an ISO date-time", eventId);
  return { ok: true, value: value as unknown as ProtocolEnvelope };
}

/** First client frame on a sidecar WebSocket; everything after it is a SlgoCommand. */
export type SessionOpen = {
  protocol_version: typeof PROTOCOL_VERSION;
  schema_version: typeof SUPPORTED_SCHEMA_VERSION;
  type: "session.open";
  session_token: string;
  /** Minimap payload versions the client can render; the sidecar sends minimap events only if it shares one. */
  minimap_schema_versions: number[];
};

/** WebSocket close codes a sidecar uses to end or refuse a client session. */
export const SIDECAR_CLOSE_CODES = {
  /** First frame missing, late, not a valid session.open, or a frame was sent before the baseline. */
  invalidHandshake: 4000,
  /** Session token invalid, expired or not for this sidecar; source address is not the player's game connection; player left or their address changed. */
  unauthorized: 4001,
  /** protocol_version or schema_version is not supported. */
  unsupportedProtocol: 4002,
  /** The routed server instance is unknown or has ended; resolve a new route. */
  instanceUnavailable: 4003,
} as const;
export type SidecarCloseCode = (typeof SIDECAR_CLOSE_CODES)[keyof typeof SIDECAR_CLOSE_CODES];

const SESSION_OPEN_KEYS = new Set(["protocol_version", "schema_version", "type", "session_token", "minimap_schema_versions"]);

export function parseSessionOpen(raw: unknown): ParseResult<SessionOpen> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return error("invalid-json", "Session open is not valid JSON");
    }
  }
  if (!isRecord(value) || value.type !== "session.open") return error("invalid-envelope", "First frame must be session.open");
  if (Object.keys(value).some((key) => !SESSION_OPEN_KEYS.has(key))) return error("invalid-envelope", "Session open contains unsupported fields");
  if (value.protocol_version !== PROTOCOL_VERSION) return error("unsupported-protocol", "Unsupported protocol version");
  if (value.schema_version !== SUPPORTED_SCHEMA_VERSION) return error("unsupported-schema", "Unsupported schema version");
  if (!isNonEmptyString(value.session_token)) return error("invalid-envelope", "Session token is required");
  const versions = value.minimap_schema_versions;
  if (!Array.isArray(versions) || !versions.every((version) => Number.isInteger(version) && version >= 1) || new Set(versions).size !== versions.length) {
    return error("invalid-envelope", "Minimap schema versions must be unique positive integers");
  }
  return { ok: true, value: value as unknown as SessionOpen };
}

/**
 * Client frame after the baseline: the features this SLUI connection currently
 * takes over from the plugin. Always the full list; `[]` = none.
 */
export type ClientFeatures = { type: "client.features"; features: string[] };
/** SLUI owns text chat for this player: the input hotkeys (Y global, U team) and the message feed. */
export const CLIENT_FEATURE_CHAT_INPUT = "chat-input";
/** SLUI owns the buy-menu hotkey (B) for this player. */
export const CLIENT_FEATURE_SHOP_MENU = "shop-menu";
/** SLUI owns the top HUD (score, round clock, team counts) for this player. */
export const CLIENT_FEATURE_TOP_HUD = "top-hud";
/** SLUI owns the bottom-centre message zone (all four `hud.messages` slots) for this player. */
export const CLIENT_FEATURE_HUD_MESSAGES = "hud-messages";
/** SLUI owns the round / match result panel (`round.result`) for this player. */
export const CLIENT_FEATURE_WIN_PANEL = "win-panel";
/** SLUI owns the balance display: the plugin hides its own balance hint for this player. */
export const CLIENT_FEATURE_HUD_MONEY = "hud-money";
/** SLUI draws the bottom HUD and wants `hud.status` (ammo, round kills) for this player. */
export const CLIENT_FEATURE_HUD_STATUS = "hud-status";
export const MAX_CLIENT_FEATURES = 16;
const MAX_CLIENT_FEATURE_LENGTH = 64;
const CLIENT_FEATURE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function parseClientFeatures(raw: unknown): ParseResult<ClientFeatures> {
  if (!isRecord(raw) || raw.type !== "client.features") return error("invalid-payload", "Frame must be client.features");
  if (Object.keys(raw).some((key) => key !== "type" && key !== "features")) return error("invalid-payload", "client.features contains unsupported fields");
  const features = raw.features;
  if (!Array.isArray(features) || features.length > MAX_CLIENT_FEATURES) return error("invalid-payload", `Features must be an array of at most ${MAX_CLIENT_FEATURES}`);
  if (!features.every((item) => typeof item === "string" && item.length <= MAX_CLIENT_FEATURE_LENGTH && CLIENT_FEATURE_NAME.test(item))) {
    return error("invalid-payload", "Features must be lowercase kebab-case names");
  }
  if (new Set(features).size !== features.length) return error("invalid-payload", "Features contain duplicates");
  return { ok: true, value: raw as ClientFeatures };
}

/** Wire form of an identity proof sent to the control plane (`POST /v0/route`). */
export type IdentityProofWire =
  | { kind: "local-steamid" }
  | { kind: "session-ticket"; ticket: string; app_id: number }
  | { kind: "openid"; claimed_id: string }
  | { kind: "device-signature"; device_id: string; signature: string };

export type RouteRequest = {
  protocol_version: typeof PROTOCOL_VERSION;
  type: "control.route.request";
  steam_id: string;
  proof: IdentityProofWire;
};

export type RouteRejectionReason = "invalid-request" | "unsupported-protocol" | "unauthorized" | "not-in-game" | "rate-limited";
export type RouteRejected = {
  protocol_version: typeof PROTOCOL_VERSION;
  type: "control.route.rejected";
  reason: RouteRejectionReason;
  message?: string;
};

const PROOF_FIELDS: Record<IdentityProofWire["kind"], readonly string[]> = {
  "local-steamid": [],
  "session-ticket": ["ticket", "app_id"],
  openid: ["claimed_id"],
  "device-signature": ["device_id", "signature"],
};

export function parseRouteRequest(raw: unknown): ParseResult<RouteRequest> {
  if (!isRecord(raw) || raw.type !== "control.route.request") return error("invalid-route", "Request is not a route request");
  if (raw.protocol_version !== PROTOCOL_VERSION) return error("unsupported-protocol", "Unsupported protocol version");
  if (Object.keys(raw).some((key) => !["protocol_version", "type", "steam_id", "proof"].includes(key))) return error("invalid-route", "Route request contains unsupported fields");
  if (typeof raw.steam_id !== "string" || !/^[0-9]{17}$/.test(raw.steam_id)) return error("invalid-route", "steam_id must be a SteamID64");
  const proof = raw.proof;
  if (!isRecord(proof) || typeof proof.kind !== "string" || !(proof.kind in PROOF_FIELDS)) return error("invalid-route", "Proof kind is invalid");
  const fields = PROOF_FIELDS[proof.kind as IdentityProofWire["kind"]];
  if (Object.keys(proof).some((key) => key !== "kind" && !fields.includes(key))) return error("invalid-route", "Proof contains unsupported fields");
  for (const field of fields) {
    const value = proof[field];
    const valid = field === "app_id" ? Number.isSafeInteger(value) && Number(value) > 0 : isNonEmptyString(value);
    if (!valid) return error("invalid-route", `Proof ${field} is invalid`);
  }
  return { ok: true, value: raw as unknown as RouteRequest };
}

export function parseRouteRejected(raw: unknown): ParseResult<RouteRejected> {
  if (!isRecord(raw) || raw.protocol_version !== PROTOCOL_VERSION || raw.type !== "control.route.rejected") return error("invalid-route", "Response is not a route rejection");
  if (!["invalid-request", "unsupported-protocol", "unauthorized", "not-in-game", "rate-limited"].includes(String(raw.reason))) return error("invalid-route", "Route rejection reason is invalid");
  if (raw.message !== undefined && typeof raw.message !== "string") return error("invalid-route", "Route rejection message is invalid");
  return { ok: true, value: raw as unknown as RouteRejected };
}

export function parseRoute(raw: unknown, now = Date.now()): ParseResult<ServerRoute> {
  if (!isRecord(raw) || raw.protocol_version !== PROTOCOL_VERSION || raw.type !== "control.route.resolved") return error("invalid-route", "Route is not a protocol v0 route");
  if (!isNonEmptyString(raw.steam_id) || !/^[0-9]{17}$/.test(raw.steam_id) || !isNonEmptyString(raw.server_id) || !isNonEmptyString(raw.instance_id) || !isNonEmptyString(raw.session_token) || typeof raw.sidecar_endpoint !== "string" || !raw.sidecar_endpoint.startsWith("wss://")) return error("invalid-route", "Route fields are invalid");
  if (!isNonEmptyString(raw.expires_at)) return error("invalid-route", "Route expiry is required");
  const expiresAt = Date.parse(raw.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return error("expired-route", "Route has expired");
  const identityMode = raw.identity_mode;
  if (!IDENTITY_MODES.includes(String(identityMode))) return error("invalid-route", "Identity mode is invalid");
  return {
    ok: true,
    value: {
      protocolVersion: PROTOCOL_VERSION,
      identityMode: identityMode as IdentityMode,
      steamId: raw.steam_id,
      serverId: raw.server_id,
      instanceId: raw.instance_id,
      sidecarEndpoint: raw.sidecar_endpoint,
      sessionToken: raw.session_token,
      expiresAt: raw.expires_at,
    },
  };
}

/** Optional clock: absent or null means "not running"; otherwise a non-negative integer of milliseconds. */
const isOptionalRemainingMs = (value: unknown): boolean =>
  value === undefined || value === null || (Number.isInteger(value) && Number(value) >= 0);

/** Viewer-team-only numeric vitals: absent, null, or a finite non-negative number. */
const MATCH_PLAYER_VITAL_KEYS = ["health", "shield", "max_health", "max_shield", "aux_power", "max_aux_power"] as const;

function isMatchPlayerLoadout(value: unknown): value is MatchPlayerLoadout {
  return isRecord(value)
    && Number.isInteger(value.money) && Number(value.money) >= 0
    && (value.primary_item_id === null || isNonEmptyString(value.primary_item_id))
    && Array.isArray(value.utility_item_ids) && value.utility_item_ids.every(isNonEmptyString)
    && (value.armor === null || value.armor === "light" || value.armor === "combat" || value.armor === "heavy")
    && typeof value.has_commander_keycard === "boolean"
    && typeof value.has_generator_upgrade === "boolean";
}

export function parseMatchSnapshot(payload: unknown): ParseResult<MatchSnapshot> {
  if (!isRecord(payload) || (payload.viewer_team_id !== null && !isTeamId(payload.viewer_team_id)) || !["Idle", "WaitingForPlayers", "PreRoundWait", "BuyPhase", "ActionPhase", "RoundEnd", "MatchEnd"].includes(String(payload.state)) || !Number.isInteger(payload.round) || Number(payload.round) < 0 || !Number.isInteger(payload.max_rounds) || Number(payload.max_rounds) < 1 || !Number.isInteger(payload.phase_remaining_ms) || Number(payload.phase_remaining_ms) < 0 || typeof payload.phase_paused !== "boolean" || !Array.isArray(payload.teams) || payload.teams.length !== 2) return error("invalid-payload", "Match snapshot is invalid");
  if (!isOptionalRemainingMs(payload.generator_remaining_ms) || !isOptionalRemainingMs(payload.pause_remaining_ms)) return error("invalid-payload", "Match snapshot clocks are invalid");
  const teams = payload.teams.map((team) => {
    if (!isRecord(team) || !isTeamId(team.team_id) || !isRole(team.role) || !isNonEmptyString(team.display_name) || !Number.isInteger(team.score) || !Array.isArray(team.players)) return null;
    const players = team.players.map((player) => {
      if (!isRecord(player) || !isNonEmptyString(player.player_id) || typeof player.display_name !== "string" || typeof player.is_online !== "boolean" || typeof player.is_alive !== "boolean") return null;
      const vitals = MATCH_PLAYER_VITAL_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(player, key));
      if (vitals.length > 0 && team.team_id !== payload.viewer_team_id) return null;
      if (!vitals.every((key) => { const value = player[key]; return value === null || (isFiniteNumber(value) && value >= 0); })) return null;
      // Money and equipment follow the same viewer-team-only rule as the vitals.
      if (Object.prototype.hasOwnProperty.call(player, "loadout")) {
        if (team.team_id !== payload.viewer_team_id) return null;
        if (player.loadout !== null && !isMatchPlayerLoadout(player.loadout)) return null;
      }
      // Kills are public for both teams, unlike the viewer-only vitals.
      if (Object.prototype.hasOwnProperty.call(player, "kills")
        && (!Number.isInteger(player.kills) || Number(player.kills) < 0)) return null;
      return player as unknown as MatchPlayer;
    });
    return players.every(Boolean) ? { ...team, players } as unknown as MatchTeam : null;
  });
  if (!teams.every(Boolean)) return error("invalid-payload", "Match team is invalid");
  const validTeams = teams as [MatchTeam, MatchTeam];
  if (validTeams[0].team_id === validTeams[1].team_id || validTeams[0].role === validTeams[1].role) {
    return error("invalid-payload", "Match teams must have unique ids and roles");
  }
  return { ok: true, value: { ...payload, teams: validTeams } as unknown as MatchSnapshot };
}

export function parseMinimapInit(payload: unknown): ParseResult<MinimapInit> {
  if (!isRecord(payload)) return error("invalid-payload", "Minimap init must be an object");
  if (payload.minimap_schema_version !== MINIMAP_SCHEMA_VERSION) return error("unsupported-minimap-schema", "Unsupported minimap payload version");
  if (!hasOnlyKeys(payload, MINIMAP_INIT_KEYS)) return error("invalid-payload", "Minimap init contains unsupported fields");
  if (payload.game_version !== "14.2.7" || payload.map_generator !== "@scpsl-tools/map-seed" || payload.map_generator_version !== "1.0.0" || payload.map_schema_version !== 1 || payload.coordinate_system !== "unity-world-xz") return error("unsupported-minimap-map", "Unsupported minimap generator, template, or coordinates");
  if (!isNonEmptyString(payload.map_id) || !Number.isSafeInteger(payload.seed) || Number(payload.seed) < 1 || Number(payload.seed) > 2147483647 || typeof payload.holiday !== "string" || !["None", "Christmas", "Halloween", "AprilFools"].includes(payload.holiday) || !isFiniteNumber(payload.position_update_hz) || payload.position_update_hz <= 0 || payload.position_update_hz > 60) return error("invalid-payload", "Minimap init is invalid");
  if (!Array.isArray(payload.bombsites) || payload.bombsites.length > MINIMAP_MAX_BOMBSITES) return error("invalid-payload", "Minimap bombsites are invalid");
  const labels = new Set<string>();
  for (const site of payload.bombsites as unknown[]) {
    if (!isRecord(site) || !hasOnlyKeys(site, MINIMAP_BOMBSITE_KEYS) || typeof site.label !== "string" || !/^[A-Z]$/.test(site.label) || !isMinimapPlace(site)) return error("invalid-payload", "Minimap bombsite is invalid");
    if (labels.has(site.label)) return error("invalid-payload", "Minimap bombsite labels must be unique");
    labels.add(site.label);
  }
  return { ok: true, value: payload as unknown as MinimapInit };
}

const MINIMAP_INIT_KEYS = new Set(["minimap_schema_version", "map_id", "game_version", "map_generator", "map_generator_version", "map_schema_version", "seed", "holiday", "coordinate_system", "position_update_hz", "bombsites"]);
const MINIMAP_BOMBSITE_KEYS = new Set(["label", "x", "y", "z", "zone", "room_id"]);
const MINIMAP_FRAME_KEYS = new Set(["minimap_schema_version", "map_id", "visibility_revision", "viewer", "viewpoint", "scoreboard_visible", "positions", "commander_keycard"]);
const MINIMAP_VIEWER_KEYS = new Set(["player_id", "team_id", "is_alive"]);
const MINIMAP_POSE_KEYS = ["x", "y", "z", "yaw_degrees", "zone", "room_id"] as const;
const MINIMAP_VIEWPOINT_KEYS = new Set<string>(["player_id", ...MINIMAP_POSE_KEYS]);
const MINIMAP_POSITION_KEYS = new Set<string>(["player_id", "team_id", "role", "visibility", "status", "status_age_ms", "has_commander_keycard", ...MINIMAP_POSE_KEYS]);
const MINIMAP_KEYCARD_KEYS = new Set<string>(["x", "y", "z", "zone", "room_id", "team_id", "status", "status_age_ms", "state"]);

function isMarkerStatusAge(status: unknown, age: unknown): boolean {
  if (!Number.isSafeInteger(age) || Number(age) < 0) return false;
  if (status === "live") return age === 0;
  if (status === "last-known") return Number(age) < MINIMAP_LAST_KNOWN_MS;
  if (status === "dead") return Number(age) < MINIMAP_DEAD_MS;
  return false;
}
const hasOnlyKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>) => Object.keys(value).every((key) => keys.has(key));

function isMinimapPlace(value: Record<string, unknown>): boolean {
  return isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)
    && (value.zone === "Entrance" || value.zone === "HeavyContainment")
    && (value.room_id === null || isNonEmptyString(value.room_id));
}

function isMinimapPose(value: Record<string, unknown>): boolean {
  return isMinimapPlace(value) && isFiniteNumber(value.yaw_degrees) && value.yaw_degrees >= 0 && value.yaw_degrees < 360;
}

export function parseMinimapPositions(payload: unknown): ParseResult<MinimapPositions> {
  if (!isRecord(payload)) return error("invalid-payload", "Minimap positions must be an object");
  if (payload.minimap_schema_version !== MINIMAP_SCHEMA_VERSION) return error("unsupported-minimap-schema", "Unsupported minimap payload version");
  if (!hasOnlyKeys(payload, MINIMAP_FRAME_KEYS) || !isNonEmptyString(payload.map_id) || !Number.isSafeInteger(payload.visibility_revision) || Number(payload.visibility_revision) < 0 || typeof payload.scoreboard_visible !== "boolean" || !Array.isArray(payload.positions)) return error("invalid-payload", "Minimap positions are invalid");
  const viewer = payload.viewer;
  if (!isRecord(viewer) || !hasOnlyKeys(viewer, MINIMAP_VIEWER_KEYS) || !isNonEmptyString(viewer.player_id) || (viewer.team_id !== null && !isTeamId(viewer.team_id)) || typeof viewer.is_alive !== "boolean") return error("invalid-payload", "Minimap viewer is invalid");
  const viewerTeam = viewer.team_id;
  const ids = new Set<string>();
  const positions: MinimapPosition[] = [];
  for (const position of payload.positions) {
    if (!isRecord(position) || !hasOnlyKeys(position, MINIMAP_POSITION_KEYS) || !isNonEmptyString(position.player_id) || !isTeamId(position.team_id) || !isRole(position.role) || typeof position.visibility !== "string" || !["self", "teammate", "spotted-by-self", "spotted-by-teammate", "observed"].includes(position.visibility) || typeof position.status !== "string" || !isMarkerStatusAge(position.status, position.status_age_ms) || typeof position.has_commander_keycard !== "boolean" || !isMinimapPose(position)) return error("invalid-payload", "Minimap positions contain an invalid marker");
    if (ids.has(position.player_id)) return error("invalid-payload", "Minimap player ids must be unique");
    ids.add(position.player_id);
    const isViewer = position.player_id === viewer.player_id;
    const isFriendly = position.team_id === viewer.team_id;
    if (viewerTeam === null && position.visibility !== "observed") return error("invalid-payload", "A viewer without a team can only receive observed markers");
    if (position.visibility === "observed") {
      if (isViewer || (viewerTeam !== null && isFriendly) || position.status === "last-known") return error("invalid-payload", "Minimap observed marker is invalid");
    } else if (position.visibility === "self") {
      if (!isViewer || !isFriendly || position.status === "last-known" || (position.status === "live") !== viewer.is_alive) return error("invalid-payload", "Minimap self does not match the viewer");
    } else if (position.visibility === "teammate") {
      if (isViewer || !isFriendly || position.status === "last-known") return error("invalid-payload", "Minimap teammate does not match the viewer team");
    } else if (isViewer || isFriendly || (position.visibility === "spotted-by-self" && !viewer.is_alive)) {
      return error("invalid-payload", "Minimap enemy visibility is invalid");
    }
    if (position.has_commander_keycard && position.status !== "live") return error("invalid-payload", "Only a live marker may carry the commander keycard");
    positions.push(position as unknown as MinimapPosition);
  }
  const holders = positions.filter((position) => position.has_commander_keycard).length;
  if (holders > 1) return error("invalid-payload", "Only one player can carry the commander keycard");
  const keycard = payload.commander_keycard;
  if (keycard !== null && (!isRecord(keycard) || !hasOnlyKeys(keycard, MINIMAP_KEYCARD_KEYS) || !isMinimapPlace(keycard) || !isTeamId(keycard.team_id)
    || !["carried", "dropped", "planted"].includes(String(keycard.state)) || !Number.isSafeInteger(keycard.status_age_ms) || Number(keycard.status_age_ms) < 0
    || (keycard.status === "live" ? keycard.status_age_ms !== 0 || keycard.state === "carried"
      : keycard.status !== "last-known" || Number(keycard.status_age_ms) >= MINIMAP_KEYCARD_FADE_MS))) return error("invalid-payload", "Minimap commander keycard is invalid");
  if (keycard !== null && holders > 0) return error("invalid-payload", "The commander keycard cannot be both on a marker and a radar item");
  const viewpoint = payload.viewpoint;
  if (viewpoint !== null) {
    if (!isRecord(viewpoint) || !hasOnlyKeys(viewpoint, MINIMAP_VIEWPOINT_KEYS) || !isNonEmptyString(viewpoint.player_id) || !isMinimapPose(viewpoint)) return error("invalid-payload", "Minimap viewpoint is invalid");
    const target = positions.find((position) => position.player_id === viewpoint.player_id);
    const allowed = viewer.is_alive ? ["self"] : ["teammate", "observed"];
    if (!target || target.status !== "live" || !allowed.includes(target.visibility) || !MINIMAP_POSE_KEYS.every((key) => target[key] === viewpoint[key])) return error("invalid-payload", "Minimap viewpoint must match a living authorized player pose");
  }
  return { ok: true, value: { ...payload, positions } as unknown as MinimapPositions };
}

export function parseShopSnapshot(payload: unknown): ParseResult<ShopSnapshot> {
  if (!isRecord(payload) || !Number.isInteger(payload.balance) || Number(payload.balance) < 0 || typeof payload.window_open !== "boolean" || !Array.isArray(payload.items)) return error("invalid-payload", "Shop snapshot is invalid");
  if (payload.next_round_min_money !== undefined && payload.next_round_min_money !== null && (!Number.isInteger(payload.next_round_min_money) || Number(payload.next_round_min_money) < 0)) return error("invalid-payload", "Shop minimum money is invalid");
  const categoriesRaw = payload.categories;
  if (categoriesRaw !== undefined && !Array.isArray(categoriesRaw)) return error("invalid-payload", "Shop categories are invalid");
  const categories = categoriesRaw?.map((category) => {
    if (!isRecord(category) || !isNonEmptyString(category.id) || !isNonEmptyString(category.label) || !Number.isInteger(category.order)) return null;
    return category as unknown as ShopCategory;
  });
  if (categories && !categories.every(Boolean)) return error("invalid-payload", "Shop categories contain an invalid entry");
  if (categories) {
    const ids = new Set<string>();
    for (const category of categories as ShopCategory[]) {
      if (ids.has(category.id)) return error("invalid-payload", "Shop category ids must be unique");
      ids.add(category.id);
    }
  }
  const items = payload.items.map((item) => {
    if (!isRecord(item) || !isNonEmptyString(item.item_id) || !isNonEmptyString(item.name) || !Number.isInteger(item.price) || Number(item.price) < 0 || (item.quantity !== null && (!Number.isInteger(item.quantity) || Number(item.quantity) < 0)) || typeof item.purchasable !== "boolean") return null;
    if (item.description !== undefined && typeof item.description !== "string") return null;
    if (item.icon_url !== undefined && item.icon_url !== null && typeof item.icon_url !== "string") return null;
    if (item.unavailable_reason !== undefined && item.unavailable_reason !== null && typeof item.unavailable_reason !== "string") return null;
    if (item.category_id !== undefined && item.category_id !== null && !isNonEmptyString(item.category_id)) return null;
    if (item.owned_quantity !== undefined && item.owned_quantity !== null && (!Number.isInteger(item.owned_quantity) || Number(item.owned_quantity) < 0)) return null;
    return item as unknown as ShopItem;
  });
  if (!items.every(Boolean)) return error("invalid-payload", "Shop snapshot contains an invalid item");
  return { ok: true, value: { balance: payload.balance as number, next_round_min_money: payload.next_round_min_money as number | null | undefined, window_open: payload.window_open, items: items as ShopItem[], ...(categories ? { categories: categories as ShopCategory[] } : {}) } };
}

export function parseChatMessage(payload: unknown): ParseResult<ChatMessage> {
  if (!isRecord(payload) || !isNonEmptyString(payload.message_id) || !["global", "team", "spectator"].includes(String(payload.scope)) || !isNonEmptyString(payload.sender_id) || typeof payload.sender_name !== "string" || typeof payload.body !== "string" || !isNonEmptyString(payload.sent_at) || !Number.isFinite(Date.parse(payload.sent_at))) return error("invalid-payload", "Chat message is invalid");
  if (payload.team_id !== undefined && payload.team_id !== null && !isTeamId(payload.team_id)) return error("invalid-payload", "Chat team is invalid");
  if (payload.role !== undefined && payload.role !== null && !isRole(payload.role)) return error("invalid-payload", "Chat role is invalid");
  if (payload.command_id !== undefined && payload.command_id !== null && !isNonEmptyString(payload.command_id)) return error("invalid-payload", "Chat command id is invalid");
  return { ok: true, value: payload as unknown as ChatMessage };
}

const CHAT_NOTICE_TONES: readonly string[] = ["default", "money", "muted"];

export function parseChatNotice(payload: unknown): ParseResult<ChatNotice> {
  if (!isRecord(payload) || !isNonEmptyString(payload.notice_id) || !isNonEmptyString(payload.sent_at) || !Number.isFinite(Date.parse(payload.sent_at))) return error("invalid-payload", "Chat notice is invalid");
  const segments = payload.segments;
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > MAX_CHAT_NOTICE_SEGMENTS) return error("invalid-payload", `Chat notice needs 1-${MAX_CHAT_NOTICE_SEGMENTS} segments`);
  let length = 0;
  for (const segment of segments) {
    if (!isRecord(segment) || typeof segment.text !== "string" || segment.text.length === 0 || !CHAT_NOTICE_TONES.includes(String(segment.tone))) return error("invalid-payload", "Chat notice segment is invalid");
    length += segment.text.length;
  }
  if (length > MAX_CHAT_NOTICE_LENGTH) return error("invalid-payload", `Chat notice exceeds ${MAX_CHAT_NOTICE_LENGTH} characters`);
  return { ok: true, value: payload as unknown as ChatNotice };
}

const HUD_KEY = /^[A-Za-z0-9_]{1,96}$/;
const HUD_MESSAGES_KEYS = new Set(["progress", "alert", "hint_high", "hint_low"]);
const HUD_SLOT_KEYS = new Set(["message_id", "key", "text", "tone", "visible_remaining_ms", "countdown_remaining_ms"]);
const HUD_PROGRESS_SLOT_KEYS = new Set([...HUD_SLOT_KEYS, "progress"]);
const HUD_PROGRESS_KEYS = new Set(["remaining_ms", "total_ms"]);
const ROUND_RESULT_KEYS = new Set(["panel"]);
const ROUND_RESULT_PANEL_KEYS = new Set(["result_id", "winner_team", "is_match_end", "title", "subtitle_text", "mvp", "visible_remaining_ms"]);
const ROUND_RESULT_TITLE_KEYS = new Set(["text", "outcome"]);
const ROUND_RESULT_MVP_KEYS = new Set(["player_id", "display_name", "reason_text", "music_kit_name"]);

/** Plain HUD text: not blank, at most `MAX_HUD_TEXT_LENGTH` UTF-16 code units. */
const isHudText = (value: unknown): value is string => isNonEmptyString(value) && value.length <= MAX_HUD_TEXT_LENGTH;
/** An integer millisecond value in `0..MAX_HUD_REMAINING_MS`. */
const isHudMs = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_HUD_REMAINING_MS;

function isHudSlotMessage(value: unknown, withProgress: boolean): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, withProgress ? HUD_PROGRESS_SLOT_KEYS : HUD_SLOT_KEYS)) return false;
  if (!isNonEmptyString(value.message_id) || typeof value.key !== "string" || !HUD_KEY.test(value.key) || !isHudText(value.text)) return false;
  if (!(HUD_TONES as readonly unknown[]).includes(value.tone)) return false;
  if (value.visible_remaining_ms !== null && !isHudMs(value.visible_remaining_ms)) return false;
  // The countdown exists exactly when the text has a token to draw it into, of one kind only.
  const hasClock = value.text.includes(HUD_TIME_REMAINING_TOKEN);
  const hasSeconds = value.text.includes(HUD_SECONDS_REMAINING_TOKEN);
  if (hasClock && hasSeconds) return false;
  if (hasClock || hasSeconds ? !isHudMs(value.countdown_remaining_ms) : value.countdown_remaining_ms !== null) return false;
  if (!withProgress) return true;
  const progress = value.progress;
  return isRecord(progress) && hasOnlyKeys(progress, HUD_PROGRESS_KEYS)
    && isHudMs(progress.remaining_ms) && isHudMs(progress.total_ms)
    && progress.total_ms > 0 && progress.remaining_ms <= progress.total_ms;
}

/** `hud.messages` payload: all four slots present, each null or a strict message; only `progress` carries a progress bar. */
export function parseHudMessages(payload: unknown): ParseResult<HudMessagesSnapshot> {
  if (!isRecord(payload) || !hasOnlyKeys(payload, HUD_MESSAGES_KEYS) || HUD_MESSAGES_KEYS.size !== Object.keys(payload).length) return error("invalid-payload", "HUD messages need exactly progress, alert, hint_high and hint_low");
  for (const slot of HUD_MESSAGES_KEYS) {
    const message = payload[slot];
    if (message !== null && !isHudSlotMessage(message, slot === "progress")) return error("invalid-payload", `HUD message ${slot} is invalid`);
  }
  return { ok: true, value: payload as unknown as HudMessagesSnapshot };
}

/** `round.result` payload: `{ panel: null }` or a strict panel whose outcome agrees with its winner. */
export function parseRoundResult(payload: unknown): ParseResult<RoundResultSnapshot> {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ROUND_RESULT_KEYS) || !Object.prototype.hasOwnProperty.call(payload, "panel")) return error("invalid-payload", "Round result needs exactly panel");
  const panel = payload.panel;
  if (panel === null) return { ok: true, value: { panel: null } };
  if (!isRecord(panel) || !hasOnlyKeys(panel, ROUND_RESULT_PANEL_KEYS) || !isNonEmptyString(panel.result_id) || typeof panel.is_match_end !== "boolean" || !isHudMs(panel.visible_remaining_ms)) return error("invalid-payload", "Round result panel is invalid");
  if (panel.winner_team !== null && !isRole(panel.winner_team)) return error("invalid-payload", "Round result winner is invalid");
  // SLGO rounds always have a winner; only a match can end in a draw.
  if (panel.winner_team === null && !panel.is_match_end) return error("invalid-payload", "Only a match end can be a draw");
  if (panel.subtitle_text !== null && !isHudText(panel.subtitle_text)) return error("invalid-payload", "Round result subtitle is invalid");
  const title = panel.title;
  if (!isRecord(title) || !hasOnlyKeys(title, ROUND_RESULT_TITLE_KEYS) || !isHudText(title.text) || !(ROUND_RESULT_OUTCOMES as readonly unknown[]).includes(title.outcome)) return error("invalid-payload", "Round result title is invalid");
  if ((title.outcome === "draw") !== (panel.winner_team === null)) return error("invalid-payload", "Round result outcome is draw exactly when there is no winner");
  const mvp = panel.mvp;
  if (mvp !== null && (!isRecord(mvp) || !hasOnlyKeys(mvp, ROUND_RESULT_MVP_KEYS) || !isNonEmptyString(mvp.player_id) || !isHudText(mvp.display_name) || !isHudText(mvp.reason_text)
    || (mvp.music_kit_name !== null && !isHudText(mvp.music_kit_name)))) return error("invalid-payload", "Round result MVP is invalid");
  return { ok: true, value: payload as unknown as RoundResultSnapshot };
}

const HUD_STATUS_KEYS = new Set(["ammo", "round_kills"]);
const HUD_AMMO_KEYS = new Set(["clip", "clip_max", "reserve", "reserve_icon"]);
const isHudAmmoCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= MAX_HUD_AMMO;

/** `hud.status` payload: both fields present; ammo null or strict; kills a short list of known kinds. */
export function parseHudStatus(payload: unknown): ParseResult<HudStatusSnapshot> {
  if (!isRecord(payload) || !hasOnlyKeys(payload, HUD_STATUS_KEYS) || HUD_STATUS_KEYS.size !== Object.keys(payload).length) return error("invalid-payload", "HUD status needs exactly ammo and round_kills");
  const ammo = payload.ammo;
  if (ammo !== null && (!isRecord(ammo) || !hasOnlyKeys(ammo, HUD_AMMO_KEYS) || HUD_AMMO_KEYS.size !== Object.keys(ammo).length
    || !isHudAmmoCount(ammo.clip) || !isHudAmmoCount(ammo.clip_max) || ammo.clip_max < 1 || !isHudAmmoCount(ammo.reserve)
    || !(HUD_RESERVE_ICONS as readonly unknown[]).includes(ammo.reserve_icon))) return error("invalid-payload", "HUD status ammo is invalid");
  const kills = payload.round_kills;
  if (!Array.isArray(kills) || kills.length > MAX_HUD_ROUND_KILLS || !kills.every((kind) => (HUD_KILL_KINDS as readonly unknown[]).includes(kind))) return error("invalid-payload", "HUD status round kills are invalid");
  return { ok: true, value: payload as unknown as HudStatusSnapshot };
}

export function parseCommandResult(payload: unknown): ParseResult<CommandResult> {
  if (!isRecord(payload) || !isNonEmptyString(payload.command_id) || !["command.shop.purchase", "command.chat.send"].includes(String(payload.command_kind)) || !["accepted", "rejected", "duplicate", "failed"].includes(String(payload.status))) return error("invalid-payload", "Command result is invalid");
  if (payload.reason !== undefined && typeof payload.reason !== "string") return error("invalid-payload", "Command result reason is invalid");
  return { ok: true, value: payload as unknown as CommandResult };
}

export function parseCommand(command: unknown): ParseResult<SlgoCommand> {
  if (!isRecord(command) || !isNonEmptyString(command.command_id)) return error("invalid-payload", "Command id is required");
  if (command.kind === "command.shop.purchase") {
    if (!isNonEmptyString(command.item_id) || !Number.isInteger(command.quantity) || Number(command.quantity) < 1) return error("invalid-payload", "Purchase command is invalid");
    return { ok: true, value: command as ShopPurchaseCommand };
  }
  if (command.kind === "command.chat.send") {
    if (!["global", "team", "spectator"].includes(String(command.scope)) || !isNonEmptyString(command.body)) return error("invalid-payload", "Chat command is invalid");
    return { ok: true, value: command as ChatSendCommand };
  }
  return error("invalid-payload", "Command kind is unsupported");
}

export function parseEvent(raw: unknown): ParseResult<SlgoEvent> {
  const envelopeResult = parseEnvelope(raw);
  if (!envelopeResult.ok) return envelopeResult;
  const envelope = envelopeResult.value;
  let payloadResult: ParseResult<unknown>;
  switch (envelope.type) {
    case "sidecar.baseline":
      payloadResult = isRecord(envelope.payload) && Object.keys(envelope.payload).length === 1 && envelope.payload.baseline === true ? { ok: true, value: { baseline: true } } : error("invalid-payload", "Baseline payload is invalid", envelope.event_id);
      break;
    case "match.snapshot":
      if (envelope.sent_at === undefined) return error("invalid-payload", "Match snapshot timestamp is required", envelope.event_id);
      payloadResult = parseMatchSnapshot(envelope.payload);
      break;
    case "minimap.init":
    case "minimap.positions":
      if (!isNonEmptyString(envelope.round_id) || envelope.sent_at === undefined) return error("invalid-envelope", "Minimap round and timestamp are required", envelope.event_id);
      payloadResult = envelope.type === "minimap.init" ? parseMinimapInit(envelope.payload) : parseMinimapPositions(envelope.payload);
      break;
    case "shop.snapshot": payloadResult = parseShopSnapshot(envelope.payload); break;
    case "chat.message": payloadResult = parseChatMessage(envelope.payload); break;
    case "chat.notice": payloadResult = parseChatNotice(envelope.payload); break;
    case "hud.messages":
    case "round.result":
      // Remaining times are counted from sent_at, so the frame needs one.
      if (envelope.sent_at === undefined) return error("invalid-envelope", "HUD message and round result timestamps are required", envelope.event_id);
      payloadResult = envelope.type === "hud.messages" ? parseHudMessages(envelope.payload) : parseRoundResult(envelope.payload);
      break;
    case "hud.status": payloadResult = parseHudStatus(envelope.payload); break;
    case "command.result": payloadResult = parseCommandResult(envelope.payload); break;
    // Newer sidecars may add event types; clients skip them instead of desynchronising.
    default: return error("unsupported-event-type", `Unsupported event type: ${envelope.type}`, envelope.event_id);
  }
  if (!payloadResult.ok) return payloadResult;
  return { ok: true, value: { ...envelope, payload: payloadResult.value } as SlgoEvent };
}

/**
 * Whether a client may open a player-scoped sidecar session with this route.
 * The sidecar is the authority: it admits a `local-steamid` session only through
 * IP binding (see README "Security boundary"). The other modes are reserved for
 * stronger proofs. An unknown mode is refused.
 */
export function canOpenPlayerScopedStream(route: Pick<ServerRoute, "identityMode">): boolean {
  return IDENTITY_MODES.includes(route.identityMode);
}

export class EventSequenceGuard {
  private serverId: string | null = null;
  private instanceId: string | null = null;
  private sequence = -1;
  private baselineAccepted = false;

  reset() {
    this.serverId = null;
    this.instanceId = null;
    this.sequence = -1;
    this.baselineAccepted = false;
  }

  get acceptedSequence() { return this.sequence; }
  get currentInstanceId() { return this.instanceId; }
  get requiresBaseline() { return !this.baselineAccepted; }

  requireBaseline() { this.baselineAccepted = false; }

  accept(event: ProtocolEnvelope): ParseResult<ProtocolEnvelope> {
    if (this.serverId === null) {
      this.serverId = event.server_id;
      this.instanceId = event.instance_id;
    }
    if (event.server_id !== this.serverId || event.instance_id !== this.instanceId) {
      if (event.type !== "sidecar.baseline") return error("baseline-required", "A new instance requires a baseline event", event.event_id);
      this.serverId = event.server_id;
      this.instanceId = event.instance_id;
      this.sequence = -1;
      this.baselineAccepted = false;
    }
    if (event.sequence <= this.sequence) return error("stale-sequence", "Event sequence is older than the accepted sequence", event.event_id);
    if (!this.baselineAccepted && event.type !== "sidecar.baseline") return error("baseline-required", "Incremental events require a baseline", event.event_id);
    this.sequence = event.sequence;
    if (event.type === "sidecar.baseline") this.baselineAccepted = true;
    return { ok: true, value: event };
  }
}
