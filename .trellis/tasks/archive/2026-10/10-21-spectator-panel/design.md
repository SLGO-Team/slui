# Design: CS2 spectator panel

## 1. Boundaries

| Repo | Owns |
| --- | --- |
| `../SLGO` (plugin) | Who the viewer watches, whether they may, and the watched player's balance, held-item label, ammo and round kills. |
| `../slgo-backend` (sidecar) | Relaying the new publish event: one recipient, latest cached per recipient, replayed after the baseline. |
| `slui` `packages/protocol` | Wire contract: type, strict parser, JSON schema, README, example. |
| `slui` app | Picking the HUD subject (self or watched player), name / avatar / ADR from data it already has, drawing. |

Name, avatar and team come from `match.snapshot` (both teams' rosters are already there); ADR comes from
`scoreboard.snapshot`. The new event carries only what SLUI cannot know otherwise.

## 2. Contract: `hud.spectating` (feature `hud-spectating`)

A separate event, not new `hud.status` fields: `parseHudStatus` rejects unknown keys, so a richer
`hud.status` would blank the ammo of every player still on an older SLUI. Clients skip unknown event types
(v0 README "Compatibility"), and the plugin sends this one only to clients that declare the feature.

```json
{ "target": {
    "player_id": "76561198000000002",
    "money": 800,
    "item_name": "COM-15",
    "ammo": { "clip": 12, "clip_max": 12, "reserve": 36, "reserve_icon": "bullet" },
    "round_kills": ["default"] } }
```

- `target`: `null` when the viewer watches nobody they may see (alive, no target, target not authorized,
  target outside the match teams). Required key.
- `player_id`: the `match.snapshot` player id (SteamID64; test dummies have one too). Non-empty, at most 64.
- `money`: non-negative safe integer, the target's balance (`EconomyManager.GetPlayerBalance`).
- `item_name`: plugin-resolved label of what the target holds (D5), or `null` (empty hands). Non-blank, at
  most 64 characters.
- `ammo`, `round_kills`: exactly the `hud.status` shapes and limits, computed for the target.
- Every object rejects unknown fields. Snapshot, single recipient, no time fields (`sent_at` optional,
  replay unchanged), replay order right after `hud.status`.

`MAX_HUD_SPECTATING_TEXT_LENGTH = 64` joins the other limits. The parser reuses the `hud.status` ammo and kill
validation (one helper, not a copy).

## 3. Plugin (`SLGO/Features/Sidecar`)

- `SidecarHudSpectatingRules` (pure): target facts -> payload (ammo / kills through the same functions as
  `SidecarHudStatusRules.Build`, clamping included), full-field signature, wire self-check equivalent to
  slui `parseHudSpectating`.
- `SidecarHudSpectatingPublisher` (main thread, mirrors `SidecarHudStatusPublisher`): every pump frame, for
  each visible Steam player whose SLUI declares `hud-spectating`, resolve the target, compare raw inputs
  (`HudSpectatingInputs`: target id, money, item, firearm facts, kill list reference + count), build / sign /
  validate / send on change. `ResendAll` after `hello.accepted`, `ClearSession` on session end, audience
  pruning through `SidecarPublishRules.RemoveMissing`.
- Target resolution: viewer not alive, `viewer.Role is SpectatorRole` (Overwatch included),
  `SpectatedPlayer` connected, alive, sidecar-visible, with a SteamID64, and
  `MatchInformationPolicy.CanObservePlayer(viewerTeam, false, viewer.IsOverwatchEnabled, targetTeam, profile
  flags)` (the shared predicate, spec `match-information-isolation.md:94`). Anything else -> `target: null`.
- `item_name`: held item -> its shop name (`ShopItem.Name` by `ItemType`, from the shop catalog), else a
  short fallback table for items the shop does not sell (keycards, Micro-HID, ...), else the `ItemType`
  name. SCP target -> its role's shop name (`ShopItem.Name` by `RoleTypeId`, e.g. `SCP-939`), else the
  `RoleTypeId` name. Nothing held -> `null`.
- Constants `EVENT_HUD_SPECTATING`, `SLUI_FEATURE_HUD_SPECTATING`; DTOs in `Ipc/IpcPayloads.cs`; wiring in
  `SidecarIpcManager` next to `hudStatusPublisher`; `Features/Sidecar/CLAUDE.md` table rows.

## 4. Sidecar (`slgo-backend`)

`messages.ts`: add to `PUBLISH_EVENT_TYPES`, `SNAPSHOT_EVENT_TYPES`, `SINGLE_RECIPIENT_EVENT_TYPES`;
`hub.ts` `REPLAY_ORDER` after `hud.status`. `protocol/ipc/v1`: `publish.schema.json` event, examples
(watching / `target: null`), invalid fixtures (two recipients; semantic: unknown kill kind, negative money,
blank item name, unknown field), README section and the `hud-spectating` feature. The sidecar validates
payloads with `@slgo/protocol`, so it needs the slui protocol change first (its workspace links
`../slui/packages/protocol`).

Deployment order: sidecar before plugin (an unknown `event_type` is a rejected publish). SLUI may ship at
any time: without the plugin side it never receives the event and behaves as today.

## 5. SLUI

### State and selection (`src/features/bottomhud/model.ts`)

- `HudStatusState` gains `spectating: HudSpectatingSnapshot | null`; the same reducer, source and reset rules
  handle both events (one place for "inputs of the bottom HUD").
- `selectBottomHud(hud, status, spectating, scoreboard, localPlayerId)`:
  - local player alive on the viewer team -> today's view, `spectator: null`.
  - otherwise, `spectating.target` whose `player_id` is in either `match.snapshot` team -> view with that
    team's `role`, `balance = target.money`, `ammo`, `kills = target.round_kills`, and
    `spectator: { playerId, name, avatarUrl, adr, itemName }`. No viewer team needed (D2).
  - else null.
- ADR = `round(damage / rounds_played)` of the target's stats for the team's current role, 0 without
  rounds or without a scoreboard: the scoreboard's ADR rule (`scoreboard/presentation.ts:148,212`), moved to
  one exported helper both use.
- Avatar: `avatarSource` with the side default (`hud/presentation.ts:163`).

### Rendering (`BottomHud.tsx` / `.css`)

- `BottomHudRow` is keyed by the subject (self or target id): a target switch remounts, so the new
  player's kill cards and balance appear without a burst or a roll (CS2 jumps too).
- With `spectator`: `data-spectating`; strokes hidden (`.HUD--spectating-target .hud-HA__stroke`); a
  460 x 72 panel centred under the row (x 730-1190 at 1080p, radius 5, `hud-blur-bg-color` fill, world blur
  through `useBackdropRef`, 2px washed side bars); avatar (57px circle) in place of the emblem inside the
  ring; left block (padding 14, width 190): empty clan line (D4), name 20px washed, `伤/局` + ADR 13px;
  right block (padding 14, width 190): item label 18px right-aligned. Balance and ammo stay where they are,
  outside the panel. Final sizes, colours and baselines are measured on the reference capture (spec
  `cs2-visual-replication.md`), not taken from these Panorama numbers alone.
- Kill cards and particles unchanged; they show the target's kills.

### Debug and tests

- HUD debug scenes `bottom-spectating` (teammate) and `bottom-spectating-enemy` (opponent colours); the mock
  provider emits `hud.spectating`. `bottom-dead` keeps meaning "dead, watching nobody".
- `contract-smoke`: parser accepts the example, rejects unknown fields, bad money, blank / long label, bad
  ammo / kills. `bottomhud-model-smoke`: alive, dead + teammate, dead + opponent, team-less observer, target
  not in roster, `target: null`, ADR rule.

## 6. Compatibility and rollback

Old SLUI + new plugin: no feature, no event. New SLUI + old plugin: no event, panel never shows (today's
behaviour). Rollback = revert per repo; nothing persistent changes.

## 7. Spec updates (Phase 3.3)

- slui `system-boundaries.md`: the `hud.spectating` boundary and the subject rule.
- slui `cs2-visual-replication.md` §13: replace "no spectator panel" with the panel's rules and measurements.
- SLGO `Features/Sidecar/CLAUDE.md`: new publisher and rules rows.
