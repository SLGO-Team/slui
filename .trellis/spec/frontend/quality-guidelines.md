# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

The overlay must remain usable when the Backend, game server, or browser
preview is unavailable. The UI therefore treats connection state and stale
data as explicit states rather than silently falling back to misleading live
values.

---

## Forbidden Patterns

- Do not put Steam secrets, Backend credentials, or authoritative purchase
  logic in React or Tauri frontend code.
- Do not call Tauri commands, raw WebSocket methods, or protocol parsing from
  leaf components. Use a platform adapter or feature hook.
- Do not treat fixture data as production state. Mock providers must be
  replaceable without changing feature rendering code.
- Do not silently swallow connection or command errors with an empty catch.
  Expose a recoverable status to the UI and log enough context to diagnose it.
- Do not use game-process injection or memory reads as an implicit data source.
  The target game's supported data channel must be documented before a real
  minimap provider is implemented.

---

## Required Patterns

- Every server-driven feature must define a typed contract and a mock fixture
  before it is connected to a real Backend.
- Commands that can be retried (purchase, chat send, or similar actions) must
  carry a client-generated command id and render pending, success, and failure
  states.
- Match state must identify its source instance and freshness. A game-server
  restart or Backend reconnect must not be presented as a continuous live
  round without a new snapshot.
- Passive overlay mode must remain click-through and must not steal game
  focus. Interactive mode is never a user toggle: the overlay derives it from
  the UI on screen (the shop, chat) and returns to passive when that
  UI closes. A UI may only open on an explicit player action (its hotkey),
  never because plugin data such as `window_open` arrived.
- A presentation clock (`setInterval` that dispatches or sets state) runs only
  while something on screen actually depends on time. Feature hooks live in
  `App`, so every tick re-renders the whole overlay; the minimap's 32 ms clock
  runs only while a position frame (`frame` / `pendingFrame`) exists.
- The overlay runs for hours. React 19's development build records a
  `performance.measure` with a props diff (~1 KB native memory) for every
  re-render with changed props, and the User Timing buffer never evicts them;
  `main.tsx` clears measures periodically in DEV. Do not add code that relies on
  User Timing entries persisting.

---

## Testing Requirements

- Pure reducers, selectors, formatters, and command validation require unit
  tests.
- Protocol parsing requires good, base, and malformed fixture cases.
- Each interactive feature requires at least one test for disconnected or
  stale data, plus its primary success path.
- Tauri window behavior requires a Windows smoke check for click-through,
  global hotkey switching, foreground-window tracking, and high-DPI sizing.

---

## Code Review Checklist

- Is the change in the correct feature or platform boundary?
- Can the feature run against the mock provider without special branches in
  its components?
- Are stale, disconnected, unauthorized, and command-failure states visible?
- Are protocol changes versioned and covered by fixtures?
- Does the change preserve passive-mode input behavior and avoid introducing
  game-process coupling?

## CI and Release Contracts

Process rules (branches, PR titles, release steps) live in `CONTRIBUTING.md`;
these are the code-level contracts behind them.

- **Versions are owned by release-please.** `release-please-config.json` lists
  every file that carries the SLUI version besides `package.json` /
  `package-lock.json`; `scripts/version-check.mjs` (in `npm test`) lists the
  same set and is the authority that they agree. Adding a file that carries the
  version means adding it to both. Never bump versions by hand.
- **Cargo.lock JSONPath needs `.value`.** release-please's TOML parser wraps
  every scalar as `{ value, start, end }`, so a lockfile entry is selected with
  `$.package[?(@.name.value==='slui')].version`, not `@.name==='slui'`.
- **Production builds need a URL at build time.** `vite.config.ts` refuses a
  non-mock build without `VITE_CONTROL_PLANE_URL`, so CI's build check sets the
  placeholder `https://control-plane.invalid`. The real URL exists only as the
  `CONTROL_PLANE_URL` secret of the `release` environment (main only) — never an
  Actions variable (variables are printed in step logs) and never a file.
- **Theme packs enter installers only via `build-installer.mjs --theme-pack
  <dir>`**, which passes the resource mapping as inline `--config` JSON, writes
  `SLUI-Setup-<version>-theme-pack.exe`, and renames its NSIS payload so a later
  `--reuse-payload` cannot pick it up. Do not reintroduce a checked-in Tauri
  config or a repo-local pack directory for this.

## Client Foundation Contracts

The browser layer consumes typed adapters from `src/platform` and deterministic
fixtures from `src/mocks`. Contract parsing owns protocol and visibility
validation before an event reaches a feature store.

### Windows Steam discovery

The Tauri command `get_current_steam_identity` reads the current user's Steam
`ActiveUser` registry value and converts the 32-bit account id to a 17-digit
SteamID64. It returns `null` when Steam is unavailable. Browser preview uses
`VITE_STEAM_ID` only as a development fallback.

### Required smoke coverage

`npm test` runs `scripts/contract-smoke.mjs` without an additional test
framework. The smoke assertions must cover a valid envelope, unknown schema,
invalid JSON, stale sequence, new-instance baseline, route expiry shape,
the identity gate (local-steamid accepted, unknown modes refused), and invalid
minimap visibility. `scripts/backend-connection-smoke.mjs` covers the real
adapters with a fake `fetch` and a fake WebSocket: request shape, every
rejection reason, handshake frame, close codes, timeouts, backend config and
the retry policy.

### Authorization gate

The sidecar is the authorization boundary (IP binding, see
[System Boundaries](./system-boundaries.md)). The client does not gate
player-scoped data or commands by identity mode: `canOpenPlayerScopedStream`
accepts every known `IdentityMode` (including `local-steamid`) and refuses
unknown strings. Adapters still refuse a route that is expired or whose SteamID
differs from the local identity (`admitRoute`), and never send a command before
the stream is `live` (a pre-baseline frame makes the sidecar close with 4000).

### Sidecar adapters share one intake

`MockSidecarConnection` and `WebSocketSidecarConnection` both feed frames
through `SidecarEventIntake` (`src/platform/sidecarIntake.ts`): route/instance
check, baseline-before-sequence validation, sequence consumption, minimap
diagnostics, viewer binding and status. Do not copy that logic into a new
adapter; compose the intake. The real adapter closes the socket on any
stream-level rejection, because a real sidecar never sends a second baseline on
one socket.

### Test-loadable platform modules

Modules imported by the `node --experimental-strip-types` smoke scripts must use
explicit `.ts` extensions for value imports and must not use TypeScript-only
runtime syntax such as constructor parameter properties.

## Home Window Motion

The home window (`src/app/home/`) animates the UI switch hero. The rules below
keep that motion correct and cheap.

### Convention: one-shot effects follow the user's action, not the state

Colour changes are CSS transitions, so they cover every way the state can
change (initial load, the tray, the button). One-shot keyframe effects (the
scan line and the core ping) are elements mounted under a counter key, and the
counter only advances when the state change matches what the button requested:

```tsx
const requested = useRef<boolean | null>(null);
const [pulse, setPulse] = useState(0);
useEffect(() => {
  if (requested.current !== state.enabled) return;
  requested.current = null;
  if (state.enabled) setPulse((count) => count + 1);
}, [state.enabled]);
// render: {pulse ? <div key={pulse} className="home-hero__scan" /> : null}
```

Do not start keyframes from a selector such as `[data-enabled="true"] .x {
animation: ... }`: it also plays when home opens with the UI already enabled.
Staggered delays go on the target-state selector, because a transition uses the
timing of the state it moves into. Colours used inside gradients must be
registered with `@property` (`--bracket`, `--grid-color`) to transition at all.
Use `animation-fill-mode: forwards`, not `both`, for delayed effects whose first
keyframe is visible, or they show their start frame during the delay. No JS
clocks; `prefers-reduced-motion` turns the one-shot effects off.

### Common Mistake: SVG transform origin with `transform-box: view-box`

**Symptom**: The hero crosshair ticks sat crooked, the range ring rotated out to
the top right, and the ping rings flew toward the top left.

**Cause**: The mark's `viewBox` is `-320 -320 640 640`. A `view-box` reference
box starts at the user-space origin, so `transform-origin: 50% 50%` is
(320, 320), the bottom-right corner, not the centre.

**Fix**: With a viewBox centred on (0, 0), use `transform-box: view-box;
transform-origin: 0 0`.

**Prevention**: When verifying SVG motion, compare element bounding-box centres
(`getBoundingClientRect`) against the mark's core at several points in the
timeline. Matching transform matrices proves nothing about the origin.
