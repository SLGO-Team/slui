# 商店与聊天按系统前台关闭

## Problem

Field reports since 0.9/0.10: B "does nothing", the shop "closes after ~2 s" or right after a purchase, chat (Y/U)
does not stay open; the team menu works. Reproduced on the dev PC on 2026-10-30 with NVIDIA App's performance
overlay (Alt+R) on, using a SetWinEventHook recorder next to slui.log:

1. B: SLUI takes the foreground, the shop opens.
2. 0.1-0.55 s later `NVIDIA Overlay.exe` shows its statistics window ("NVIDIA GeForce Overlay DT").
3. 8 ms later focus bounces inside the overlay window (Tauri window, then the WebView child). No foreground change.
4. The page gets `blur`; the shop and chat close on blur; closing hands the foreground back to the game.

The foreground never leaves SLUI, so the 100 ms foreground poll sees nothing. The team menu ignores blur and survives.

## Requirements

- The shop and chat close when the overlay **loses the system foreground** after holding it since they opened: another
  application (Alt+Tab, a click elsewhere) or the game taking it. The source is the native foreground state the
  overlay already receives (`slgo-game-foreground`: the overlay holds it while `overGame && !focused`).
- A page `blur` (or `focus`) alone never closes them: a focus bounce inside the overlay window keeps them open, and
  chat's entry is refocused when the window regains focus.
- Before the overlay first holds the foreground after opening (the switch is under way, or Windows refused it), no
  foreground-based close happens, as today.
- Unchanged: Escape, the shop key, 返回, Y/U, a click outside chat, the buy window closing, the team menu and the overlay
  switching off still close them; the team menu and scoreboard keep their current rules.
- Diagnostics: `shop closed: foreground (...)` / `chat closed: foreground (...)` name whether the game or another
  window took it; the window focus/blur lines stay (they now show a harmless bounce).

## Acceptance Criteria

- [x] With NVIDIA's Alt+R overlay on, the shop and chat stay open until closed by the player (in-game, dev PC).
- [ ] Alt+Tab away with the shop or chat open closes it; returning to the game does not reopen it. (Covered by the
      smoke test; not exercised in game on 10-30.)
- [x] A smoke test covers the foreground-loss rule (held since opening, lost to the game, lost to another window,
      never held).
- [x] `npm run lint` and `npm test` pass; spec system-boundaries updated (close-on-foreground rule, the NVIDIA bounce).

## Out of Scope

- The 0.10.0 abort during a SCP:SL display-mode switch (separate investigation, local diagnostic build).
- Switching the native foreground poll to WinEvent hooks.
