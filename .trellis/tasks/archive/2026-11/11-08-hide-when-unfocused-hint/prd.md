# Warn when SL hides its window when unfocused

## Goal

Tell the player when SCP:SL's display mode is 「无边窗口化 - 后台时隐藏窗口」 ("Borderless Window - Hide When
Unfocused") and how to switch to 「无边窗口化 - 始终可见」. In that mode the game minimizes itself whenever it loses
the foreground, so every SLUI panel that takes input (shop, chat, team menu) minimizes the game.

## Background

- 11-08 field report: the game minimized on every shop open, on Alt-Tab to QQ / the UU accelerator and on SLUI home.
  With the world blur live this restore crashed SLUI (fixed in #108). The reporter first said 「始终可见」, then
  admitted they were on 「后台时隐藏窗口」.
- The game's IL2CPP code (`GameAssembly.dll`, build of 2026-11-02): `FullscreenWindowManager.OnFocusChanged(false)`
  reads display setting key 2 and, only when its value is 2, calls `ShowWindow(GetActiveWindow(), SW_SHOWMINIMIZED)`.
- The setting persists in `%APPDATA%\SCP Secret Laboratory\registry.txt` as the line
  `07UserSettings_0A50_2000::-%(|::<value>` (type prefix, key, separator, value; CRLF and LF lines both occur).
  Values follow the menu: 0 独占全屏, 1 始终可见, 2 后台时隐藏窗口, 3 窗口化. Dev PC on 始终可见 reads 1.

## Requirements

- R1 Rust reads that line while the game runs (re-parsing only when the file's modified time changes) and publishes
  `hidesWhenUnfocused` in the game conditions (`slgo-game-conditions` / `get_game_conditions`). False when the game
  is not running, the file or line is missing, or the value is not 2. A change is logged.
- R2 Warn only: the condition does not block input (`inputBlockedBy` unchanged); shop, chat and team menu stay SLUI's.
- R3 Home shows a warn banner while it holds, naming the setting and the value to pick.
- R4 The overlay shows the once-per-run in-game notice for it (same slot and rules as the other conditions).
- R5 Browser preview `?gameConditions=` gains a value for it.

## Acceptance Criteria

- [x] AC1 Parser unit tests: value 2 → true; 1 / 0 / 3 / missing line / malformed → false; CRLF and LF.
- [x] AC2 Smoke tests cover the new field (native source validation, banners, hint, no input block).
- [ ] AC3 Banner checked in the browser preview; the user reviews it visually before merge.
- [ ] AC4 Live: switching SL's display mode to 后台时隐藏窗口 shows the banner (and confirms the registry key);
  switching back clears it.
- [x] AC5 CI clippy, workspace tests and `npm test` pass; spec updated.

## Out of scope

- Changing the game's setting for the player.
- Changing how exclusive fullscreen is detected.
