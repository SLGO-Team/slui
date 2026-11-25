# Replay highlights: retry a jump the command budget held back

Source: item 5 of the 2026-11-25 cloud review follow-ups.

## Problem (confirmed on main)

`src/features/replay/useReplayHighlights.ts`: `jumpTo` ignored `send()` returning false (App's replay command
budget held the seek or pause back). The driver effect only re-runs when its inputs change (`current`,
`pendingSeekMs`, `pendingPlayback`, ...); a held-back command changes none of them, so no jump was tried again
and the shared playback ran on outside the highlights until something else moved it.

## Requirements

- `jumpTo` returns the send result.
- A held-back jump is retried once the budget has a token (`replayCommandWaitMs`, at least 100 ms); the retry
  re-runs the driver, which works the step out again from the position at that time.
- Highlight jumps stay inside the command budget (the sidecar would refuse them otherwise).
- The scheduling is a pure function (`runReplayHighlightStep`) covered by `replay-model-smoke`.

## Acceptance Criteria

- [x] Smoke: immediate success schedules nothing; held back schedules a retry at the budget wait (minimum
      100 ms); a step waits for the interval's end first; cancelling drops a pending jump or retry.
- [x] `npm run lint` and `npm test` pass.
