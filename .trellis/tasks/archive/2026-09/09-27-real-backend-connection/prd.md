# Connect SLUI to the real SLGO backend

## Goal

SLUI can resolve a route from the real SLGO control plane and hold a live
sidecar WebSocket session, using the identity model the owner decided on
2026-09-27 (slgo-backend `docs/decisions.md`, "Identity = claimed SteamID + IP
binding at the sidecar"). The mocks stay the default.

## Background

- Protocol commit `fd144ea` added `SessionOpen`, `SIDECAR_CLOSE_CODES`,
  `RouteRequest`, `RouteRejected` and README sections "Control-plane route
  request", "Sidecar session handshake" and "Security boundary".
- The client claims a SteamID (`local-steamid`). The control plane routes it
  without verification. The sidecar admits the session only if the WebSocket
  source address equals the player's game-connection address, and closes it
  with 4001 when the player leaves or their address changes. No pairing codes.

## Requirements

1. **Identity gate follows the sidecar.** `canOpenPlayerScopedStream`
   (packages/protocol), `MockSidecarConnection.connect/send`,
   `canUsePlayerScopedFeatures` / `VerificationState` and
   `scripts/contract-smoke.mjs` allow `local-steamid` sessions. The other
   identity modes stay in the types as reserved stronger proofs.
2. **Real control-plane client** implementing `SlgoControlPlane`:
   `POST {controlPlaneUrl}/v0/route` with
   `{protocol_version:0, type:"control.route.request", steam_id, proof:{kind:"local-steamid"}}`.
   - 200 → `parseRoute` (the route's SteamID must equal the requester's).
   - 400/401/404/429 → `parseRouteRejected`, mapped to `ParseErrorCode` and
     `ConnectionStatus`. `not-in-game` and `rate-limited` are retryable
     offline states with backoff.
   - Network failure / unexpected status → retryable offline state.
3. **Real WebSocket `SlgoConnection`**:
   - Connects to `route.sidecarEndpoint`; first frame is `session.open` with
     the session token and `minimap_schema_versions: [2]`, sent immediately on
     open (well within the sidecar's 5 s limit). The token never appears in
     the URL.
   - Receives baseline, replayed snapshots and live events; sends commands as
     bare v0 command frames, only after the baseline.
   - Reuses the mock's validation path (route/instance check,
     `EventSequenceGuard`, minimap diagnostics, viewer binding) through a
     shared intake helper, not a copy.
   - Close codes: 4000/4002 → `incompatible`; 4001 → `unauthorized` with a
     hint that SLUI must run on the same PC / network connection as the game;
     4003 → re-resolve the route. Other closes → offline with backoff.
4. **Configuration**: the real clients are used only when
   `VITE_CONTROL_PLANE_URL` is set; otherwise the mocks run exactly as today.
   Mock-only debug surfaces (HUD/shop/minimap debug panels, mock player meta)
   never overlay real data.
5. **Local end-to-end** against `slgo-backend` dev servers (control plane
   :7800, sidecar :7801, fake plugin). The sidecar is plain `ws://` in dev;
   SLUI uses a clearly dev-only, loopback-only endpoint override
   (`VITE_DEV_SIDECAR_ENDPOINT`), documented in the README. No backend code is
   copied into slui (GPL client / MIT protocol / closed backend).

## Acceptance criteria

- [x] `canOpenPlayerScopedStream({identityMode:"local-steamid"})` is `true`;
      protocol README "Security boundary" no longer says it is pending.
- [x] Mock connection connects and sends commands with a `local-steamid`
      route; contract smoke asserts it.
- [x] `HttpControlPlane` unit tests (fake fetch): request body/URL/method,
      200 success, SteamID mismatch, each rejection reason → code/status/retry,
      malformed body, network error, 5xx.
- [x] `WebSocketSidecarConnection` unit tests (fake WebSocket): URL has no
      token, first frame is a valid `session.open`, connect resolves on
      baseline, events/diagnostics flow through the shared intake, send before
      live is refused and after live writes a bare command frame, each close
      code maps to the required status/detail/retry, handshake timeout,
      unreachable endpoint, local disconnect does not report a failure.
- [x] Session layer retries `not-in-game`/`rate-limited`/lost connections with
      exponential backoff, re-resolves immediately-ish on 4003, never loops
      without backoff, and never auto-retries `incompatible`.
- [x] With `VITE_CONTROL_PLANE_URL` unset the app is unchanged (mock preview
      renders, all existing smoke tests pass).
- [x] `npm run lint`, `npm test` (under Node), `npm run build` pass.
- [x] Local E2E against the dev backend reaches `live` and renders plugin
      fixture data; a chat/shop command gets a `command.result`.

## Verification notes (2026-09-27)

- Browser preview (`npm run dev:backend`) against the slgo-backend dev servers:
  route 200, `client 76561198000000100 opened slgo-local-7777/...`, home shows
  已连接, HUD/radar/shop render plugin fixture data.
- Commands via the real adapters from Node: purchase and chat each got
  `command.result: accepted`, chat echoed as `chat.message`; an unknown player
  got `not-in-game`.
- Stopping the fake plugin: session ended, SLUI showed 未连接 with the
  not-in-game reason and retried with growing delays; restarting the plugin
  reconnected to the new instance automatically.
- Known integration gap: the fake plugin publishes `shop.snapshot` once, so the
  shop turns stale after 5 s and purchase buttons disable. The real plugin must
  republish the shop snapshot while the buy window is open.
