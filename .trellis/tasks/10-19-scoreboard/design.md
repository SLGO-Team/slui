# Design: CS2 scoreboard

## 1. Data flow

```text
roster, names, avatars, alive,   match.snapshot (exists; viewer-team loadout.money, team role, score,
online, score, money, round        round number, state)
per-side stats, ping, round      scoreboard.snapshot (new; plugin -> sidecar -> SLUI, same payload for
history, loss bonus, mode, time    every SLUI player that declares `scoreboard`)
hold key, right-click            Rust low-level keyboard + mouse hooks -> overlay events

plugin main thread -> SidecarScoreboardPublisher (signature diff, throttled, presence gated)
  -> IPC v1 publish scoreboard.snapshot -> sidecar parseEvent + snapshot cache/replay (elapsed aged)
  -> SLUI parseEvent -> scoreboardReducer -> selectScoreboard(round HUD, scoreboard, view state, steamId)
  -> Scoreboard panel
```

Repo order follows `10-05-hud-data-channel` / `10-07-cs2-bottom-hud`: slui `@slgo/protocol` first (the
sidecar validates every plugin publish with it), then slgo-backend, then the SLGO plugin, then SLUI input and
rendering.

## 2. Wire event `scoreboard.snapshot` (protocol v0, envelope schema 1)

New event type; old clients skip it (`unsupported-event-type`). Snapshot type (latest cached and replayed).
Multi-recipient: the payload is identical for every recipient (money stays in `match.snapshot`, which
already limits it to the viewer's team), so one publish carries the whole audience.

```ts
type ScoreboardSideStats = {
  rounds_played: number;    // rounds finished while on this side (ADR denominator)
  kills: number;            // same counting rules as today's PlayerSideStats.Kills
  deaths: number;
  assists: number;
  damage: number;           // integer HP damage, same rules as TotalDamage
  shots_fired: number;      // firearm shots (PlayerSideStats.ShotsFired, ShotTally: one per trigger pull)
  shots_hit: number;        // shots that hit a player (ShotsHit), <= shots_fired
  mvps: number;             // round MVPs earned on this side
  utility_damage: number;   // part of `damage` dealt by the player's own HE grenades
  enemies_flashed: number;  // enemies blinded by the player's own flashbangs (one per victim per detonation)
};

type ScoreboardPlayer = {
  player_id: string;        // SteamID64, the id match.snapshot uses
  ping_ms: number | null;   // null for bots / test dummies / unknown
  is_bot: boolean;
  ntf: ScoreboardSideStats;
  scp: ScoreboardSideStats;
};

type ScoreboardRoundReason = "elimination" | "generator_activated" | "generator_deactivated" | "time_expired";

type ScoreboardRound = {
  round: number;            // 1-based, strictly increasing
  winner_team_id: TeamId;
  winner_role: Role;        // the winner's side in that round (timeline icon colour)
  reason: ScoreboardRoundReason;
};

type ScoreboardSnapshot = {
  mode_name: string;        // plugin-authored label, e.g. "竞技模式" / "休闲模式" (HudText limits)
  mode_icon: "competitive" | "casual";
  elapsed_ms: number;       // match time at sent_at; SLUI counts on from the receive time
  max_rounds: number;
  score_to_win: number;
  halftime_after_round: number | null;   // 12 in competitive; null without halftime
  rounds: ScoreboardRound[];             // finished rounds, in order; length <= max_rounds
  loss_bonus: Record<TeamId, number> | null;  // level 0..4 per team; null when the mode has no loss streaks
  players: ScoreboardPlayer[];           // unique ids, <= 64
};
```

Validation (parser; plugin self-check equivalent): non-negative integers, `shots_hit <= shots_fired`,
`utility_damage <= damage`, enums closed, rounds strictly increasing and `<= max_rounds`, unique player ids,
`halftime_after_round` in `1..max_rounds-1` or null, no unknown fields. Rounds the plugin ends without a
winner (`RoundEndReason.Unknown`, admin end) are not listed, so `rounds` may skip a number.

Information exposure equals the plugin's hint board today (both teams' K/D/A/damage and alive state to anyone
holding the key outside Idle / WaitingForPlayers); ping, round history and loss bonus are public in CS2 too.
Enemy money stays out (plugin `match-information-isolation.md`, `match.snapshot` loadout rule).

Client feature `CLIENT_FEATURE_SCOREBOARD = "scoreboard"`: SLUI declares it to receive `scoreboard.snapshot`
and to take the scoreboard over; the plugin then ignores its own scoreboard keybind for that player.

## 3. Plugin (SLGO)

- Stats (`Features/Stats`): `PlayerSideStats` gains `RoundsPlayed`, `Mvps`, `UtilityDamage`,
  `EnemiesFlashed`, all per side bucket like the existing fields.
  - Hit rate uses the existing `ShotsFired` / `ShotsHit` (the hint board's 命%). Headshots are not used: SLGO only
    registers them for NTF shooting SCP-049-2 (user decision 2026-10-20).
  - MVP: `MvpManager` result at round end -> MVP player's bucket for the side they played that round.
  - Utility damage: damage already counted in `TotalDamage` whose handler is the attacker's own HE grenade
    explosion.
  - Enemies flashed: an enemy receiving the flashbang effect from the attacker's own flashbang; research which
    game event carries the thrower and the victims (teammates and self excluded).
  - Rounds played: at round end, every player assigned to a team gets +1 on that side.
- Round history: `ScoreManager` keeps the list of finished rounds (round, winner team, winner role, reason),
  reset with the match. Reason mapping: NtfEliminated / ScpEliminated -> `elimination`, GeneratorActivated ->
  `generator_activated`, GeneratorDeactivated -> `generator_deactivated`, TimeExpired -> `time_expired`.
  `Unknown` (admin end) is not recorded as a round.
- Ping: research the server-side RTT source (LiteNetLib peer of the player's connection); dummies and NPCs ->
  `ping_ms: null`, `is_bot: true`.
- Loss bonus: `EconomyManager.GetLossStreakLevel(role)` mapped to the team holding that role; `null` when
  `LossStreaksEnabled` is false.
- Publisher `SidecarScoreboardPublisher` in `SidecarIpcManager.PumpOnce`: audience = sidecar-visible Steam
  players whose SLUI presence lists `scoreboard`; payload signature excludes `elapsed_ms`; publish when the
  signature changes, at most every 500 ms; forced after handshake resync and when a player gains the feature.
- Hint scoreboard: `StatsKeybindHandler` ignores the key for players whose presence lists `scoreboard`
  (the hint scoreboard stays for everyone else).

## 4. Sidecar (slgo-backend)

`scoreboard.snapshot` in `PUBLISH_EVENT_TYPES`, `SNAPSHOT_EVENT_TYPES`, `REPLAY_ORDER` and
`REPLAY_AGED_EVENT_TYPES` (replay adds the cache age to `elapsed_ms`); IPC v1 schema enum, example and
`invalid/` fixtures; README event table and feature list; dev client summary line. No new routing logic.

## 5. SLUI input (Rust + platform)

- `HotkeySettings` gains `scoreboard`, default `"CapsLock"`. Bindable scoreboard keys: CapsLock, letters, F1-F12,
  never Y / U and never the shop key (the shop key may not take the scoreboard key either). Rust stores it next
  to the shop key (`VK_CAPITAL` 0x14) and validates the same set.
- Keyboard hook: a non-repeat key-down of the scoreboard key while the overlay is enabled and the game holds the
  foreground sets `SCOREBOARD_HELD` and emits `slgo-scoreboard-key { held: true }`; its key-up (whatever window
  is in front, since cursor mode makes the overlay the foreground) clears it and emits `held: false`. Keys are
  never swallowed, as with every existing hotkey (CapsLock keeps toggling the caps state).
- Mouse hook (new `WH_MOUSE_LL` on the same time-critical hook-thread pattern): while `SCOREBOARD_CAPTURE` is set
  and the game holds the foreground, swallow `WM_RBUTTONDOWN` and its matching `WM_RBUTTONUP` and emit
  `slgo-scoreboard-cursor`. All other mouse input passes. The overlay sets the flag through a new command
  `set_scoreboard_capture(bool)` only while the panel is actually shown and passive, so a key press that shows
  nothing never eats a right-click.
- Cursor mode reuses the shop path: `set_overlay_interactive(true)` + `set_overlay_keyboard_focus(true)`; key-up
  hides the panel, clears capture, returns focus to the game and goes passive. The game gets no keyboard while
  the cursor is on (accepted, same as the shop).
- The panel does not show while the shop or chat is open, in `Idle` / `WaitingForPlayers`, or before a
  `scoreboard.snapshot` for the current source arrived (old plugins keep their hint scoreboard). Opening the
  shop or chat hides it.
- Home window: `HotkeySettings` adds a 计分板 row; `KeyHints` lists it.

## 6. SLUI panel

### Model (`src/features/scoreboard/model.ts`)

Reducer over `sidecar.baseline` / `scoreboard.snapshot` with the same source, sequence and baseline rules as
`roundHudReducer`; frame keeps `receivedAtMs` so `elapsed_ms` counts on locally.

### Presentation (`src/features/scoreboard/presentation.ts`)

- Rows: the `match.snapshot` roster per team, joined with scoreboard players by id (missing stats = zeros).
- View state (local, kept for the SLUI session): `page: 1 | 2`, `side: "current" | "other"`, `sortStat`.
  `side` falls back to `"current"` whenever the other side is unavailable (no halftime, first half, new match).
- Displayed bucket per row: the role of the row's team now (`current`) or the other role (`other`).
- Derived: 命中率 = round(100 * shots_hit / shots_fired) (0 without shots), in CS2's HS% column, KDR = kills / max(deaths, 1) (2
  decimals), ADR = round(damage / rounds_played) (0 when none).
- Columns: page 1 金钱 / 杀敌数 / 死亡数 / 助攻数 / 命中率 / 伤害; page 2 MVP次数 / 道具 / 致盲 / KDR / 伤/局 / 伤害.
  Money only for the viewer's own team in the current view (spectators and the other view: blank). Rows whose
  displayed bucket is SCP leave 命中率 / 道具 / 致盲 blank (SCPs cannot earn them; the plugin's hint board blanks
  命% the same way).
- Sort (CS2 `sortOrder_tmm`): online first, then damage desc, kills desc, MVPs desc, assists desc, deaths asc,
  roster order. A header click puts that stat first and keeps the chain for ties; no direction toggle; the
  active header is highlighted; re-sorting pauses while the pointer is over a row (CS2).
- Template (CS2 `scoreboard.js`): modes with halftime use the timeline template (half-time scores, round
  timeline, loss-bonus pips); modes without halftime use CS2's casual template, an empty 24px spacer instead
  (layout research, "Template choice"). The snapshot still carries the rounds either way.
- Half scores: wins per team before and after `halftime_after_round`.
- Timeline: `max_rounds` slots, divider after the halftime round, round numbers every 5, winner icons above for
  the top team and below for the bottom team, a trophy where the earlier team would reach `score_to_win`, later
  rounds faded; loss-bonus pips per team (hidden when `loss_bonus` is null).

### Component (`Scoreboard.tsx` / `Scoreboard.css`)

- Header row: mode icon + `mode_name`, elapsed time on the right. No map and no server line.
- Cursor mode: buttons top-right: side swap (second half of a halftime mode only) then stats; the footer hint
  "[MOUSE2] 启用光标" shows only when passive.
- Team blocks: SCP on top, NTF below (fixed by role: CS2 fixes CT on top and SLGO's SCP is CT in `hudSideForRole`;
  `SCOREBOARD_TOP_ROLE` flips it); score emblem (existing SLUI-drawn
  NTF fox / SCP claw), side name, 存活 n/N; rows with ping or bot icon, avatar framed in the top-HUD slot colour
  (`playerSlotColors`), name, stat cells, MVP star with count, dead rows dimmed with an X, offline rows in CS2's
  disconnected style, the local player's row highlighted. Up to 10 rows per team (casual).
- In the other-side view, team blocks keep their positions and a 上半场 marker states which data is shown.
- Layout, colours, fonts and transitions from the user screenshots (visual authority) measured with Panorama
  `scoreboard.css` (row transition 0.25 s, hover 0.1 s); canvas and scale per `cs2-visual-replication.md`.
- Assets in `public/assets/scoreboard/`, SLUI-drawn: mode icons, stats and side-swap buttons, round reason icons
  (elimination, time), trophy, star, bot, ping bars, dead X, team-logo discs. The two generator reasons reuse the
  existing analogues: activated = `KeycardNTFCommander.svg` (the HUD's bomb stand-in), deactivated =
  `icons/wire-cutters.svg` (the HUD's defuser stand-in).
- Colours: team tint = `ROLE_COLORS` (NTF / SCP), as in the bottom HUD and shop; measured values and the local-row
  and dead-row treatments in `research/cs2-scoreboard-layout.md`.

### Mock

Scenes `scoreboard-competitive` (second half, history available, mixed alive/dead/offline), `scoreboard-casual`
(10v10, no halftime), with debug toggles for held / cursor / page / side.

## 7. Compatibility and rollback

- Old plugin + new SLUI: no `scoreboard.snapshot`, SLUI never shows the panel and never captures right-click; the
  plugin's hint board keeps working.
- New plugin + old SLUI: the feature is not declared, the plugin keeps its hint board.
- Rollback: remove `scoreboard` from `OVERLAY_CLIENT_FEATURES`.

## 8. Risks

- Swallowing right-click in `WH_MOUSE_LL` must keep SCP:SL from aiming; verify in game before building the panel
  (implement step 5 spike). If the game still sees it, stop and decide with the user.
- CapsLock is not swallowed, so every scoreboard press toggles the caps state (as with the plugin's binding today).
- Ping source on the server is unverified.
- slgo-backend links `@slgo/protocol` through `../slui/packages/protocol` of the main checkout, which another
  session currently uses on `feat/auto-update`: land the protocol change on `main` first and run backend tests
  against a checkout that carries it.
