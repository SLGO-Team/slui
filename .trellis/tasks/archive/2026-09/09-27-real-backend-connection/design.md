# Design — real backend connection

## Boundaries

| Layer | File | Change |
|---|---|---|
| protocol (MIT) | `packages/protocol/src/index.ts` | `canOpenPlayerScopedStream` accepts every known mode; `ParseErrorCode` gains `not-in-game`, `rate-limited` |
| protocol docs | `packages/protocol/v0/README.md` | Security boundary: client consequence is now in effect; 4001 note |
| client contracts | `src/contracts/index.ts` | `VerificationState` gains `claimed` (local-steamid, sidecar-authorized); `ConnectionFailure` type |
| platform | `src/platform/sidecarIntake.ts` (new) | Shared intake extracted from `MockSidecarConnection` |
| platform | `src/platform/connection.ts` | Mock uses the intake; new `WebSocketSidecarConnection` |
| platform | `src/platform/route.ts` | New `HttpControlPlane`, wire-proof mapping, rejection mapping |
| platform | `src/platform/backend.ts` (new) | `readBackendConfig(env)` — mock vs real, URL validation, dev override |
| app | `src/app/clientSession.ts`, `useClientSession.ts` | Retry hint in state; backoff scheduling |
| composition | `src/App.tsx` | Picks mock or real from config; debug surfaces mock-only |

No backend code is copied. The backend's behaviour is known only from the
protocol README and its public docs.

## Contracts

### Identity gate

`canOpenPlayerScopedStream(route)` returns `true` for every `IdentityMode`
value (runtime check against the known list, so an unknown string is still
refused). The sidecar is the authority. `VerificationState`:

```ts
| { kind: "unverified"; identity }                         // no usable proof
| { kind: "claimed"; identity; mode: "local-steamid" }     // sidecar authorizes by IP binding
| { kind: "verified"; identity; mode: Exclude<IdentityMode, "local-steamid"> } // reserved
```

`canUsePlayerScopedFeatures` → `claimed` or `verified`.

### Shared intake (`SidecarEventIntake`)

Owns: status + status/event/diagnostic listener sets, `EventSequenceGuard`,
the active route, and `receive(raw)` — the mock's current logic verbatim
(route/instance check, baseline-before-sequence validation, sequence
consumption, minimap diagnostics, viewer binding, `rejectGlobal`).

API: `subscribe*`, `getStatus`, `setStatus`, `route`, `begin(route)`
(reset guard, status `baseline-required`), `end(status)` (clear route +
guard), `receive(raw)`. Optional `onGlobalReject(code)` callback lets the
real connection close a stream that can no longer recover (a real sidecar
never sends a second baseline on the same socket).

`admitRoute(route, identity, now)` is shared: expired → `stale`; SteamID
mismatch / `!canOpenPlayerScopedStream` → `unauthorized`.

### Failures and retry

```ts
type ConnectionFailure = {
  status: "offline" | "stale" | "unauthorized" | "incompatible";
  detail: string;
  retry: "reroute" | "backoff" | "none";
};
```

- `WebSocketSidecarConnection.connect` rejects with `SidecarConnectionError`
  (carries a `ConnectionFailure`) when the session never reaches the first
  accepted baseline.
- After connect resolved, a remote close is reported through the new
  `SlgoConnection.subscribeFailure(listener)`; the status listeners fire first.
  A local `disconnect()` never reports a failure. The mock never reports one.
- `runClientSessionAttempt` dispatches `failed` with `retry`. Route errors use
  `retryForRouteError(code)`: `not-in-game`/`rate-limited` → backoff,
  `expired-route` → reroute, others → none. Control-plane exceptions (network,
  5xx) → offline + backoff.
- `useClientSession` schedules the retry: `retryDelayMs(retry, failures)`;
  reroute 1 s · 2^(n-1), backoff 3 s · 2^(n-1), both capped at 60 s. The
  failure counter resets only if the session had been live for ≥ 60 s before
  the failure, so a sidecar that keeps replaying a bad snapshot cannot cause a
  1 s reconnect loop.

Close code mapping (`SIDECAR_CLOSE_CODES`):

| Close | Status | Retry | Detail |
|---|---|---|---|
| 4000 invalidHandshake | incompatible | none | sidecar reason |
| 4002 unsupportedProtocol | incompatible | none | sidecar reason |
| 4001 unauthorized | unauthorized | backoff | hint: run SLUI on the same PC / network connection as the game |
| 4003 instanceUnavailable | stale | reroute | server restarted |
| other (1000/1001/1006…) | offline | backoff | connection lost / unreachable |
| no open within 10 s | offline | backoff | unreachable |
| no baseline within 10 s of open | offline | backoff | no baseline |
| intake global reject (terminal) | incompatible/unauthorized | none | parse error |
| intake global reject (other) | stale | reroute | stream invalid |

4001 retries with backoff because its most common causes (routed to a server
the player just left, roster not yet updated) resolve by themselves; the hint
stays visible meanwhile.

### Control plane (`HttpControlPlane`)

`POST {base}/v0/route`, `content-type: application/json`, 10 s timeout via
`AbortController`. Body built from `SteamIdentityProof` by `toWireProof`
(camelCase → snake_case) and typed as `RouteRequest`. Response mapping:

| HTTP | Result |
|---|---|
| 200 | `parseRoute(body, now)`; route `steamId` ≠ requester → `invalid-route` |
| 400/401/404/429 | `parseRouteRejected`; reason → code: `invalid-request`→`invalid-route`, `unsupported-protocol`→`unsupported-protocol`, `unauthorized`→`unauthorized`, `not-in-game`→`not-in-game`, `rate-limited`→`rate-limited` |
| other / fetch throws / timeout | throws `Error` → session: offline + backoff |

`statusForRouteError`: `not-in-game`, `rate-limited` → `offline` (default).

### WebSocket connection

- `createSocket(url)` injectable (`WebSocketLike`: `readyState`, `send`,
  `close`, `onopen/onmessage/onclose/onerror`). Default `new WebSocket(url)`.
- URL = `endpointOverride ?? route.sidecarEndpoint`; the token goes only in
  `session.open`.
- Handlers are detached before a local close, so stale sockets cannot touch
  the intake. An attempt counter guards overlapping `connect` calls.
- `send` requires status `live`, validates with `parseCommand`, writes
  `JSON.stringify(command)`.

### Configuration (`readBackendConfig`)

Input: `{ DEV, VITE_CONTROL_PLANE_URL, VITE_DEV_SIDECAR_ENDPOINT }`.

- URL unset/blank → `{ kind: "mock" }`.
- Control-plane URL must be `https://`, or `http://` on a loopback host.
- `VITE_DEV_SIDECAR_ENDPOINT` is honoured only when `DEV` and only for a
  `ws://`/`wss://` URL on a loopback host; otherwise ignored with a console
  warning. It exists because the dev sidecar serves plain `ws://`, while the
  route says `wss://localhost:7801/...` (and `localhost` may resolve to `::1`,
  failing IPv4 IP binding). Chosen over a local TLS cert because trusting a
  self-signed cert in WebView2/browsers needs a system root-CA install.
- Invalid config throws at startup (a real build must never silently fall
  back to mocks).

`npm run dev:backend` = `vite --mode backend` with a committed `.env.backend`
(dev placeholders only, like `.env.mock`).

## Compatibility

- `SlgoConnection` gains `subscribeFailure`; both implementations provide it.
  `RealtimeMockProvider` inherits it.
- `ParseErrorCode` widening is additive; slgo-backend does not switch on it.
- Mock behaviour and every existing smoke assertion stay unchanged except the
  intended local-steamid flips.

## Rollback

Unset `VITE_CONTROL_PLANE_URL` → mocks. Code rollback = revert the task
commit(s); the protocol change is additive.
