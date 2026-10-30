# Design: elevated game and exclusive fullscreen

## Boundaries

- Rust (`src-tauri`) owns detection: it already samples the foreground every 100 ms (`start_foreground_tracking`) and
  reads the game's token (`InputDiagnostics::note_game_process`). It publishes one snapshot; it does not decide
  features or UI.
- The overlay page owns the hand-back (features, panels, hotkeys) and the in-game hint.
- The home page owns the banners and the relaunch action.
- No protocol, sidecar or plugin change: `client.features` already carries per-feature claims.

## Contract: `GameConditions`

```rust
#[derive(Clone, Copy, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GameConditions {
    /// The current game process runs elevated and SLUI does not. False when unknown or no game.
    elevated_game: bool,
    /// The latched display-mode verdict; false while unknown or no game.
    exclusive_fullscreen: bool,
    revision: u64,
}
```

- Event `slgo-game-conditions` (`app.emit`, both windows) on every change; command `get_game_conditions` for the
  snapshot. Page side mirrors `gameForeground.ts`: listen first, then query, ignore older revisions, strict shape check.
- `relaunch_elevated` command (home page): `Result<(), String>`; `Err("cancelled")` when UAC was declined.

## Display-mode latch (pure, unit-tested)

`DisplayModeLatch { verdict: Option<bool>, candidate: Option<(bool, Instant)> }`, fed only while the game holds the
foreground and `IsIconic(game) == 0`:

- reading → `exclusive = state == QUNS_RUNNING_D3D_FULL_SCREEN` (failed `SHQueryUserNotificationState` = no sample).
- a reading equal to the verdict clears the candidate; a different one starts or continues a candidate; a candidate
  held for `STABLE = 1 s` becomes the verdict (logged).
- samples while the game is not in front or is minimized are skipped (the candidate timer is not reset by gaps: a gap
  ends the candidate, so only continuous agreement counts).
- reset to unknown when the game process id changes or the game exits.
- Sampling rate: every 3rd foreground tick (300 ms) while the game holds the foreground; the shell call is cheap but
  need not run at 10 Hz.

Probe evidence: exclusive transients last ≤ ~0.25 s; borderless `BUSY` is steady → 1 s separates them with margin.

## Elevation condition

`note_game_process` already computes the game's elevation per new process. SLUI's own elevation is read once at
startup (`diag::process_elevated(GetCurrentProcess())`, already logged). `elevated_game = game elevated && !slui
elevated`; reset with the process on exit (`start_game_process_tracking`).

## Minimized-state diagnostics

The foreground thread remembers the last game window (`GAME_FOREGROUND_WINDOW` keeps only the foreground one, so add a
`last_game_window`) and logs `IsIconic` transitions: `game window minimized` / `restored`. This is the evidence the
exclusive-mode hand-back relies on.

## Page: input-blocked hand-back

`inputBlocked = conditions.elevatedGame || conditions.exclusiveFullscreen` in `App.tsx`:

- features: `OVERLAY_CLIENT_FEATURES` minus `{chat-input, shop-menu, team-select}` while blocked (a pure helper
  `claimedFeatures(enabled, blocked)` in a small model file, smoke-tested). The existing apply effect logs the list.
- an open shop closes (`closeShopFor("input-blocked")`), chat closes, `teamSelectFeature.release()` (the plugin redraws
  its Hint menu on the presence change), scoreboard cursor off.
- shortcut handler: shop / chat shortcuts are ignored while blocked (logged like the other ignores).
- `overlayInteractive` is false while blocked, so no foreground take can happen even from a stale panel.

## In-game hint

A page-local notice `{ key, text, shownAtMs, expiresAtMs }` per condition, once per page lifetime (overlay page lives
as long as SLUI). `messageZoneAt` composes it into the `hint_high` slot only when the plugin's `hint_high` is empty, with
a neutral tone, ~6 s. Reuses `MessageZone`/`MessageBox` styles (CS2 `hud-hint`): no new component or CSS beyond what
the slot needs. Shown only while the overlay is visible (session live over the game), so the first sighting starts its
timer.

Texts (final wording at implementation; Chinese, short):
- exclusive: 「全屏独占模式下商店、聊天和选队改用游戏内界面，改为无边框窗口可恢复」
- elevated: 「游戏以管理员身份运行，商店、聊天和选队改用游戏内界面，以管理员身份重启 SLUI 可恢复」

## Home banners

`gameConditionBanners(conditions)` (pure, in `src/app/`) → up to two banners in the existing `home-banner` style
(`ThemePackBanner` pattern; the elevated one adds the action button like `UpdateBanner`). States of the action: idle /
busy (UAC shown) / cancelled / failed.

## Relaunch elevated

1. `relaunch_elevated`: `ShellExecuteExW { lpVerb: "runas", lpFile: current_exe, lpParameters: "--after-pid <pid>",
   nShow: SW_SHOWNORMAL }`. Failure `ERROR_CANCELLED (1223)` → `Err("cancelled")`; other → `Err(message)`.
2. On success: `diag!("SLGO: relaunching elevated; exiting")`, `app.exit(0)`.
3. New instance, first thing in `run()` (before the single-instance plugin): if `--after-pid N` is present, open the
   process with `SYNCHRONIZE` and wait up to 10 s for it to exit, then continue. A timeout continues anyway (the
   single-instance check then hands off, as today). Pure arg parsing is unit-tested, like `installer_args`.

## Exit reasons

`diag!` before each `app.exit`: tray quit, update install (exists), elevated relaunch. A missing exit line then means
a crash or a kill.

## Compatibility / rollout

- Older sidecars/plugins: unchanged contract; a smaller feature list is already legal.
- Rollback: revert the PR; no persisted state.
- Risk: a team menu that opens before the first stable verdict (join right after the game first comes to the front)
  can still take the foreground once in exclusive mode. Accepted; the log shows it.
