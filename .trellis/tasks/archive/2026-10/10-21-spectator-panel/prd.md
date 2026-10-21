# CS2 spectator panel

## Goal

While a dead player (or an authorized team-less observer) watches someone in first person, SLUI's bottom HUD
shows that player the way CS2's spectator HUD does (`HudSpecplayer` inside `hudhealthammocenter`): the watched
player's balance, name, ADR, avatar, held item and ammo, and their round kill cards. Today the whole bottom HUD
disappears on death (user decision 2026-10-07, reversed by this task).

## Background (evidence)

- User reference: CS2 1080p capture spectating a teammate bot, 2026-10-21 (shared in chat, never committed).
  Left of the panel the health number with its bar; a 460px panel (x 730-1190) with a 2px washed bar on each
  side; inside it the clan line, name and `伤/局 0` on the left, the avatar in the centre circle, the weapon
  name on the right; right of the panel clip and reserve; key hints under it.
- Panorama (`../cs2ui/panorama`): `layout/hud/hudhealthammocenter.xml:14-35,146-149`,
  `styles/hud/hudhealthammocenter.css:531-534` (strokes hidden while spectating), `:1304-1600`
  (`HudSpecplayer__*`, `HudSpecAdr*`), `styles/csgostyles.css:111` (`spec-width: 460px`).
- SLUI bottom HUD (`src/features/bottomhud`): balance right edge at x 710 (`BottomHud.css:130`), weapon block
  from x 1192 (`BottomHud.css:171`), circle centre (960, 1028): the CS2 panel fits between them unchanged.
  `selectBottomHud` (`model.ts:46-63`) returns null while the local player is dead.
- Name and avatar: `match.snapshot` (`display_name`, `avatar_url`; side default in
  `src/features/hud/presentation.ts:95,163`). ADR: `scoreboard.snapshot`, the scoreboard column's rule
  (`src/features/scoreboard/presentation.ts:148,212`).
- Plugin (`../SLGO`): the watched player is `SpectatorRole.SpectatedPlayer`
  (`Features/Sidecar/Minimap/SidecarMinimapPublisher.cs:337-341`); who may be watched is the shared predicate
  `MatchInformationPolicy.CanObservePlayer` (`.trellis/spec/plugin/match-information-isolation.md:66-97`).
  `hud.status` covers only the viewer (`Features/Sidecar/SidecarHudStatusPublisher.cs`); the other team's
  money is not in `match.snapshot`. Shop display names: `Features/Shop/ShopInitializer.cs`.

## Decisions (user, 2026-10-21)

- D1 The key hints under the panel (`HudSpecplayer__key-hints`) are not drawn.
- D2 Shown whenever the plugin's observation rights let the viewer watch the target: teammates, and opponents
  where the mode allows it (Casual dead players, authorized team-less observers). Colours follow the watched
  player's team role.
- D3 Reuse the alive bottom HUD: balance on the left (no health / armour), ammo on the right, the watched
  player's values.
- D4 The clan line above the name stays empty (SLGO has no clan tags); the name and `伤/局` remain.
- D5 Item label: whatever the watched player holds, by its shop name (`CrossVec`, `医疗包`, keycards, ...);
  an SCP shows its role name (`SCP-939`); empty hands show nothing.

## Requirements

- R1 Plugin: for each viewer whose SLUI declares the new client feature, publish the watched player's
  status while the viewer is not alive and watches a player the shared predicate allows: player id, balance,
  item label (D5), ammo and round kill kinds (the `hud.status` facts); `target: null` otherwise. Published on
  every change, like `hud.status`.
- R2 slgo-backend relays the new event: single recipient, cached and replayed after the baseline.
- R3 `@slgo/protocol`: event type, strict parser, schema, README, example; new client feature.
- R4 SLUI: while the local player is not alive and the watched player is in the match roster, the bottom HUD
  draws in that player's team colour with the CS2 spectator panel: blurred 460 x 72 panel with side bars,
  strokes hidden, avatar in the circle, name and ADR on the left, item label on the right, balance and ammo
  outside the panel, the watched player's kill cards above. A target switch shows the new player at once,
  without a kill burst.
- R5 Alive behaviour is unchanged; with no watched player nothing is drawn (as today).

## Acceptance Criteria

- [x] AC1 (R1, R4) Dead in Competitive and watching a teammate: the panel shows that teammate's balance, name,
      ADR, avatar, item label, ammo and kill cards; switching target updates all of them without a burst.
- [x] AC2 (D2) Casual dead player or authorized observer watching an opponent: the panel shows the opponent in
      the opponent's colour.
- [x] AC3 (D5) Item label: firearm and other items by shop name, SCP by role name, empty hands blank.
- [x] AC4 (R5) Alive: bottom HUD identical to before. Not watching anyone: nothing drawn.
- [x] AC5 (R2, R3) The example payload parses in slui (`npm test`), slgo-backend (`bun test`) and the plugin
      tests; a client without the feature never receives the event.
- [ ] AC6 (R4, D1, D4) Visual: 1080p debug capture beside the user's CS2 reference, then approved by the
      user in game.

Verified 2026-10-21 by tests and the debug build (`bottom-spectating`, `bottom-spectating-enemy`, `bottom-fire`,
`bottom-dead` captured at 1080p): slui `npm test`, slgo-backend `bun test` (447), plugin `dotnet test` (1980).
AC6's in-game check is still the user's.

## Out of Scope

- Key hints, sponsor logos, highlight clips, death panel, CS2's separate money panel (D1).
- Health and armour numbers (D3); clan tags (D4).
- Any change to what a dead player may watch (owned by the plugin's observation policy).
