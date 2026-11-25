# Protocol contracts: schemas, parsers and examples checked together

Source: item 6 of the 2026-11-25 cloud review follow-ups.

## Requirements and results

1. New `scripts/protocol-schema-check.mjs` (in `npm test`) keeps `packages/protocol/v0/*.schema.json`, the TS
   parsers and the examples in step: Ajv 2020 strict about keywords and formats (`ajv` + `ajv-formats`, dev
   dependencies at slgo-backend's ranges); every example accepted by its schema(s) and its parser; every schema
   used; schema and parser agree on each example with each top-level field removed and with an unknown field
   added (payload and envelope). Intended differences are listed with reasons (`KNOWN_DIFFERENCES`).
   It found, and this task fixes:
   - `hud-spectating.schema.json` and `update-manifest.schema.json` were not valid JSON (`"\S"`, `"\."` in
     patterns); no tool could read them.
   - `envelope.schema.json` required `sent_at` only for minimap, `hud.messages` and `round.result`; the parser
     (and README) also require it for `match.snapshot`, `hud.killfeed`, `scoreboard.snapshot`,
     `instance.ended` and `replay.state`.
   - Parsers for `match.snapshot`, `shop.snapshot`, `command.result`, commands and the control-plane route
     messages accept unknown top-level fields where the schemas forbid them. Kept on purpose (additive optional
     fields reach older clients, README "Match snapshot top-HUD fields" / shop sections) and listed.
2. `contract-smoke` parses every v0 example through a shared mapping (`scripts/protocol-examples.mjs`); command,
   control-route, route-request, route-rejected and shop-snapshot were loaded by no test before.
3. `event-routing-smoke` fails when a protocol event type has no consumer. Chat's event mapping became the
   pure `chatActionForEvent` with `CHAT_EVENT_TYPES`; the minimap filters by `MINIMAP_EVENT_TYPES`; the
   connection lists `CONNECTION_EVENT_TYPES`.
4. `src/mocks/replayMock.ts`: the omniscient `match.snapshot` drops `mode_family` and `player_limit` (demo
   replay sends neither).
5. `parseMatchSnapshot` refuses a negative team score (schema already had `minimum: 0`).
6. `src/platform/connection.ts`: the `minimap_schema_versions` comment names v8.

## Acceptance Criteria

- [x] `npm run lint`, `npm test`, `npm run audit` pass.
- [x] Removing a consumer's type makes `event-routing-smoke` fail with the unread type named.

## Notes

- slgo-backend validates its own `protocol/ipc/v1` schemas, not these, so the schema fixes need no backend change.
