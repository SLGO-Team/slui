import { endsMatch, type ConnectionStatus, type HudKillfeedEntry, type HudKillfeedViewerRole, type SlgoEvent } from "../../contracts/index.ts";
import { killfeedNameColor, killfeedWeaponIcon, type KillfeedPlayerView } from "./presentation.ts";

/** CS2 `DeathNoticeFadeOutTime`: an entry fades out over 1 s once its time is up. */
export const KILLFEED_FADE_MS = 1_000;

/** The sidecar instance the feed belongs to; another one clears it. */
export type KillfeedSource = { serverId: string; instanceId: string };

export type KillfeedItem = {
  entry: HudKillfeedEntry;
  /** Local time the entry starts fading: receive time of the latest copy + `visible_remaining_ms`. */
  fadeAtMs: number;
  /** Local time this `entry_id` first arrived; replays keep it, so they never slide in again. */
  firstSeenAtMs: number;
};

export type KillfeedState = {
  source: KillfeedSource | null;
  /** Oldest first, as the plugin sends them. */
  items: KillfeedItem[];
};

export const initialKillfeedState: KillfeedState = { source: null, items: [] };

export type KillfeedAction =
  | { type: "event"; event: SlgoEvent; receivedAtMs: number }
  | { type: "connection"; status: ConnectionStatus };

const sameSource = (a: KillfeedSource | null, serverId: string, instanceId: string) =>
  a !== null && a.serverId === serverId && a.instanceId === instanceId;

const fadingAt = (item: KillfeedItem, nowMs: number) => item.fadeAtMs <= nowMs && nowMs < item.fadeAtMs + KILLFEED_FADE_MS;

/** The events killfeedReducer reads; App dispatches no others to it (each dispatch re-renders App). */
export const KILLFEED_EVENT_TYPES: ReadonlySet<SlgoEvent["type"]> = new Set<SlgoEvent["type"]>(["sidecar.baseline", "hud.killfeed"]);

/**
 * Each `hud.killfeed` is the recipient's whole feed. Entries keep their first-seen time across copies; an entry the
 * new copy leaves out disappears at once (a new round clears the feed), unless it is already fading out, which it
 * finishes (the plugin leaves out entries whose time ran out).
 */
export function killfeedReducer(state: KillfeedState, action: KillfeedAction): KillfeedState {
  // Only an ended instance clears the feed; other drops keep it for a reconnect to the same instance.
  if (action.type === "connection") return endsMatch(action.status) && state !== initialKillfeedState ? initialKillfeedState : state;
  const { event, receivedAtMs } = action;
  if (event.type === "sidecar.baseline") {
    if (sameSource(state.source, event.server_id, event.instance_id)) return state;
    return { source: { serverId: event.server_id, instanceId: event.instance_id }, items: [] };
  }
  if (event.type !== "hud.killfeed" || !sameSource(state.source, event.server_id, event.instance_id)) return state;

  const known = new Map(state.items.map((item) => [item.entry.entry_id, item]));
  const incoming = event.payload.entries.map((entry): KillfeedItem => ({
    entry,
    fadeAtMs: receivedAtMs + entry.visible_remaining_ms,
    firstSeenAtMs: known.get(entry.entry_id)?.firstSeenAtMs ?? receivedAtMs,
  }));
  const ids = new Set(incoming.map((item) => item.entry.entry_id));
  const finishing = state.items.filter((item) => !ids.has(item.entry.entry_id) && fadingAt(item, receivedAtMs));
  return { ...state, items: [...finishing, ...incoming] };
}

export type KillfeedNoticeView = {
  /** React key: one mount (and one slide-in) per entry. */
  id: string;
  /** CS2 `DeathNoticeSuicide`: the skull and crossbones instead of the weapon. */
  suicide: boolean;
  /** null only for a suicide without an attacker ("skull victim"); a self-kill names the victim ("name skull name"). */
  killer: KillfeedPlayerView | null;
  assister: KillfeedPlayerView | null;
  victim: KillfeedPlayerView;
  /** Weapon artwork, or the fallback; null for a suicide (CS2 hides `#Weapon` then). */
  weaponIcon: string | null;
  headshot: boolean;
  viewer: HudKillfeedViewerRole | null;
  firstSeenAtMs: number;
  fadeAtMs: number;
};

const player = (value: HudKillfeedEntry["victim"]): KillfeedPlayerView => ({ name: value.display_name, color: killfeedNameColor(value.team) });

/** Two selectKillfeed results of one state differ in time only by which notices are still drawn. */
export function sameKillfeedTime(a: readonly KillfeedNoticeView[], b: readonly KillfeedNoticeView[]): boolean {
  return a.length === b.length && a.every((notice, index) => notice.id === b[index].id);
}

/** The notices to draw at `nowMs`, oldest first: everything until its fade-out has finished. */
export function selectKillfeed(state: KillfeedState, nowMs: number): KillfeedNoticeView[] {
  return state.items
    .filter((item) => nowMs < item.fadeAtMs + KILLFEED_FADE_MS)
    .map(({ entry, fadeAtMs, firstSeenAtMs }) => ({
      id: entry.entry_id,
      suicide: entry.suicide,
      killer: entry.killer === null ? null : player(entry.killer),
      assister: entry.assister === null ? null : player(entry.assister),
      victim: player(entry.victim),
      weaponIcon: entry.suicide ? null : killfeedWeaponIcon(entry.weapon),
      headshot: entry.headshot,
      viewer: entry.viewer,
      firstSeenAtMs,
      fadeAtMs,
    }));
}
