# Design: CS2 team select menu

## 1. Boundaries

| Repo | Owns |
| --- | --- |
| `../SLGO` (plugin) | Every selection rule (join, spectate, auto), the menu session (open / close / forced, M key, music, duck, phase-gate close), the forced open on join, which renderer draws a session (Hint or SLUI), the result texts. |
| `../slgo-backend` (sidecar) | Relaying `team.menu` (one recipient, latest cached, replayed after the baseline) and the two commands; contract fixtures; dev client verbs. |
| `slui` `packages/protocol` | Wire contract: event, commands, feature name; parsers, schemas, README, examples. |
| `slui` app | Drawing the session the plugin reports, input (click, 1 / 2, Escape / M, buttons), pending and error state, modality over the other panels. |

The plugin is the only authority on whether a menu is open (D6). SLUI never opens one by itself: M reaches the
plugin through SCP:SL's SSS keybind while the game has the foreground, exactly as CS2's server-driven team menu.
While SLUI's menu is open the overlay holds the foreground, so closing goes through SLUI (command).

## 2. Contract

### 2.1 Event `team.menu` (plugin -> one SLUI)

```json
{ "menu": { "session_id": "7", "forced": false } }
{ "menu": null }
```

- `session_id`: the plugin's session version as a decimal string (1-32 chars); a new session always has a new id.
- `forced`: opened on join for an unassigned player (D3, D7): no Cancel, Escape / M do nothing in SLUI.
- Sent only to players whose presence lists `team-select`: the current state (`null` included) as soon as the
  feature is declared, then on every change (as `hud.spectating`). Strict parser: unknown keys rejected.
- The rosters come from `match.snapshot` (already sent to unassigned viewers); no roster in this event.

### 2.2 Commands (SLUI -> plugin)

```json
{ "kind": "command.team.select", "command_id": "team-abc", "team": "ntf" }
{ "kind": "command.team.close", "command_id": "team-close-abc", "session_id": "7" }
```

- `team`: `ntf` | `scp` | `spectator` | `auto`. Runs the same rule path as `.team <team>` (R1), whether or not a
  session is open; on success an open session closes (`TeamSelectionMenuRules.ShouldCloseAfterResult`).
- `command.team.close`: closes the session when `session_id` matches and it is not forced; a stale or missing
  session is `accepted` (idempotent); a forced one is `rejected` (SLUI never sends it).
- `command.result`: `accepted` = done (joined, switched, spectating, already there); `rejected` + `reason` =
  `HudMessageCatalog.Format(notice)` of the refusal, shown in SLUI's banner and not in the message zone; `failed`
  for exceptions. Success notices stay HUD messages (message zone), as in game. Before the result the plugin
  publishes the actor's new `team.menu` (same order as the shop's snapshot-then-result).

### 2.3 Feature

`team-select` (`CLIENT_FEATURE_TEAM_SELECT`) joins `OVERLAY_CLIENT_FEATURES` (11 of `MAX_CLIENT_FEATURES` 16).

## 3. Plugin

### 3.1 Rules (`TeamSelectionRules`, pure, tested)

- `EvaluateSpectate(valid, busy, selectionAllowed, currentTeam, ntfCount, scpCount, preventEmptyTeamSwitch)`:
  invalid / busy / not now as joins; `None` -> `AlreadySpectating` (no change); leaving the last player of a team
  with the guard on -> `TeamWouldBecomeEmpty`; else `Spectated`. No capacity or size-difference check (D8).
- `ResolveAutoTeam(currentTeam, ntfCount, scpCount, ntfScore, scpScore)` with counts excluding the player:
  fewer players wins; tie -> current team, else lower score, else NTF. The resolved team then goes through
  `Evaluate` as a normal join, so its refusals are the normal ones.
- New outcomes `Spectated` / `AlreadySpectating`; notices `SLGO_Team_Spectating` ("你现在是观察者", Low) and
  `SLGO_Team_Already_Spectating` (Low); catalog entries in `HudCatalogEntries`.

### 3.2 Transaction

- `RoundManager.TrySelectTeam(player, TeamChoice)` (`TeamChoice` = Ntf / Scp / Spectator / Auto) is the one entry;
  the `TeamType` overload stays for existing callers. Auto resolves then joins; Spectator runs the coordinator with
  target `TeamType.None`: same irreversible order as a switch (alive combatant in the action phase dies with the
  team-change compensation, win condition suspended and re-evaluated), roster removal instead of migration, no
  balance reset, stats and observation rebuilt for an unassigned observer.
- `.team spectate|auto` (`TeamCommand`), help text updated.

### 3.3 Menu session (`TeamSelectionMenuManager`)

- `MenuSession` gains `Forced` and `Renderer` (Hint | Slui, from `SluiPresence.Has(player, "team-select")`).
- `TryOpen(player, forced)`; `OpenForcedOnJoin(player)`: called last in `PlayerHandler.HandlePlayerJoined` (next
  frame) for a real player (not a `TestDummyManager` dummy) who is unassigned while `CanSelectTeamNow`; a
  restored seat has a team, so it never qualifies.
- Rendering: Hint -> `ShowTeamSelectionRoster` as now; Slui -> raise `MenuChanged(player)` for the sidecar
  publisher, no Hint. `SluiPresence.Changed` re-evaluates every open session; a renderer switch clears the old one
  (Hint closed / `menu: null`) and draws the new.
- `Toggle` (M): an SLUI-rendered forced session ignores it; everything else as now (the Hint forced menu still
  closes with M, D7). `CloseFromSlui(player, sessionId)` implements 2.2. `GetMenu(player)` -> `(id, forced)?`.
- Selection from SLUI: the command handler calls `RoundManager.TrySelectTeam(player, choice)` then
  `menuManager.ApplyResult(player, result)` (close when `ShouldCloseAfterResult`). `Confirm` (Hint) unchanged.

### 3.4 Sidecar

- `SidecarConstants`: `EVENT_TEAM_MENU`, `SLUI_FEATURE_TEAM_SELECT`, the two command kinds.
- `IpcPayloads.TeamMenuPayload`; `SidecarTeamMenuRules` (payload, signature, self-check equal to slui's parser);
  `SidecarTeamMenuPublisher` (per player: publish on `MenuChanged` / presence change / resync, signature dedupe,
  `null` only after a menu, audience trimmed; `ClearSession`).
- `IpcIncomingMessages` `CommandMessage`: `team` (enum) and `session_id` (decimal string); `SidecarCommandHandler`
  dispatches both kinds; `SidecarCommandRules` maps `TeamSelectionResult` -> status / reason.
- `Features/Sidecar/CLAUDE.md` rows for the new files.

## 4. slgo-backend

- `apps/sidecar/src/ipc/messages.ts`: `team.menu` in `PUBLISH_EVENT_TYPES`, `SNAPSHOT_EVENT_TYPES`,
  `SINGLE_RECIPIENT_EVENT_TYPES`; `hub.ts` `REPLAY_ORDER` after `hud.spectating`.
- `protocol/ipc/v1`: publish schema event + `publish-team-menu.example.json` / `publish-team-menu-closed.example.json`;
  `command.schema.json` kinds + `command-team-select.example.json` / `command-team-close.example.json`; invalid
  fixtures (unknown team, bad session id, extra key); README.
- Commands parse through `@slgo/protocol` (junction); check the rate limit covers the new kinds; dev client verbs
  `team <ntf|scp|spectator|auto>` and `team-close <session_id>`, and printing of `team.menu`.

## 5. SLUI

### 5.1 Model (`src/features/teamselect/model.ts`, pure)

- State: `menu` (`{ sessionId, forced } | null`, latest event), `dismissedSessionId`, `pending` (one command:
  id, kind, team, sent time; times out like the shop's), `error` (`{ text, untilMs }`, 5 s), connection status
  (a disconnect clears `menu`).
- Actions: connection, event, command, command-result, tick, dismiss.
- Selected view (`selectTeamSelect(state, hud, nowMs)`): hidden unless a menu is open, not dismissed and the HUD
  has a snapshot; teams by role (NTF left, SCP right) from the HUD view model, rows with name, avatar,
  online (human row) / offline (bot row), the viewer's role, `forced`, `pendingTeam`, `errorText`.
- Click on the viewer's own team -> close only (CS2 `_SelectTeam`); select accepted / close sent -> the session id
  is dismissed at once, so the panel never waits for the round trip.

### 5.2 Panel (`TeamSelect.tsx` / `TeamSelect.css`)

Geometry from `research/cs2-team-select.md`, canvas rules from spec 3 (Viewport):
- Full-screen root above every panel. Backdrop element with `useBackdropRef()` over the whole window: blur on ->
  `rgba(0,0,0,.3)` (Panorama fallback `brightness .7`); blur off -> a dense dark fill picked at the visual gate.
- Two half-window buttons, 90% high; top gradient from the side's dark colour to 0 over 30% (40% hovered):
  NTF `rgba(37,75,105,1)` (CS2's CT gradient, derived from `ct-color` = NTF's colour), SCP the same derivation
  from `#d94652` (about `rgba(85,27,32,1)`, final value at the visual gate). Bottom band `#00000080` below 91.5%
  with a 1% ramp.
- Column 800 wide hugging the seam, content centred 400 px from it: round icon (80 px disc in the team colour with
  the emblem mask in dark, dim / bright hovered by the measured 1.7x), title (NTF / SCP, 50px Stratum2 Bold
  Condensed), subtitle "{n} 玩家" (20px bold), roster (200 px rows, pitch 47, avatar + 17px name, letter-spacing
  .35px; human row team colour + black name, bot row `#303030` + white; opacity .8, 1 hovered; shadow
  `#0000005e 0 0 6px`; down-wrap at 280 px).
- Action bar bottom-right (96 px, padding 0 64px): Cancel (hidden when forced), 观察, 自动选择; 28px icons,
  24px labels, hover `rgba(255,255,255,.05)`. Icons SLUI-drawn under `public/assets/teamselect/` (cancel, camera,
  refresh, warning).
- Error banner centred: `rgba(0,0,0,.5)`, padding 16, radius 2, warning icon + label in `#b1af2d`, 0.25 s fade,
  5 s.
- Black fade on each new session: opacity 1, after 0.5 s a 0.5 s transition to 0 (`_ShowPanel`).
- No `text-shadow` anywhere (spec rule), fonts through `src/shared/fonts.ts`.

### 5.3 App

- Declare `team-select`; route `team.menu` and team `command.result`s to the feature; send commands through
  `connection.send` (send failure -> `failed`).
- While the panel is visible: overlay interactive with keyboard focus; shop, scoreboard and chat forced closed and
  their shortcuts ignored; the other HUD panels not rendered. Page keys: `Digit1` / `Digit2` join, `Escape` / `KeyM`
  close when not forced.

### 5.4 Mock

- Debug option `teamSelect=ntf|scp|forced` (hover pinned on a side for captures; `forced` = empty teams, no
  Cancel), rosters matching the captures (1 + 4 / 5 and 0 / 0); the mock connection answers the commands (accept;
  `rejectTeam` option returns "SCP队伍人数已满。" for the banner).

## 6. Compatibility and rollout

- New SLUI + old plugin: no `team.menu` ever arrives; the plugin ignores the unknown feature and keeps the Hint
  roster. Old SLUI + new plugin: no feature, Hint roster (plus the forced open on join, D3).
- The sidecar must understand `team.menu` before the plugin publishes it: backend before plugin in any deploy.
- Rollback: revert the plugin branch first (stops publishing), then the backend; SLUI's panel just never shows.

## 7. Risks

- SLUI presence can arrive after the forced open on join: the Hint roster may flash until presence lands and the
  renderer switches (watched in the in-game check).
- Spectate in the action phase touches the win condition and compensation path: covered by transaction tests with
  a fake port, then the in-game check.
- The full-screen world blur at the user's strength: checked in game for smoothness like the other blurred panels.
