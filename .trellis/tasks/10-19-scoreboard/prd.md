# CS2 scoreboard

## Goal

SLUI draws the CS2 competitive scoreboard over SCP:SL: hold the scoreboard key to see both teams' stats,
right-click for a cursor, click a column header to sort, click the stats button to switch between the two stat
pages, and (second half) switch to the other side's stats. It replaces the plugin's hint-text scoreboard for
SLUI players.

## Reference

User screenshots of CS2 competitive (2026-10-19), the visual authority:

- **Passive (key held)**: mouse and keyboard keep driving the game, except right-click, which the scoreboard
  takes. Footer hint "[MOUSE2] 启用光标". Page 1 columns 金钱 / 杀敌数 / 死亡数 / 助攻数 / 爆% / 伤害, sorted by
  伤害 descending.
- **Cursor mode (after right-click)**: cursor visible, buttons top-right, column headers clickable.
- **Page 2**: MVP次数 / 道具 / 致盲 / KDR / 伤/局 / 伤害; it stays until the button is clicked again, across
  closing and reopening.
- Other parts: header (mode icon, mode | map, elapsed time), server line, per-team score emblem + side name +
  存活 n/5, half scores, round history timeline with win-reason icons and halftime divider, 战败补偿 pips, ping
  or bot icon, avatar framed in the player colour, MVP star with count, dead rows dimmed with an X, local row
  highlighted.

Panorama sources and behaviour notes: `research/cs2-scoreboard-reference.md`.

## Background (repository evidence)

- Plugin hint board: `../SLGO/SLGO/Features/UI/PlayerStatsUI.cs`, opened by
  `Features/Stats/StatsKeybindHandler.cs` (SSSS keybind 计分板, default CapsLock, hold; hidden in Idle /
  WaitingForPlayers and while a modal is open; left/right arrows show the other side from round 13). SCP:SL uses
  Tab for the inventory.
- Plugin stats (`Features/Stats/PlayerStats.cs`, `PlayerStatsManager.cs`) are kept per player **per side** (NTF
  / SCP bucket): Kills, Deaths, Assists, TotalDamage (raw HP), ShotsFired, ShotsHit. Headshot kills, match MVP
  count, utility damage, enemies flashed, rounds played, ping and round history are not tracked yet.
- Modes (`../SLGO/config/game-modes`): competitive 5v5, MR24, halftime, loss streaks; casual up to 10 per team,
  15 rounds, no halftime.
- SLUI: `match.snapshot` carries roster, names, avatars, alive/online, scores, round and the viewer team's money;
  client features hand UIs over from the plugin; the Rust keyboard hook sees key-downs only and never swallows
  keys; there is no mouse hook; cursor mode means making the overlay the foreground window (shop, chat), during
  which the game gets no keyboard.

## Decisions (user, 2026-10-19)

- D1 Stats show the **current side** by default; in the second half of a halftime mode a button switches to the
  **other side's** stats (plugin dual-bucket semantics kept).
- D2 SLUI owns the scoreboard key, default **CapsLock**, rebindable in the home window; the plugin stops showing
  its hint board for SLUI players.
- D3 Cursor mode works like the shop: the overlay takes the foreground; the game gets no keyboard until the
  scoreboard key is released.
- D4 Full panel, not just the table.
- D5 The side switch is a second button top-right in cursor mode, next to the stats button; like the page it
  stays until clicked again.
- D6 The header shows the mode only: no map name, no server line.

## Requirements

- R1 Holding the scoreboard key while the game is in front shows the panel; releasing it hides it. Not shown in
  Idle / WaitingForPlayers, while the shop or chat is open, or before the plugin sent scoreboard data.
- R2 While the panel shows in passive mode, right-click enters cursor mode and never reaches the game; other
  mouse and keyboard input keeps reaching the game.
- R3 In cursor mode, clicking a column header sorts both teams by that stat with CS2's tie-break chain; default
  sort is damage; no direction toggle; the active header is marked.
- R4 In cursor mode, the stats button switches page 1 / page 2; the page persists across reopening until clicked
  again.
- R5 In cursor mode during the second half of a halftime mode, the side button switches between current-side and
  other-side stats, marked 上半场 while showing the other side; it persists like the page and falls back to the
  current side when unavailable.
- R6 Stats: K, D, A, damage, hit rate 命中率 (shots hit / shots fired, in CS2's HS% column: SLGO's headshots only count
  for NTF shooting SCP-049-2; user decision 2026-10-20), MVPs, utility damage (own HE grenades), enemies
  flashed (own flashbangs), KDR (kills / max(deaths, 1)), ADR (damage / rounds played), all per side. Money only
  for the viewer's own team in the current-side view. 命中率 / 道具 / 致盲 blank on rows showing SCP-side stats.
- R7 Panel parts: header (mode icon + name, elapsed time), team blocks (SCP top, NTF bottom) with score emblem,
  side name and alive count; in halftime modes (CS2's competitive template; casual has none) half scores, round
  timeline with win-reason icons, trophies and halftime divider, and loss-bonus pips (modes with loss streaks);
  rows with ping or bot icon, slot-coloured avatar, name, MVP star with count, dead and offline styles, local row
  highlight; up to 10 rows per team.
- R8 Data comes from the plugin through the sidecar as `scoreboard.snapshot`; SLUI declares client feature
  `scoreboard`; the plugin's hint board stays for players without it.
- R9 The scoreboard key is configurable in the home window (CapsLock, letters, F1-F12; not Y / U; not the shop
  key) and listed in the key hints.
- R10 Layout follows the CS2 screenshots on the 1080-unit Panorama canvas at 16:9, 16:10 and 4:3.

## Acceptance Criteria

- [ ] AC1 (R1) In game, holding CapsLock shows the panel within one frame of the key event and releasing hides it;
      it does not show in warmup waiting, with the shop or chat open, or against a plugin without scoreboard data.
- [ ] AC2 (R2) With the panel shown, right-click does not make the game aim and turns on the cursor; WASD and left
      click keep working before that right-click.
- [ ] AC3 (R3) Clicking 杀敌数 orders each team by kills (ties by the CS2 chain); deaths sort ascending; reopening
      keeps the chosen sort.
- [ ] AC4 (R4) Page 2 stays after release and re-hold until the stats button is clicked again.
- [ ] AC5 (R5) In the competitive second half the side button shows first-half stats under the 上半场 marker; the
      button is absent in the first half and in casual.
- [ ] AC6 (R6) Model smoke tests cover derived stats, blank cells, money visibility and the sort chain; plugin
      tests cover the new counters and reason mapping.
- [ ] AC7 (R7, R10) Mock scenes `scoreboard-competitive` and `scoreboard-casual` match the screenshots in the
      layout audit at 1920x1080, 16:10 and 4:3, and the user approves the visuals.
- [ ] AC8 (R8) `scoreboard.snapshot` fixtures parse identically in `@slgo/protocol`, the sidecar and the plugin
      self-check; an old plugin leaves SLUI's panel off and its hint board on.
- [ ] AC9 (R9) The home window rebinds the key with the conflict rules, and the Rust hook follows the change.
- [ ] AC10 All validation commands in `implement.md` pass in the three repos; live test on a server passes.

## Out of Scope

- Player card and voice buttons, the player context menu.
- Timeline casualty tooltips and the loss-bonus tooltip.
- Map name and server line in the header.
- Keyboard control of the game while the cursor is on.
