# Implement — real backend connection

## Checklist

1. Protocol: `canOpenPlayerScopedStream`, `ParseErrorCode` additions,
   `SIDECAR_CLOSE_CODES.unauthorized` comment, README Security boundary.
2. Contracts: `VerificationState.claimed`, `canUsePlayerScopedFeatures`,
   `ConnectionFailure`.
3. `src/platform/identity.ts`: `getVerificationState` returns `claimed` for a
   local-steamid proof.
4. `src/platform/sidecarIntake.ts`: extract intake + `admitRoute` from the
   mock; rewrite `MockSidecarConnection` on top of it (drop the local-steamid
   refusals). Run `npm test` — mock behaviour must be byte-for-byte unchanged
   apart from the intended flips.
5. `SlgoConnection.subscribeFailure`; `WebSocketSidecarConnection` +
   `SidecarConnectionError` in `src/platform/connection.ts`.
6. `HttpControlPlane`, `toWireProof`, rejection mapping in `src/platform/route.ts`.
7. `src/platform/backend.ts` `readBackendConfig`.
8. Session: `retry` in reducer state, `retryForRouteError`, `retryDelayMs`,
   failure counter; `runClientSessionAttempt` catches control-plane throws,
   handles `SidecarConnectionError`, subscribes to failures;
   `useClientSession` schedules retries.
9. `App.tsx` composition; `vite-env.d.ts`; `.env.backend`; `dev:backend`
   script; README "Real backend (local)" section.
10. Tests: update `contract-smoke.mjs` (local-steamid flips); new
    `scripts/backend-connection-smoke.mjs` (fake fetch + fake WebSocket +
    config + retry policy), added to `npm test`.
11. Spec: system-boundaries (identity bullets, validation matrix, tests),
    quality-guidelines (authorization gate), directory-structure if needed.

## Validation

```bash
npm run lint
npm test          # Node, not Bun
npm run build
```

Local E2E (slgo-backend: `.env` from example, `dev:control-plane`,
`dev:sidecar`, `dev:fake-plugin`), then slui `npm run dev:backend` in the
browser preview: status reaches live, HUD/shop show fixture data, a purchase
gets a `command.result`. Also verify a close (stop the fake plugin → 4003 /
reroute → not-in-game backoff).

Mock preview (`slui-mock` launch config): no console errors, HUD/minimap render.

## Risk points

- Intake extraction must keep every mock edge case (terminal status sticks,
  late input after disconnect, stale-sequence does not disturb status).
- Retry loops: verify backoff grows and resets only after stable live time.
- `import.meta.env` must not be read inside testable modules (config is a
  pure function of an env record).
