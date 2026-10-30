# Overlay: elevated game and exclusive fullscreen

## Goal

Two player reports on 0.10.2 looked like the NVIDIA focus bounce fixed in #75 but had other causes: an elevated game
and SL's exclusive fullscreen. SLUI recognises both conditions itself, tells the player the cause and the remedy (home
window and in game), hands the input-taking features back to the plugin's in-game UI while a condition holds, and
logs enough to explain the next report without guessing.

## Background (evidence)

### A. Elevated game, non-elevated SLUI (player 1, Win10 19045)

- Log: `SLUI elevated: no` and `game process … holds the foreground; elevated: yes` (`InputDiagnostics::note_game_process`,
  `src-tauri/src/lib.rs:896`; token read in `diag::process_elevated`, `src-tauri/src/diag.rs:165`).
- UIPI symptoms: every `hotkey` line says `game foreground false` (the low-level hook sees no keys sent to the
  elevated game); `SetForegroundWindow refused (5)` and AttachThreadInput failing in `take_keyboard_focus`
  (`src-tauri/src/lib.rs:522`). With `shop-menu` claimed, the plugin's own shop key is off too: no shop at all.
- The player launched the game from Steam and never chose "run as administrator": elevation is inherited.
- Confirmed: quitting SLUI from the tray and starting it as administrator fixed everything.
- Trap: a tray-resident non-elevated SLUI makes an elevated second launch hand off and exit (single-instance plugin,
  `src-tauri/src/lib.rs:1261`), so "run as admin" seemed not to help until the old instance was quit.

### B. Exclusive fullscreen (player 2, Win11 24H2; reproduced locally)

- Every overlay UI (shop, chat, team menu, scoreboard cursor mode) takes the foreground
  (`set_overlay_keyboard_focus`, `src-tauri/src/lib.rs:497`; `overlayInteractive`, `src/App.tsx:564`).
- In exclusive fullscreen the game minimizes itself after losing the foreground; minimizing activates the next
  window in z-order (SLUI's home window: `foreground left …: slui.exe (class Tauri Window)` 165–900 ms after the
  overlay took the foreground, no input in between). The overlay then hides and input goes off; the player sees the
  desktop and the menu is gone on return.
- Local probe (`SHQueryUserNotificationState` + `IsIconic`, every 200 ms, 10-30 23:25–23:29):
  - exclusive: `QUNS_RUNNING_D3D_FULL_SCREEN` while the game holds the foreground; ~0.6 s after the overlay took the
    foreground the SL window was iconic (`-32000,-32000`).
  - borderless: a steady `QUNS_BUSY` while the game holds the foreground; five overlay foreground takes, never iconic.
  - transitions show short (≤ ~0.25 s) `QUNS_BUSY` readings in exclusive mode too, and other states while another
    window is in front: only a stable reading taken while the game holds the foreground (not iconic) says the mode.
- Not every foreground take minimized the game (the first team menu of the local repro did not).
- The plugin falls back per feature and reacts to presence changes mid-session (`sluiPresence.Changed`,
  `TeamSelectionMenuManager.cs:99`, `UIManager.cs:160`, plugin repo): without `team-select` it draws its own Hint team
  menu, without `shop-menu` its in-game shop opens on its own key, without `chat-input` its message area returns. The
  page reports features through `connection.setFeatures` (`src/App.tsx:351`), which sends at once while live
  (`src/platform/connection.ts:237`). No plugin change is needed.

### C. Diagnostics gaps

- `release_keyboard_focus` (`src-tauri/src/lib.rs:601`) returns silently on three branches; player 2's first failure
  (`overlay input off … (page focused: true)`) cannot be explained from the log.
- Tray quit and a native crash look the same: nothing is logged on exit.
- The game window's minimized state and display mode are never logged.

## Decisions

- D1 Exclusive fullscreen: tell the player and hand the input-taking features back to the plugin's in-game UI; passive
  HUD features stay with SLUI. (User, 10-30.)
- D2 The same hand-back applies while the game is elevated and SLUI is not: SLUI cannot take input then either, and a
  claimed `shop-menu` leaves the player with no shop at all. (Follows from D1; confirm at review.)
- D3 Elevated game: offer relaunching SLUI elevated; the old instance exits before the new one runs.
- D4 Where: a home banner while the condition holds, plus one passive in-game hint per condition per SLUI run.
  (User, 10-30.) The home window is never brought to the front for it (that alone minimizes an exclusive game).

## Requirements

- R1 Detect the game's display mode from `SHQueryUserNotificationState`, sampled only while the game holds the
  foreground and its window is not minimized; a mode is adopted only after the same verdict has held for a stable
  period (exclusive = `QUNS_RUNNING_D3D_FULL_SCREEN`, any other state = not exclusive). Unknown until the first stable
  verdict; reset when the game process changes or exits.
- R2 Detect "game elevated, SLUI not" from the existing token read, per game process; reset on game exit.
- R3 While R1 says exclusive or R2 holds ("input blocked"): the page stops claiming `team-select`, `shop-menu` and
  `chat-input`; an open shop, chat or team menu closes; the scoreboard cursor mode is off; the shop key and Y/U do not
  open SLUI panels. Every other feature stays claimed. When the condition ends, the features are claimed again.
- R4 Home banner per active condition (existing `home-banner` style): the elevated one has the action
  「以管理员身份重启 SLUI」; the exclusive one tells the player to switch SL to a borderless/windowed mode.
- R5 Relaunch elevated: UAC prompt via `ShellExecuteEx` `runas` on the running exe with `--after-pid <pid>`; on success
  the old instance logs and exits; the new instance waits for that process to exit before the single-instance check.
  A declined prompt leaves the old instance running and the banner says it was cancelled.
- R6 In-game hint: one short passive notice per condition per SLUI run, drawn in the HUD message zone's hint style
  (CS2 `hud-hint`, no new visual language, no text-shadow), only where the plugin's own slot is empty, gone after a few
  seconds; it never takes input or the foreground.
- R7 Diagnostics: log each `release_keyboard_focus` outcome (handed back / foreground not the overlay, with what holds
  it / no return window / window gone / SetForegroundWindow failed with error); the game window becoming minimized or
  restored; each display-mode verdict; each condition change and the features handed back; exit reasons (tray quit,
  update, elevated relaunch).

## Acceptance Criteria

- [ ] AC1 (R1) Exclusive SL: within ~1.5 s of the game holding the foreground the log says exclusive; borderless or
  windowed SL: not exclusive; transient `BUSY` readings during exclusive mode switches never flip the verdict
  (unit-tested latch with the probe's sequences).
- [ ] AC2 (R3, D1) In exclusive SL: pressing M shows the plugin's Hint team menu, B opens the plugin's in-game shop,
  Y/U open the plugin's chat area; the game is never minimized by SLUI; the HUD, killfeed, scoreboard (passive) still
  show. Switching SL to borderless brings the SLUI panels back without restarting.
- [ ] AC3 (R2, R3, D2) Elevated game with non-elevated SLUI: the same hand-back as AC2 (shop works through the
  plugin's key).
- [ ] AC4 (R4, R5) The elevated banner's action shows UAC; accepting it leaves exactly one SLUI running, elevated
  (`SLUI elevated: yes`), connected again; declining keeps the old instance and says it was cancelled.
- [ ] AC5 (R6) Each condition shows the in-game hint once per run, passive, in CS2 hint style, without covering a
  plugin message.
- [ ] AC6 (R7) A repro log shows the release outcome, the game window minimizing, the display mode and the exit reason.
- [ ] AC7 `npm test`, `npm run lint`, CI's `cargo clippy -D warnings` and workspace tests pass.
- [ ] AC8 Visual review by the user (home banners and the in-game hint) before merge.

## Out of Scope

- Making SLUI's panels work in exclusive fullscreen (the game minimizes on any foreground loss).
- `uiAccess` manifests or always-elevated SLUI; keeping elevation across an auto-update (the installer restarts SLUI
  non-elevated; the banner returns).
- Plugin or backend changes.
