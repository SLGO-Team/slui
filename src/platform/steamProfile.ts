import { isTauri, tauriInvoke, type CommandInvoker } from "./desktop.ts";

/** A Steam account as the local Steam client knows it (src-tauri/src/steam_profile.rs); each part may be missing. */
export type SteamProfile = Readonly<{ personaName: string | null; avatarUrl: string | null }>;

export const EMPTY_STEAM_PROFILE: SteamProfile = { personaName: null, avatarUrl: null };

const AVATAR_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

export function parseSteamProfile(value: unknown): SteamProfile | null {
  if (!value || typeof value !== "object") return null;
  const { personaName, avatarUrl } = value as Record<string, unknown>;
  if (personaName !== null && typeof personaName !== "string") return null;
  if (avatarUrl !== null && (typeof avatarUrl !== "string" || !AVATAR_URL.test(avatarUrl))) return null;
  return { personaName, avatarUrl };
}

export interface SteamProfileSource {
  get(steamId: string): Promise<SteamProfile>;
}

export function createSteamProfileSource(invoke: CommandInvoker | null = isTauri() ? tauriInvoke : null): SteamProfileSource {
  return {
    async get(steamId) {
      // A browser has no Steam client to read.
      if (!invoke) return EMPTY_STEAM_PROFILE;
      const profile = parseSteamProfile(await invoke<unknown>("get_steam_profile", { steamId }));
      if (!profile) throw new Error("Invalid Steam profile");
      return profile;
    },
  };
}
