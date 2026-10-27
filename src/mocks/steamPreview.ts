import type { SteamAccount } from "../app/home/steamAccount.ts";

// Fixed Steam tiles for browser previews of the home window (`?steam=<name>`); a browser has
// no Steam client to read. The avatars are drawn here, never taken from a real account.
const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 184 184">${body}</svg>`)}`;

const DUSK = svg(`<defs>
  <linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="#2a1b5c"/><stop offset=".62" stop-color="#8b3a8f"/><stop offset="1" stop-color="#f2785c"/></linearGradient>
  <radialGradient id="u"><stop offset="0" stop-color="#ffe09a"/><stop offset="1" stop-color="#ff8a3d"/></radialGradient>
</defs>
<rect width="184" height="184" fill="url(#s)"/>
<circle cx="118" cy="94" r="34" fill="url(#u)"/>
<path d="M0 134 38 98 66 120 104 82 148 126 184 104V184H0Z" fill="#3b1f4f"/>
<path d="M0 154 46 124 88 146 130 118 184 150V184H0Z" fill="#1c1030"/>`);

const REEF = svg(`<rect width="184" height="184" fill="#0f3b3a"/>
<circle cx="92" cy="92" r="70" fill="#1f8a70"/>
<circle cx="92" cy="92" r="46" fill="#bfdb38"/>
<circle cx="92" cy="92" r="22" fill="#0f3b3a"/>
<path d="M0 0H70L0 70Z" fill="#2ec4b6" opacity=".55"/>`);

const STEAM_ID = "76561198000000001";

export const STEAM_PREVIEWS = {
  "signed-in": { kind: "signed-in", steamId: STEAM_ID, profile: { personaName: "Nova", avatarUrl: DUSK } },
  "long-name": {
    kind: "signed-in",
    steamId: STEAM_ID,
    profile: { personaName: "深空观测站·夜班值守员 Nova-07 ★ Reef Watch", avatarUrl: REEF },
  },
  "no-avatar": { kind: "signed-in", steamId: STEAM_ID, profile: { personaName: "Nova", avatarUrl: null } },
  "no-profile": { kind: "signed-in", steamId: STEAM_ID, profile: { personaName: null, avatarUrl: null } },
  reading: { kind: "signed-in", steamId: STEAM_ID, profile: null },
  "signed-out": { kind: "signed-out" },
  loading: { kind: "loading" },
} satisfies Record<string, SteamAccount>;

export function readSteamPreview(search: string): SteamAccount | null {
  const name = new URLSearchParams(search).get("steam");
  return name && Object.prototype.hasOwnProperty.call(STEAM_PREVIEWS, name) ? STEAM_PREVIEWS[name as keyof typeof STEAM_PREVIEWS] : null;
}
