# HUD data channel: round result and HUD messages over IPC

Parent: `10-05-cs2-hud-panels` (requirements R1, R5; AC1, AC6). Wire design:
parent `design.md` sections 2-4.

## Goal

Carry the plugin's message-zone state (`HudMessageBoard`) and win-panel
results (`RoundResultModel`) to SLUI as validated, viewer-scoped protocol
events, so the three renderer children can consume them.

## Requirements

- D1 `@slgo/protocol`: event types `hud.messages` and `round.result` with
  strict parsers, JSON schemas and examples under `packages/protocol/v0`,
  `parseEvent` dispatch, `CLIENT_FEATURE_HUD_MESSAGES` / `CLIENT_FEATURE_WIN_PANEL`
  constants (not yet added to `OVERLAY_CLIENT_FEATURES`; the renderer children
  do that).
- D2 slgo-backend: IPC v1 publish enum + examples + invalid fixtures; both
  types cached and replayed as snapshots (`hud.messages` single recipient);
  replayed `*_remaining_ms` reduced by cache age (clamped at 0); README event
  table and feature list updated.
- D3 SLGO plugin: publisher for both events per parent design section 3 —
  resolved text without rich text, `{time_remaining}` kept as token,
  viewer-variant titles, structural changes immediate, time-only re-sync
  <= 1/s per player, `panel: null` on early end, handshake resync, self-check
  equivalent to the parsers, audience fail-closed.
- D4 SLUI mock provider emits both events for every captured state (used by
  the renderer children's previews and audits).

## Acceptance Criteria

- [ ] `npm test` contract smoke: valid examples parse; invalid inputs rejected
      (unknown field, bad tone, token without countdown, countdown without
      token, progress remaining > total, non-integer ms, empty text, overlong
      text, bad outcome, mvp with empty name).
- [ ] backend `bun test`: fixtures parse, single-recipient enforced for
      `hud.messages`, cache replay with age-adjusted remaining times.
- [ ] plugin `dotnet test`: DTO/validator parity with the backend fixtures,
      title variants (NTF won / SCP won / lost / observer / draw), structural vs
      time-only publish throttling, `panel: null` on round restart, no rich-text
      tags on the wire.
- [ ] Specs: slui `system-boundaries.md`, backend `protocol/ipc/README.md`,
      plugin `sidecar-ipc.md` + `hud-semantic-model.md` (SLUI takeover section).

## Out of Scope

Rendering (sibling children), `hud-money`, fun facts.
