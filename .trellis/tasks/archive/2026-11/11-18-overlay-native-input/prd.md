# Replay bar details and overlay native web input

## Goal

The overlay stands in for CS2's own UI, so nothing on it may behave like a web page. Two replay-bar details
are also off.

## Requirements

1. **Speed ticks are not clickable.** On the replay bar's speed slider only the track and thumb take the
   pointer; the tick row below it (pause glyph, bars, arrows) is decoration and ignores clicks and drags.
2. **Replay player names use SLGO faction colours.** The watched-player name and the player list entries are
   coloured by the player's SLGO role (`ROLE_COLORS`: SCP red, NTF blue), not CS2's CT blue / T gold.
3. **No web-native interaction on the overlay.**
   - WebView2 browser accelerator keys are off (F5 / Ctrl+R reload, Ctrl+F find, Ctrl+P print, Alt+Left back,
     F7 caret browsing, F12 / Ctrl+Shift+I and similar).
   - Tab never moves focus (also inside text fields).
   - Outside text fields: Home / End / Page Up / Page Down / arrows do not scroll, Enter / Space do not
     activate a focused button, Ctrl+A does not select the page. Inside text fields caret and editing keys
     keep working.
   - No drag of images / text, no middle-click autoscroll, no mouse back / forward navigation.
   - Feature keys that use these keys (replay console arrows / Page Up / Page Down / Space, shop, team
     select, chat) keep working.

## Acceptance criteria

- [x] Clicking a speed tick does not change the speed; clicking / dragging the track still does.
- [x] Replay player name and list entries show `ROLE_COLORS` per side.
- [x] In the overlay, Tab / End / Home / F5 / Ctrl+F do nothing; replay keys still work.
- [x] `npm test` (lint, types, smokes) and Rust clippy `-D warnings` pass.

## Out of scope

- Home window keyboard behaviour beyond the WebView2 accelerator-key setting.
