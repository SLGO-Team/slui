import type { SessionStatusSnapshot } from "../../platform/desktop";
import type { SteamProfile } from "../../platform/steamProfile";
import type { Tone } from "./status";

/** A profile read for one account; by the time it arrives the session may show another. */
export type LoadedSteamProfile = Readonly<{ steamId: string; profile: SteamProfile }>;

export type SteamAccount =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "signed-out" }>
  /** `profile` is null until the Steam client's files for this account have been read. */
  | Readonly<{ kind: "signed-in"; steamId: string; profile: SteamProfile | null }>;

/** The SteamID always comes from the overlay's session, so the tile never mixes two accounts. */
export function steamAccount(session: SessionStatusSnapshot | null, loaded: LoadedSteamProfile | null): SteamAccount {
  if (!session) return { kind: "loading" };
  if (!session.steamId) return { kind: "signed-out" };
  return { kind: "signed-in", steamId: session.steamId, profile: loaded?.steamId === session.steamId ? loaded.profile : null };
}

export const steamTone = (account: SteamAccount): Tone => account.kind === "signed-in" ? "ok" : "muted";
