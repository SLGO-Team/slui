# Home Steam profile card (avatar + persona name)

## Goal

The Steam tile on the home page (首页 → 连接状态) shows who is signed in the way Steam itself does: the
account's avatar and persona name, with the SteamID as secondary detail. Today it shows only the
17-digit SteamID. The user left the visual design open ("尽量发挥你的审美").

## Requirements

- Source of truth is the local Steam client, not the network:
  - persona name: `<SteamPath>/config/loginusers.vdf` → `users.<SteamID64>.PersonaName`
    (Steam writes it at sign-in; it is what Steam's own account picker shows);
  - avatar: `<SteamPath>/config/avatarcache/<SteamID64>.png` (Steam's own cache);
  - `SteamPath` from `HKCU\Software\Valve\Steam\SteamPath`, the key the SteamID already comes from.
  No Steam Web API key, no request to steamcommunity.com (often unreachable from mainland China).
- The SteamID shown stays the one in the overlay's session snapshot; home looks up that account's
  profile, so the tile never mixes two accounts.
- Each part degrades on its own: no avatar file → placeholder avatar; no persona name → SteamID becomes
  the title; no Steam sign-in → the existing 「未检测到 Steam 登录」 state, restyled.
- Browser previews (`?window=home`) can show the signed-in, missing-profile and signed-out cards
  without Tauri.
- New UI follows the home window's language (navy panels, orange accent, HUD brackets, chamfers);
  no text shadows.

## Acceptance Criteria

- [x] Signed in with a cached avatar: avatar, persona name and SteamID render; the status dot is green.
- [x] Persona names with CJK and long names render without overflow (ellipsis).
- [x] Missing avatar / missing persona name / signed out each render a deliberate state.
- [x] Rust command validates the SteamID (17 digits) and never reads outside Steam's config dir.
- [x] VDF parsing covered by Rust unit tests (quoted strings, escapes, nested blocks, missing user).
- [x] `npm run lint`, `npm test`, CI clippy (`-D warnings`) and workspace tests pass.
- [x] Spec command table lists the new command.
