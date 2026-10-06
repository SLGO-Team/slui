# Design: CS2 HUD panels

Cross-cutting design shared by the four child tasks. Child `design.md` files
only add component-level detail.

## 1. Data flow

```text
HudMessageBoard.Changed / ShowRoundResult          (plugin, main thread)
  -> SidecarHudPublisher builds viewer DTOs        (plugin, Features/Sidecar)
  -> IPC v1 publish (hud.messages | round.result)  (loopback)
  -> sidecar: parseEvent(@slgo/protocol), audience routing, snapshot cache
  -> SLUI: parseEvent -> feature reducer -> selector(nowMs) -> React
```

- `@slgo/protocol` (MIT, `slui/packages/protocol`) is the single wire
  contract: the sidecar validates every plugin publish with `parseEvent`, so
  the new types and parsers land there first, then backend, then plugin.
- Repos and order: slui protocol package -> slgo-backend (IPC v1 schema,
  fixtures, `PUBLISH_EVENT_TYPES`, cache classification) -> SLGO plugin
  (publisher + self-check equivalent to the parser) -> slui renderers.

## 2. Wire events (protocol v0, envelope schema 1)

Both are new event types; old clients skip them (`unsupported-event-type`),
so no `session.open` negotiation is needed. All times are **remaining
milliseconds at `sent_at`**, interpolated with the local receive time only
(never compare server and local clocks).

### 2.1 `hud.messages` — per-player message-zone snapshot

Snapshot type (latest per recipient cached and replayed), exactly one
recipient per publish (the board is per player).

```ts
type HudTone = "default" | "success" | "warning" | "info" | "gold"
  | "match_point" | "final_round" | "ntf_team" | "scp_team";

type HudSlotMessage = {
  /** Plugin board sequence; changes on every write, including countdown rewrites. */
  message_id: string;
  /** Catalog key (CS2 localisation key or SLGO_*); style hook only, never shown. */
  key: string;
  /** Plugin-resolved plain text; may contain the literal token {time_remaining}. */
  text: string;
  tone: HudTone;
  /** Time until the message expires on its own; null = until replaced/cleared. */
  visible_remaining_ms: number | null;
  /** Value for {time_remaining}; required iff text contains the token. */
  countdown_remaining_ms: number | null;
};

type HudProgressMessage = HudSlotMessage & {
  progress: { remaining_ms: number; total_ms: number };
};

type HudMessagesSnapshot = {
  progress: HudProgressMessage | null;
  alert: HudSlotMessage | null;
  hint_high: HudSlotMessage | null;
  hint_low: HudSlotMessage | null;
};
```

Validation (parser, mirrored by the plugin self-check): text non-empty and
<= 256 chars, key `^[A-Za-z0-9_]{1,96}$`, tone in the enum, finite
non-negative integers, `0 <= remaining_ms <= total_ms`, `total_ms > 0`,
`countdown_remaining_ms` present iff `{time_remaining}` occurs in text,
no unknown fields.

### 2.2 `round.result` — win panel

Snapshot type, cached per recipient. Published to every online player
(participants and observers) in up to three audience variants (NTF
participants, SCP participants, everyone else) because the title is
viewer-relative (R1).

```ts
type RoundResultSnapshot = {
  panel: null | {
    result_id: string;               // one per ShowRoundResult call
    winner_team: "ntf" | "scp" | null; // null = draw (match end only)
    is_match_end: boolean;
    title: { text: string; outcome: "won" | "lost" | "draw" | "observer" };
    subtitle_text: string | null;    // end reason today, fun fact later (R4)
    mvp: null | {
      player_id: string;             // SteamID64, avatar resolved from match.snapshot
      display_name: string;
      reason_text: string;           // e.g. 最多击杀MVP（3杀）
      music_kit_name: string | null;
    };
    visible_remaining_ms: number;    // HoldDuration remaining at sent_at
  };
};
```

The plugin publishes `panel: null` when the panel ends early (new round,
match restart); the client also hides it locally when
`visible_remaining_ms` runs out, so a lost null frame cannot pin it.

### 2.3 Feature names

`CLIENT_FEATURE_HUD_MESSAGES = "hud-messages"` and
`CLIENT_FEATURE_WIN_PANEL = "win-panel"` join the protocol package and the
backend README feature list (plugin names already reserved). `hud-money`
is not added.

## 3. Plugin publisher (SLGO)

- New `Features/Sidecar/SidecarHudPublisher` (or rules + manager split per
  `sidecar-ipc.md`): subscribes to `HudMessageBoard.Changed` and to the
  round-result entry point (`UIManager.ShowRoundResult`), never renders.
- Per-player `hud.messages` publish on structural change (slot presence,
  key, text, tone). Countdown and progress rewrites only re-sync time: at most
  one publish per player per second for time-only changes, and immediately on
  any structural change. Expiry is driven by the board's own `Tick` clearing.
- Text = `HudMessageCatalog.Format` with every parameter resolved except
  `{time_remaining}`; rich-text tags never appear on the wire.
- `round.result` built from `RoundResultModel` + `HudMessageRules.ResultTitleFor`
  per audience variant, MVP fields from `RoundMvpModel`, hold time from
  `UIConstants.RoundResultAnim.HoldDuration`.
- Audience fail-closed rules from `sidecar-ipc.md` apply; DTO constructors
  validate; a validator equivalent to the protocol parser runs before enqueue.
- Re-sent after handshake (`PumpOnce` full resync) like other snapshots.
- `SluiPresence` hiding already exists for both feature names; no change.

## 4. Sidecar (slgo-backend)

- Add both types to `PUBLISH_EVENT_TYPES` and `SNAPSHOT_EVENT_TYPES`;
  `hud.messages` also to `SINGLE_RECIPIENT_EVENT_TYPES`.
- IPC v1 schema enum + example fixtures + `invalid/` fixtures; README event
  table and feature list.
- No new routing logic: existing audience delivery and per-recipient cache
  replay cover both. A replayed snapshot is still interpolated from the
  client's receive time, so its `*_remaining_ms` is stale by the cache age:
  the sidecar must rewrite remaining fields by elapsed cache age on replay, or
  the plugin must keep the cache fresh. Decision: the sidecar adjusts
  `*_remaining_ms` by the time since it received the publish (monotonic
  clock, clamped at 0) when replaying these two types.

## 5. SLUI

- Feature folders `src/features/winpanel/` and `src/features/hudmessages/`
  (alerts and progress share the snapshot reducer; separate components).
- Reducer stores the latest frame per type with `receivedAtMs`; selectors
  interpolate with `nowMs` (250 ms UI clock). Animations that need smooth
  motion (progress ring, fades) use CSS animations whose duration/delay are
  fixed at mount from the interpolated values, never per-tick style updates
  (same rule as chat fades).
- Baseline of another server/instance clears both stores; reconnect to the
  same instance keeps them until the replayed snapshot arrives.
- Components render only typed view models; leaf components never parse.
- Visuals are hand-built React per `cs2-visual-replication.md`, 1920x1080
  canvas scaled by `overlayScaleForViewport`. Team colours from `ROLE_COLORS`;
  loss red `#DB4437`. All drawn assets are SLUI-made SVGs under
  `public/assets/<feature>/` (no CS2 files).
- `OVERLAY_CLIENT_FEATURES` gains `win-panel` with the win-panel child and
  `hud-messages` with whichever of alerts/progress lands last.
- Mock provider and debug panel gain fixtures for every captured state so
  layout/visual audits run without a game.

## 6. Compatibility and rollback

- Each layer is additive. Rolling back SLUI (not declaring the features)
  restores plugin hints immediately; rolling back the plugin publisher leaves
  the new sidecar/client code idle.
- Deploy order for a live server: backend sidecar first (accepts the new
  types), then plugin, then SLUI release. A plugin publishing unknown types to
  an old sidecar would get `diagnostic` drops, so the order matters.

## 7. Trade-offs recorded

- Viewer-variant titles from the plugin (R1) instead of replicating
  `ResultTitleFor` in TS: one rule implementation, at the cost of up to three
  publishes per result.
- Snapshot + local interpolation instead of streaming every countdown tick:
  bounded IPC rate; requires replay age correction (section 4).
- Avatar looked up from `match.snapshot` instead of a new field: the sidecar
  already fills avatars there; a missing avatar falls back like the HUD.
