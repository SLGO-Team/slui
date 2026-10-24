# CS2 team select menu

## Goal

SLUI players get CS2's team select menu instead of the plugin's Hint roster: M opens it in game (join NTF or SCP,
spectate, auto-select, cancel), and every player who joins the server without a team gets the team select menu
by itself (SLUI players this one, others the plugin's Hint menu). Reference captures from the user: hover left,
hover right (both opened with the hotkey during a match), first join (empty teams, no Cancel).

## Background (evidence)

- CS2 reference: `../cs2ui/panorama/{layout,scripts,styles}/teamselectmenu.*`; measurements of the captures in
  `research/cs2-team-select.md`.
- Plugin (`../SLGO`):
  - One authoritative selection transaction `RoundManager.TrySelectTeam(player, TeamType)` (`RoundManager.cs:239`)
    used by `.team ntf|scp` (`Commands/TeamCommand.cs`) and the Hint menu. `TeamSelectionRules.cs` holds the phase
    gate, busy flag, empty-team guard, capacity and size difference, with one player-facing message per result.
    The refusal texts are already CS2's own (`HudCatalogEntries.cs:91-102`, e.g. "NTF队伍人数已满。").
  - Phase gate: waiting phase always; other phases only with `allow_team_selection_in_any_phase` (casual true,
    competitive false, `config/game-modes/*.cfg`).
  - Hint menu `TeamSelection/TeamSelectionMenuManager.cs`: SSS keybind M (`ShopNavigator.cs:153`) toggles a
    session that closes the in-game shop / scoreboard / chat, ducks the music and plays the music kit's team
    select track (`MusicKitManager.PlayTeamSelectionForeground`), renders `PreparationRosterUI.ShowInteractive`
    and closes when the phase gate shuts. No spectate or auto choice.
  - New players join unassigned (`RoundManager.AddPlayer`): no menu opens.
  - SLUI takeover pattern: `SluiPresence` features (e.g. `shop-menu` makes the plugin ignore B,
    `ShopNavigator.cs:145`).
- SLUI:
  - `match.snapshot` already sends both rosters (names, `avatar_url`, online) to unassigned viewers
    (`viewer_team_id: null`).
  - Team emblems `public/assets/bottomhud/emblem-{ntf,scp}.svg`; side names NTF / SCP (`SCOREBOARD_SIDE_NAMES`).
  - NTF plays CS2's T side and SCP the CT side (`hudSideForRole`); the Hint roster also puts NTF left.
  - CS2 side colours are replaced by the SLGO team colours `ROLE_COLORS` (NTF `rgb(150,200,250)`, SCP `#d94652`;
    spec `cs2-visual-replication.md` 3 / 9).
  - Own world blur through `useBackdropRef` (`src/platform/backdrop.ts`).

## Decisions

User (2026-10-24):
- D1 Background: SLUI world blur over the live game plus CS2's per-half colour gradients. No character models;
  the CS2 3D scene and its model glow are out.
- D2 CS2 behaviour: the plugin adds spectate and auto-select; with a team, M opens the menu with Cancel.
- D3 No countdown and no auto-join at zero. Every player who joins without a team gets the team select menu by
  itself, SLUI and Hint players alike.

Defaults taken in planning (change at review if wanted):
- D4 NTF left, SCP right; halves, titles, icons and own rows use the SLGO team colours (NTF blue, SCP red), as
  every other SLUI panel does. The CS2 captures' yellow / blue are not copied.
- D5 The subtitle reads "{n} 玩家" (SLGO has no bots, so CS2's "- {m} 电脑玩家" part is dropped). Online players
  get CS2's human row (team colour, black name); offline players with a kept seat get CS2's bot row (#303030,
  white name).
- D6 The plugin owns the menu session for both clients: the SSS key M (rebindable in SCP:SL) opens it, as CS2's
  server-driven team menu does; SLUI draws the session the plugin reports and sends the choice or the close.
- D7 The forced menu (opened on join) has no Cancel and ignores Escape / M in SLUI, as CS2 hides Cancel for an
  unassigned player; Spectate is the way out. The Hint menu keeps closing with M (it has no spectate entry).
- D8 Spectate follows the selection phase gate and the empty-team guard (no size-difference check: leaving never
  makes a team too big); an alive player in the action phase dies as with a team change. Auto-select picks the
  team with fewer players without the player; on a tie the current team (no move), else the lower score, else NTF.

## Requirements

- R1 Plugin: spectate (leave the team, become an unassigned observer) and auto-select, through the same
  transaction, refusal rules and messages as `.team`; `.team spectate|auto` for parity.
- R2 Plugin: a newly joined real player (not a restored seat, not a test dummy) who is unassigned while selection
  is allowed gets the menu opened as forced. The Hint menu draws it for non-SLUI players.
- R3 Plugin <-> SLUI contract: a per-player `team.menu` event (session id and forced flag, or no menu) and two
  commands, select (`ntf` / `scp` / `spectator` / `auto`) and close (session id), each answered by
  `command.result` with the plugin's refusal text. A new SLUI feature `team-select` makes the plugin publish the
  session instead of drawing the Hint roster; music, duck and phase-gate closing stay as they are. An open session
  switches renderer when the player's SLUI presence changes.
- R4 slgo-backend relays the event (one recipient, replayed after a reconnect) and both commands; contract
  schemas, examples and invalid fixtures; dev client verbs.
- R5 `@slgo/protocol`: types, strict parsers, JSON schemas, README, examples; older SLUI ignores the event.
- R6 SLUI panel (CS2 layout, 1080p canvas rules): per-half gradient (30% -> 40% on hover), round team icon
  (dim -> bright on hover), title, subtitle, roster of 200 px rows with avatars (side fallback), action bar
  (Cancel only when not forced, Spectate, Auto-select), centred error banner for 5 s, black fade when it opens,
  full-screen world blur with a dense fallback fill, no text shadows.
- R7 SLUI behaviour: click a half or press 1 / 2 to join NTF / SCP; clicking the player's own team only closes;
  Escape / M / Cancel close when not forced; while visible the overlay is interactive, the shop, scoreboard and
  chat stay closed and their keys do nothing, and the other HUD panels are hidden (CS2 hides its HUD).
- R8 Mock scenes for the three captures (hover NTF, hover SCP, forced with empty teams) and tests at every layer;
  spec updates (system boundaries, CS2 replication section).

## Acceptance Criteria

- [ ] AC1 (R6, R8) 1080p mock captures beside the three reference captures: icons, titles, subtitles, rosters and
      action bar within a few px of the measured layout; the user approves the visuals.
- [ ] AC2 (R3, R7) In game with SLUI: M opens and Escape / M / Cancel close the SLUI menu with the team select
      music; the Hint roster never appears.
- [ ] AC3 (R1, R3, R7) Joining NTF / SCP, spectating and auto-select all go through the plugin rules; a refusal
      (full team, too many, not now) shows the plugin's text in the error banner and keeps the menu open; success
      closes it and shows the plugin's notice in the message zone.
- [ ] AC4 (R2, D3, D7) Joining the server without a team: SLUI shows the menu by itself without Cancel; a
      non-SLUI player gets the Hint menu; spectating leaves the player unassigned with the menu closed.
- [x] AC5 (R4, R5) Example payloads parse in slui (`npm test`), slgo-backend (`bun test`) and plugin tests.
- [x] AC6 (R1) Plugin tests: spectate and auto-select rule tables (phase gate, empty-team guard, ties), forced
      open conditions (restored seat, dummy, selection not allowed), renderer switch on presence change.

## Out of Scope

- CS2's 3D character scene, model hover glow, the auto-join countdown and its timer ring.
- Spectate / auto entries in the Hint menu (they get `.team spectate|auto` only).
- Forcing the menu again later (e.g. a competitive mid-match joiner when the next match's waiting phase starts).
- New sounds (CS2's button rollover sound is not in the theme pack).

## Verification (2026-10-24)

- slui `npm run lint`, `npm test`, `npm run build:local`; slgo-backend `bun run lint`, `bun test` (485); plugin
  `dotnet build` (0 warnings) and `dotnet test` (2216).
- 1080p mock captures (`teamSelect=ntf|scp|forced`) beside the user's captures: disc 78 px from y 42, title cap top
  y 152, subtitle y 206, rows 41 tall from y 238 on a 47.5 px pitch at x 460-660 / 1260-1460, action bar ending at
  x 1840; 1680x1050 and 1440x1080 keep the columns on the seam.
- Mock interactions: a refused join shows the banner and keeps the menu, Escape / own side close it (the HUD comes
  back), 1 / 2 join, a forced menu ignores Escape / M and closes on Spectate.
- Open: the user's visual review (AC1) and the in-game check (AC2-AC4).

## Review status (2026-10-24, paused)

- Fixed after the first review: mouse hover in the debug scenes, an opaque red SCP fallback avatar (used by every
  panel), top gradients on the captures' opacity curve (the user: "现在还好").
- Next: the lower half reads empty; the user will supply illustrations to place there (ask for the files first).
  Then the visual approval (AC1), the in-game check (AC2-AC4), merging the plugin / backend `feat/team-select`
  branches, finish-work.
