# Chat: a held opening key no longer types through a Chinese IME

Source: item 4 of the 2026-11-25 cloud review follow-ups. Needed a Windows test with a Chinese IME.

## Problem (reproduced 2026-11-25, debug SLUI over a stand-in SCPSL.exe, Sogou Pinyin)

Holding Y to open chat with a Chinese IME active typed the key's auto-repeat into the draft. The review
suspected the early `keyCode === 229` return in `ChatInput.handleKeyDown`. The measurement showed a deeper
cause: with Sogou in WebView2 the page receives **no keydown at all** for keys the IME takes (not even 229)
and no composition events, only key-ups and one `input` at commit. After a 1.6 s hold (24 repeats) and
"nihao" + space the entry held "一样一样一月又一月呀呀…你好". The low-level keyboard hook does not see those
keys either (it counted 4 of ~42 key events in that minute), so swallowing the repeats in the hook, tried
first, changed nothing ("呀" ×24 + "你好").

## Requirements

- While the key that opened chat is still down, the chat entry is `readOnly`: Chromium runs no IME for it,
  so the repeats arrive as ordinary `repeat` key-downs that `ChatInput` already drops.
- The entry becomes editable as soon as the key is up, from either signal: the page's own key-up of the
  opening key, or the new command `wait_chat_key_release(team)` resolving. Rust polls `GetAsyncKeyState`
  every 20 ms (at most 30 s), because a quick tap's release reaches the game before the overlay has focus.
- Each open has its own hold, so a late resolve from an earlier open cannot unlock a newer one.
- The keyboard hook still never swallows keys.

## Acceptance Criteria

- [x] Hold Y 1.6 s (24 repeats) with Sogou active, then type "nihao" + space: the draft is exactly "你好".
- [x] A 40 ms tap of Y opens chat, the entry is read-only for ~58 ms, then "nihao" + space gives "你好".
- [x] `npm run lint`, `npm test`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -D warnings`
      pass; the command is in `app-commands.rs`, the handler and the overlay capability (ACL test).

## Notes

- Tests ran with synthesized input (`SendInput`) against a debug SLUI; the IME and WebView2 are the real ones.
- The same run captured the world blur behind the radar (item 2's `mem::take` render path): the radar shows
  the stand-in's checkerboard blurred (mean gradient 1.1 inside vs 5.0 outside), no `frame failed` diagnostics.
