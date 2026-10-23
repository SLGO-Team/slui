# Design

Superseded. The spike design (game keeps the foreground; a raw-input sink registered with
`RIDEV_INPUTSINK` reads each real mouse delta and `SendInput` injects the opposite move, marked by
`dwExtraInfo` so its echo can be checked; buttons and the wheel swallowed by the existing
`WH_MOUSE_LL` hook; a virtual cursor dot in the overlay) was implemented, then withdrawn before any
in-game run because injected input is an anti-cheat risk. The server-driven alternative was judged
too inelegant. Rejection and rules: `.trellis/spec/frontend/system-boundaries.md`.
