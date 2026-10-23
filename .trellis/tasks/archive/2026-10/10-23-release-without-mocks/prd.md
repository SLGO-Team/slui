# Release builds without mock code

## Goal

A production build shipped the mock stream's data (chat history, HUD scenes), the debug panels' CSS
and the 0.9 MB preview backgrounds, because App imported `src/mocks` statically and decided
`MOCK_BACKEND` at runtime. Packages should carry none of it; the mock mode keeps working unchanged.

## Requirements

- `MOCK_BACKEND` is the build-time `import.meta.env.MODE === "mock"` (readBackendConfig returns
  `mock` exactly then; vite.config.ts never builds that mode).
- App takes every mock value from a `harness` prop: `src/mocks/harness.ts`, imported dynamically by
  `main.tsx` only in the mock mode. App imports types only from `src/mocks`.
- The preview backgrounds move from `public/assets/preview` to `src/mocks/preview`, referenced from
  the debug panel's stylesheet.
- A check in `npm test` fails on a value import from `src/mocks` outside it (except the two gated ones).

## Acceptance Criteria

- [x] Production build: no debug-panel CSS, mock scenes, mock chat history or preview images.
      App JS 268 → 183 KB, App CSS 68.7 → 66.0 KB, dist 24.29 → 23.28 MB.
- [x] Mock mode: both debug panels, preview background, radar and the mock stream work; no console
      errors.
- [x] `npm run lint`, `npm test` pass; chat, hud messages, bottom HUD and scoreboard audits pass;
      hud and winpanel audits fail exactly as on main (pre-existing).
- [x] `mock-boundary-check` catches a stray mock import (checked with a probe file).
