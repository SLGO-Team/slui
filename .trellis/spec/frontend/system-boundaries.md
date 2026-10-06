# SLGO System Boundaries

> Product and cross-layer contracts for the SLUI client.

---

## 1. Scope / Trigger

This specification records the product boundary confirmed for the first SLUI
release. It applies to every client feature that consumes SLGO plugin data or
sends an action back to SLGO.

- SLUI is an SLGO-specific Windows client, not a general game overlay.
- The client is open source for auditability.
- The SLGO Backend is closed source and has two deployable roles:
  - a central control plane for identity, presence, routing, and future server
    management;
  - a low-latency sidecar on the same machine as the SLGO game server process.
- Other servers may fork or modify the client and implement their own Backend;
  generic multi-game or multi-plugin support is out of scope.
- Shop and chat semantics belong to the SLGO plugin. SLUI renders and submits
  the plugin-defined state and commands rather than inventing parallel rules.
- A sidecar may accept multiple SLGO server instances on its host. Different
  hosts may run different sidecar deployments; the control plane tells the
  client which sidecar owns the active player session.
- Identity = claimed SteamID + IP binding at the sidecar (owner decision
  2026-09-27, slgo-backend `docs/decisions.md`). SLUI claims the local SteamID
  (`local-steamid`); the control plane routes it without verification; the
  sidecar admits the WebSocket session only if its source address equals the
  player's game-connection address reported by the plugin, and closes it with
  4001 when the player leaves or their address changes. No pairing codes. The
  identity provider stays replaceable; the other identity modes are reserved
  for stronger proofs.
- Match HUD snapshots are viewer-scoped payloads. The authenticated viewer's
  stable team controls which player records may carry health; React is never
  the authorization boundary for opponent health.

---

## 2. Signatures

The following interfaces are the client-side boundary. Wire names may evolve,
but feature components must depend on these concepts rather than on raw
Tauri or WebSocket calls.

```ts
type SteamIdentity = {
  steamId: string;
  personaName?: string;
  avatarUrl?: string;
};

interface SteamClientIdentity {
  getCurrentUser(): Promise<SteamIdentity | null>;
}

// Tauri-only discovery command; browser preview uses VITE_STEAM_ID.
declare function get_current_steam_identity(): Promise<{ steam_id: string } | null>;

type SteamIdentityProof =
  | { kind: "local-steamid"; steamId: string }
  | { kind: "session-ticket"; ticket: string; appId: number }
  | { kind: "openid"; claimedId: string }
  | { kind: "device-signature"; deviceId: string; signature: string };

type ServerRoute = {
  serverId: string;
  instanceId: string;
  sidecarEndpoint: string;
  sessionToken: string;
  expiresAt: string;
};

interface SlgoControlPlane {
  // Rejections are ParseResult errors; throws only when unreachable.
  resolveActiveServer(identity: SteamIdentity, proof: SteamIdentityProof): Promise<ParseResult<ServerRoute>>;
}

interface SlgoConnection {
  connect(route: ServerRoute, identity: SteamIdentity): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(listener: (event: SlgoEvent) => void): () => void;
  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void;
  subscribeDiagnostic(listener: (diagnostic: MinimapDiagnostic) => void): () => void;
  // A connected session ended without disconnect(); status listeners fire first.
  subscribeFailure(listener: (failure: ConnectionFailure) => void): () => void;
  send(command: SlgoCommand): Promise<void>;
  getStatus(): ConnectionStatus;
}

type ConnectionFailure = {
  status: "offline" | "stale" | "unauthorized" | "incompatible";
  detail: string;
  retry: "reroute" | "backoff" | "none";
};

type MatchSnapshot = {
  viewer_team_id: "team-a" | "team-b" | null;
  state: RoundState;
  round: number;
  max_rounds: number;
  phase_remaining_ms: number;
  phase_paused: boolean;
  generator_remaining_ms?: number | null; // generator overload countdown, null when none runs
  pause_remaining_ms?: number | null;     // tactical pause countdown, null when none runs
  teams: [MatchTeam, MatchTeam];          // viewer-team players may carry `loadout`
};

type MatchSnapshotEvent = ProtocolEnvelope<MatchSnapshot, "match.snapshot"> & {
  sent_at: string;
};

declare function parseMatchSnapshot(payload: unknown): ParseResult<MatchSnapshot>;
```

These are design-level signatures, not permission to expose Backend secrets
or to let components construct arbitrary commands.

---

## 3. Contracts

Every Backend event must carry enough identity and ordering information to
separate server instances and reject stale data:

```json
{
  "schema_version": 1,
  "event_id": "uuid",
  "server_id": "slgo-server-01",
  "instance_id": "uuid",
  "round_id": "uuid-or-null",
  "sequence": 42,
  "type": "match.snapshot",
  "payload": {}
}
```

Required boundary rules:

- `server_id` identifies the configured SLGO server; `instance_id` changes
  after a server process or plugin session restarts.
- The expected production topology is:

  ```text
  SLGO plugin --loopback--> Backend sidecar --WSS--> SLUI client
                              ▲                  ▲
                              └── control plane ──┘
  ```

  The plugin-to-Backend hop must stay local to the host. It must not be
  designed as a public internet endpoint.
- The client first authenticates with the control plane and asks which
  sidecar currently reports that Steam identity as an active player. Only
  after route resolution does it open the real-time sidecar connection.
- The control plane receives low-frequency presence, registration, and
  heartbeat data. Match snapshots, minimap updates, shop state, and chat
  traffic stay on the sidecar data plane.
- `sequence` is monotonic within an instance. The client ignores older
  sequences and never merges snapshots from different instances.
- `match.snapshot.viewer_team_id` is the stable `team-a` / `team-b` identity
  authorized for viewer-only fields, or `null` for a spectator. Only players
  on that team may include a `health` key. Opponent health is rejected by
  `parseMatchSnapshot`, not removed later by a component. The same rule
  applies to `loadout` (teammate money and equipment): it may appear only on
  the viewer team (`null` for an offline teammate) and never in the spectator
  variant. The top HUD derives its equipment summaries from these loadouts
  (`topHudPlayerMetaForHud`); mocks feed the same adapter through
  `loadout` in their snapshots, never through a side channel.
- Viewer-team vitals are absolute values on the plugin's scale (SCP health
  runs into the thousands). Bars divide by the snapshot caps `max_health` /
  `max_shield` (`hudHealthPercent` / `hudShieldPercent`); only an older plugin
  without caps falls back to the old 0-100 scale. The detailed bars print the
  absolute value, never the percentage. An alive SCP-079 carries
  `aux_power` / `max_aux_power` instead of health and shield; `hudAuxPower`
  draws it in the health bar's place and hides the shield bar. The parser
  holds all six vitals to the viewer-team-only rule.
- The top-HUD timer mode comes from the snapshot only (`hudClockMode`):
  hidden in `Idle` / `WaitingForPlayers` / `RoundEnd`, else the generator
  indicator (a blinking red commander keycard without digits; the
  interpolated `generator_remaining_ms` only selects the blink tier,
  `generatorPulse`), else the pause countdown, else the phase clock. Absent clock
  fields mean `null` (older plugins). The shop countdown keeps the phase clock
  (`phaseClockSeconds`).
- The top-HUD `detailed` / `compact` variant comes from authoritative data only
  (`hudVariantFor`): detailed in `BuyPhase` / `RoundEnd`, for a spectator
  (`viewer_team_id: null`), and while the local player is dead; compact
  otherwise. The local player is the viewer-team entry whose `player_id`
  equals the session SteamID (the plugin writes SteamID64); with no identity
  or no match there is no local death to detect. Production never hard-codes
  a variant; only the HUD debug harness and the dev `hudVariant` URL parameter
  pin one for visual audits.
- The two match teams must contain exactly one `team-a`, one `team-b`, one
  `ntf`, and one `scp`. Side changes update `role`; stable team identity owns
  score and player grouping.
- A `match.snapshot` envelope requires an ISO `sent_at`. The HUD stores
  `server_id`, `instance_id`, `sequence`, receipt time, and the accepted
  baseline so stale data and restarts remain explicit. Staleness and countdown
  interpolation use only the local receipt time: `sent_at` is on the server
  clock and is never compared with `Date.now()` (a player clock 5 s ahead used
  to mark every shop snapshot stale and refuse all purchases). Missing friendly health
  becomes `null` / unknown; it is never inferred as `100`.
- `match.snapshot`, shop state, chat events, and minimap updates are derived
  from SLGO plugin semantics. The client does not reinterpret game rules.
- `hud.messages` (the four message-zone slots `progress` / `alert` /
  `hint_high` / `hint_low`) and `round.result` (`{ panel }`, the win panel) are
  per-viewer snapshots from the plugin's `HudMessageBoard` and
  `RoundResultModel` (`parseHudMessages` / `parseRoundResult`; wire rules in
  `packages/protocol/v0/README.md` "HUD messages and round result"). Text is
  plugin-resolved plain text: SLUI keeps no catalog and never resolves keys;
  `key` and `tone` (`HUD_TONES`) only pick styles. A countdown stays as the
  literal `{time_remaining}` token with `countdown_remaining_ms`, drawn locally
  as `m:ss`. The win-panel title is viewer-relative and resolved by the plugin
  (up to three audience variants per result); SLUI never re-derives it from
  `winner_team`. Every `*_remaining_ms` is the time left at `sent_at` (required
  for both types) and is interpolated from the local receive time only; the
  client also drops the panel or a message when its remaining time runs out, so
  a lost clearing frame cannot pin it. The sidecar ages replayed snapshots by
  their cache time. Feature names `hud-messages` / `win-panel`
  (`CLIENT_FEATURE_HUD_MESSAGES` / `CLIENT_FEATURE_WIN_PANEL`) join
  `OVERLAY_CLIENT_FEATURES` only once their renderers exist. The mock provider
  plays scripted scenes from `src/mocks/hudScenes.ts`, selected by the HUD debug
  `hudScene=` URL parameter; `hudSceneAt=<ms>` pins a scene moment for captures.
- Minimap payloads contain a versioned map seed/descriptor and player
  positions already filtered for the authenticated player's in-game
  visibility. The client must never receive an omniscient player map and hide
  unauthorized markers only with CSS.
- SLUI resolves the map from the seed/descriptor and renders it. The seed
  format, map generator version, coordinate system, and player update rate
  are part of the versioned contract.
- The implemented minimap payload v5, viewer/viewpoint separation, diagnostic
  ordering, and foreground lifecycle are specified in [Minimap Contracts](./minimap.md).
- The confirmed generator baseline is the
  `@scpsl-tools/map-seed` project at
  `https://github.com/kldhsh123/scpsl-map-seed.git`. SLUI must pin an exact
  release or commit and must not silently follow a moving branch.
- Release `1.0.0` resolves to commit
  `65c82b8f930eaef3ee30304a23c96af3a75711a3`. Its package metadata says MIT,
  but the actual fixed-commit `LICENSE` contains Apache-2.0. Preserve the actual
  upstream license and modification notices when bundling; do not derive an
  MIT-only attribution from package.json. Verification evidence is recorded in
  `.trellis/tasks/08-25-minimap/research/generator-and-rendering.md`.
- Generator release `1.0.0` currently bundles only the SCP:SL `14.2.7` map
  template. The sidecar map-init payload must name the game/template version;
  SLUI rejects a version that its pinned generator cannot reproduce.
- Steam integration only identifies the account currently logged into the
  local Steam client. It is not an SLGO account/password system.
- Steam identity and any proof ticket are exchanged only while establishing a
  session. They must not be attached to every match or minimap update.
- `kind: "local-steamid"` is a claim, not proof. It may open player-scoped
  sidecar sessions only because the sidecar enforces IP binding; it must never
  authorize administrative actions, account recovery, bans or payments.
  Consequence: SLUI must run on the same PC and network connection as the
  game, and reach the sidecar over the same address family.
- The control plane issues a short-lived, server-scoped session token; the
  sidecar validates it locally so real-time updates do not require a
  central-server round trip.

### 3.0 Real backend adapters

Wire formats live in `packages/protocol/v0/README.md` ("Control-plane route
request", "Sidecar session handshake", "Security boundary").

- `HttpControlPlane` (`src/platform/route.ts`): `POST {url}/v0/route` with a
  `RouteRequest`. 200 → `parseRoute` (SteamID must equal the requester's);
  400/401/404/429 → `parseRouteRejected` mapped to `ParseErrorCode`
  (`invalid-request` → `invalid-route`; `not-in-game`, `rate-limited`,
  `unsupported-protocol`, `unauthorized` keep their names). Network failure,
  timeout (10 s) or another status throws.
- `WebSocketSidecarConnection` (`src/platform/connection.ts`): connects to the
  route's `sidecarEndpoint`, sends `session.open` (token +
  `minimap_schema_versions: [MINIMAP_SCHEMA_VERSION]`, currently `[5]`) on open, never puts the token in the URL,
  resolves `connect()` on the first accepted baseline, and sends commands as
  bare command frames only while `live`. 10 s open and baseline timeouts.
  `setFeatures` stores the latest `client.features` list; it is sent on change
  while `live` and after every accepted baseline when not empty, so callers
  never resend after a reconnect. `App.tsx` maps overlay `enabled` to
  `["chat-input", "shop-menu", "top-hud", "win-panel", "hud-messages"]` / `[]`: a disabled overlay
  keeps the session live, so it must withdraw the features explicitly or the plugin keeps
  ignoring Y, keeps refusing to open its in-game shop from B and keeps its own
  chat feed, top HUD, win panel and message zone (alerts, hints, progress) hidden.
- Close mapping: 4000/4002 → `incompatible`, no retry; 4001 → `unauthorized`,
  backoff, detail = same-PC/network hint; 4003 → `stale`, reroute; any other
  close → `offline`, backoff. Before the baseline these reject `connect()` with
  `SidecarConnectionError`; afterwards they go to `subscribeFailure`.
- Session retry (`src/app/clientSession.ts`): `not-in-game`, `rate-limited`,
  an unreachable control plane and lost sessions retry with backoff
  (3 s · 2^(n-1)); 4003 and expired routes reroute (1 s · 2^(n-1)); both are
  capped at 60 s. The failure count resets only after 60 s live, so a sidecar
  that fails right after its baseline cannot cause a fast loop. `incompatible`
  and proof rejections wait for the player.
- Configuration (`src/platform/backend.ts`): only the Vite `mock` mode
  (`npm run dev:mock`, `npm run tauri:mock`) runs the mocks, and `vite.config.ts`
  refuses to build it. Every other mode needs `VITE_CONTROL_PLANE_URL`; without
  it `vite` refuses to start or build and `readBackendConfig` throws, never
  falling back to mocks. `.env.development` points `npm run dev` / `tauri dev`
  / `build:local` at the local backend and sets `NODE_ENV=development`, so
  `npm run build:local` (and `tauri:build:local`) is a development build.
  `npm run build` (production) fails until a real control plane is configured.
  The URL must be `https://` (or `http://` on loopback). Mock-only debug
  panels and mock player details never render over real data.
  `VITE_DEV_SIDECAR_ENDPOINT` (dev builds, loopback `ws://`/`wss://` only)
  replaces the socket URL because the dev sidecar has no TLS while routes
  always say `wss://`; route validation is unchanged.
- A shop snapshot older than `SHOP_STALE_AFTER_MS` (5 s) disables purchases, so
  the plugin must republish `shop.snapshot` while the buy window is open.
- Purchase eligibility is `purchasable` only (via `ShopItemView.disabled` and
  `isShopItemPurchaseBlocked`), for clicks and number keys alike;
  `owned_quantity` is display-only (the owned pip), so a held but still
  purchasable item such as a second flashbang stays buyable.
- `ShopItemView.unavailable` (not `purchasable`, or the shop is not live with
  the buy window open) is what draws a card disabled; `disabled` also blocks
  while a purchase for the item is in flight. An in-flight purchase draws
  nothing: the hover highlight, cursor and label key on `unavailable` too,
  never on `aria-disabled` (dropping the highlight under the pointer read as a
  flash), because the plugin answers well within `SHOP_COMMAND_TIMEOUT_MS`
  (5 s) and a flash of disabled styling looked broken; only a command past the
  timeout shows 等待确认 until its late result arrives.

### 3.1 Desktop windows, commands and events

SLUI runs two webview windows from one bundle. `src/main.tsx` picks the root
by window label (`?window=home` in a browser preview).

| Window | Role | Rules |
| --- | --- | --- |
| `home` | Launcher-style home: 首页 (overlay switch, status, in-game keys) and 设置 (radar, hotkeys, audio) | Frameless (`decorations: false`, `maximizable: false`) with a title bar drawn in React. Closing hides it to the tray; only the tray "退出" quits. |
| `overlay` | Game overlay (HUD, radar, shop) | Starts hidden and passive on every launch. Owns the SLGO session. |

- Home draws its own title bar (`src/app/home/TitleBar.tsx`). Every
  non-interactive element in it carries `data-tauri-drag-region` (Tauri only
  drags from the element that has the attribute). Minimize/close go through
  `createWindowControls()` in `src/platform/desktop.ts`; `close()` raises the
  normal `CloseRequested`, which Rust turns into hiding to the tray. The home
  window needs `core:window:allow-start-dragging`, `allow-minimize` and
  `allow-close` in `src-tauri/capabilities/default.json`.
- Home ships only freely redistributable fonts (Chakra Petch, Barlow, Noto
  Sans SC; system Microsoft YaHei UI for body text). Do not use Stratum2 or DIN
  Next there: both are commercial licences.
- The app/tray/exe icon is generated from `src/app/home/slui-icon.svg` with
  `npm run tauri -- icon src/app/home/slui-icon.svg -o src-tauri/icons`; drop
  the generated `android/`, `ios/` and `64x64.png`, which the Windows app does
  not use.
- Rust owns the overlay `{ enabled, interactive }` state. The home switch and
  the tray menu both call the same Rust path, so they cannot disagree. While
  disabled, the overlay is hidden, game-window alignment and the `slgo-shortcut`
  keys are skipped, and `set_overlay_interactive(true)` is rejected.
- An enabled overlay is visible only while the game (`SCPSL.exe`) or the
  overlay itself (shop / chat holding the foreground) is the foreground window;
  any other foreground window hides it, and enabling from the home window leaves
  it hidden until the game comes to the front. It aligns its rect only to the
  game window. Show/hide runs on the main thread (`sync_overlay_visibility`),
  serialized with the enable / interactive commands and the tray.
- `interactive` is derived in the overlay, not toggled by the player:
  `interactive = (shopOpen && window_open) || chatOpen`. The shop
  hotkey (default `B`, `settings.hotkeys.shop`) always closes the shop and
  opens it only while the game is foreground and the buy window is open; Esc
  or the buy window closing also closes it. The Rust hook emits
  `slgo-shortcut` for `"shop"` / `"chat-global"` (Y) / `"chat-team"` (U), passes
  every key through to the game, and never decides what opens.
- A press is told from auto-repeat inside the `WH_KEYBOARD_LL` callback with
  `GetAsyncKeyState`: Windows calls low-level hooks before updating the key's
  async state, so "already down" means auto-repeat. Never track key-ups
  yourself: a key-up lost during a foreground switch swallowed the next press.
  The hook thread runs at time-critical priority (Windows skips hooks that miss
  `LowLevelHooksTimeout`), and the event carries `game_foreground` read at the
  press, because the 100ms foreground poll lags right after chat hands the game
  back.
- The hook is not a reliable source for keys typed into the overlay's own
  window. Observed on Windows 11 with Sogou IME in Chinese mode: while the
  overlay holds the foreground (open shop), the hook receives no key events at
  all (B, W, Esc), while the page gets `keydown` normally; the IME consumes them
  ahead of our hook in the chain. So `subscribeShortcut` also listens to page
  `keydown` in Tauri and reports the shop key and Y/U with
  `gameForeground: false` (keys in inputs excluded, as in the preview). Without
  such an IME the hook reports the same press too, so the handler is idempotent:
  the shop key opens the shop only when `gameForeground` is true (or null in the
  preview) and otherwise only closes it; a second chat open is a no-op.
- Chat opens on Y/U only while the game is foreground and the session is
  `live`; it closes the shop. The open shop holds the foreground in the game's
  place, so a key pressed while the shop's window has focus also counts as over
  the game. While chat is open the overlay ignores every `slgo-shortcut` (the
  hook still fires for keys typed into the input).
- The shop cannot let the game keep the keyboard (walking while it is open).
  Verified in game (task `10-02-shop-input-passthrough`): a `WH_MOUSE_LL` hook
  blocks clicks and the wheel but not mouse movement, which Unity reads through
  Raw Input, so the camera keeps turning while the game is foreground; and keys
  posted to the background game window with `PostMessage` do not move the
  player. Short of injecting into the game process, the open shop must hold the
  foreground.
- Interactive mode only changes hit testing; it is never enough on its own.
  A foreground game (SCP:SL is Unity) keeps its cursor locked to the centre and
  turns the camera with mouse movement, so every interactive UI, the shop as
  well as chat, also takes the foreground with
  `set_overlay_keyboard_focus(true)`, which makes the overlay the foreground
  window and remembers the previous one; `false` gives the foreground back if
  the overlay still has it. Against the foreground lock it tries plain
  `SetForegroundWindow`, then after an empty `SendInput` mouse event (no
  movement: this process becomes the last input source, as in PowerToys), then
  under `AttachThreadInput`. Never synthesize keys: the game would get them.
  wry moves focus into WebView2 on `WM_SETFOCUS`; do not also call the
  webview's `set_focus()`, which bounces window focus (blur, focus) and breaks
  the close-on-blur rule below. Order: interactive on, then keyboard; keyboard
  off, then interactive off, queued in the overlay. If the keyboard cannot be
  taken, the UI stays open (the mouse is the overlay's, a click focuses it);
  the shop hotkey closes the shop and the next Y/U closes chat.
- The shop, like chat, closes on the overlay window's `blur` once the window
  has had focus since opening: once the game is foreground again its cursor is
  locked, so an open shop would be unusable.
- Chat closes on the overlay window's `blur` once the window has had focus
  since opening (earlier blurs belong to the foreground switch), never on
  game-foreground loss (the overlay itself is foreground). An interactive
  overlay takes every click in its window, transparent pixels included, so a
  click outside the panel closes via the window `pointerdown` and never reaches
  the game. Focus moving inside the page only refocuses the entry.
  `log_overlay_event(message)` prints overlay diagnostics (close reasons, focus
  failures) to the `tauri dev` terminal.
- On Windows, overlay visibility and click-through are set with Win32 calls
  only (`SWP_SHOWWINDOW` / `SW_HIDE`, `WS_EX_TRANSPARENT`). `WS_EX_LAYERED`
  stays on in both modes with `SetLayeredWindowAttributes(255, LWA_ALPHA)`;
  passive adds `WS_EX_TRANSPARENT | WS_EX_NOACTIVATE`, interactive clears only
  those two. Both alternatives were reproduced on Windows 11: a layered window
  without layered attributes fails every hit test (the mouse passes to the game
  while the keyboard works), and clearing `WS_EX_LAYERED` the first time turns
  the webview's transparent pixels opaque white. Do not mix in
  tao's `show()` / `hide()` / `set_ignore_cursor_events()`: tao caches
  visibility, never sees the native show, and would skip the hide or re-hide
  the window when it refreshes styles.
  Visibility is changed only by the enable path; positioning code must not
  pass `SWP_SHOWWINDOW`.
- The overlay window config sets `"shadow": false`. Tauri's default undecorated
  shadow keeps the resize frame out of the client area (measured 8px left,
  right and bottom, 1px top), so the webview misses the edges of a borderless
  fullscreen game and DWM draws a 1px border there.
- A second launch exits through `tauri-plugin-single-instance` and surfaces
  the running home window, flashing its taskbar button.
- Settings live in `app_config_dir()/settings.json` as
  `{ "version": 1, "overlay": { "autoEnableOnConnect": boolean }, "radar": RadarPreferences, "hotkeys": { "shop": KeyboardEvent.code }, "audio": { "shopVolume": number } }`.
  A block missing from an older version-1 file falls back to its defaults.
  `autoEnableOnConnect` (default `true`; a file without the block, older ones included, gets it on) lets the overlay window, which owns
  the session, switch the overlay on through the same `set_overlay_enabled`
  path as the home switch, once per session attempt when it first reaches
  `live` (`shouldAutoEnableOverlay`); a manual disable holds until the next
  connection. Turning the setting on while already live enables at once.
  `shopVolume` (0-1, default 0.15) scales the shop's CS2 cue volumes, so 1 is
  the CS2 buy menu level; `normalizeAudioSettings()` clamps it and recovers
  non-numbers to the default. The overlay applies a change from the next cue.
  Rust only guarantees a JSON
  object and atomic replacement, backing up unreadable files as
  `settings.json.bad-<unix-seconds>`. The frontend parses with
  `parseSettings()`, which delegates to `normalizeRadarPreferences()` and
  `normalizeHotkeys()`. Bindable shop keys are letters except Y and U (chat) and
  F1-F12; digits are reserved for shop item selection. `hotkeys.ts` and the
  Rust `is_bindable_shop_hotkey()` must accept the same set.
  Action state (`alternateZoomActive`) and render capability (`pageBackdrop`)
  are never saved.
- Home is the only settings writer. It applies edits locally, saves with a
  150ms debounce, and does not consume `slgo-settings-changed` (that would
  echo stale values back during a slider drag).
- Debug builds with any `minimap*` URL parameter keep URL preferences and
  ignore saved settings so visual audits stay deterministic.

| Command | Caller | Result |
| --- | --- | --- |
| `set_overlay_enabled(enabled)` / `get_overlay_state()` | home | `{ enabled, interactive }` |
| `set_overlay_interactive(interactive)` | overlay | error while disabled; called only from derived UI state |
| `set_overlay_keyboard_focus(focused)` | overlay | `true` errors unless interactive or when Windows refuses the foreground |
| `set_shop_hotkey(virtualKey)` | overlay | error for keys outside the bindable set |
| `load_settings()` / `save_settings(contents)` | both / home | `string \| null` / broadcasts on success |
| `get_game_running()` | home | `boolean` (SCPSL process present, independent of focus) |

| Event | Direction | Payload |
| --- | --- | --- |
| `slgo-overlay-state` | Rust → all | `{ enabled, interactive }` |
| `slgo-shortcut` | Rust → overlay | `{ shortcut: "shop" \| "chat-global" \| "chat-team", game_foreground: boolean }`, first key-down only, while enabled |
| `slgo-settings-changed` | Rust → all | saved settings JSON text |
| `slgo-game-running` | Rust → all | `boolean`, on change (2s poll) |
| `slgo-session-status` | overlay → home | `{ status: ConnectionStatus, steamId: string \| null, detail: string \| null }` |
| `slgo-session-status-request` / `slgo-session-retry` | home → overlay | `null` |

React components reach all of these only through `src/platform/desktop.ts`
and `src/platform/settings.ts`. Browser previews use a `BroadcastChannel` and
`localStorage` so a home tab and an overlay tab still drive each other.

---

## 4. Validation & Error Matrix

| Condition | Required client behavior |
|---|---|
| No Steam client identity is available | Show signed-out state and do not open a Backend stream |
| Local SteamID cannot be read or Steam is not running | Show signed-out/Steam-offline state and retry on process/account change |
| Sidecar closes with 4001 (address is not the game connection, player left, address changed) | Show `unauthorized` with the same-PC/network hint; retry with backoff |
| Control plane answers `not-in-game` | Expected before the player joins a server, not an error: status `not-in-game`, home shows blue "等待中" with the Chinese hint "等待进入游戏服务器" (never the raw English detail, no retry button); poll the route every 5 s (`retry: "poll"`, `NOT_IN_GAME_POLL_MS`), never backing off, so joining a server is noticed within seconds; the poll resets the failure count. Keep the interval inside the control plane's 30 route requests per minute per address |
| Any timer-driven retry (`poll`, `backoff`, `reroute`) | Runs `quiet`: its progress steps (`discovering`, `route-pending`, `connecting`) only bump `attempt` and clear `retry`; status, detail and Steam identity keep the last outcome until the attempt reaches a new one, so the home cards never flash every poll. A manual "重试" or an account change is not quiet and shows its progress |
| Control plane answers `rate-limited`, or is unreachable | Show offline with the reason; retry with backoff; never guess a sidecar endpoint |
| Sidecar closes with 4003 (instance ended) | Resolve a new route |
| Sidecar closes with 4000/4002 | Show `incompatible`; no automatic retry |
| Route/session token is expired or bound to another server instance | Refuse the sidecar connection and request a fresh route |
| Backend event has unknown `schema_version` | Reject the event and show an incompatible-client status |
| Routed event has an unknown `type` | Skip the frame (`unsupported-event-type`): it consumes its sequence, the stream stays live, no rejectGlobal |
| Event has a different `instance_id` | Reset live round state, accept only a new baseline snapshot, and show reconnect/restarted status |
| Event `sequence` is older than the accepted sequence | Ignore it without mutating feature state |
| Minimap seed version or coordinate version is unknown | Reject map updates, keep the last valid map if safe, and show an incompatible-map status |
| Minimap payload contains unauthorized entities | Treat the payload as invalid, discard it, and record a diagnostic; never render the entities |
| Shop or chat command is rejected by SLGO | Keep the current authoritative state and show the plugin-provided failure reason |
| Backend connection is lost | Mark data stale, disable commands that require authority, and permit reconnect |
| Match snapshot contains health for a team other than `viewer_team_id` | Reject the payload as `invalid-payload`; do not pass it to the HUD |
| Match snapshot contains `loadout` (even `null`) for a team other than `viewer_team_id` | Reject the payload as `invalid-payload` |
| `generator_remaining_ms` / `pause_remaining_ms` / a `loadout` key has the wrong type | Reject the payload as `invalid-payload` |
| A loadout item id has no icon | Skip that icon; never draw a placeholder |
| Match snapshot repeats a team id or role | Reject the payload as `invalid-payload` |
| Match snapshot omits `sent_at` | Reject the event as `invalid-envelope` |
| `hud.messages` / `round.result` omits `sent_at` | Reject the event as `invalid-envelope` |
| HUD message has an unknown field or tone, text blank or over 256 UTF-16 units, a `{time_remaining}` token without `countdown_remaining_ms` (or the reverse), non-integer or out-of-range ms, or progress `remaining_ms > total_ms` | Reject the payload as `invalid-payload` |
| Round result is a draw outside a match end, or `outcome` is `draw` without a null `winner_team` (or the reverse) | Reject the payload as `invalid-payload` |
| Friendly health is absent or null | Render an explicit unknown state; never infer a numeric value |
| HUD source changes by `server_id` or `instance_id` | Clear the prior frame, require a new baseline, and show restarted/syncing state |
| `settings.json` is missing, not JSON, not an object, or has an unknown `version` | Back up unreadable files, fall back to radar defaults, keep running |
| A saved radar value is out of range or mistyped | Clamp or restore that field only via `normalizeRadarPreferences()` |
| Saving settings fails | Keep the edit applied for this run, show the error on the home page, retry on the next edit |
| Overlay is disabled | Keep it hidden and click-through; ignore overlay shortcuts; reject interactive mode; close the shop and chat |
| Shop hotkey pressed outside the game or buy window | Ignore it; never take the mouse |
| Saved shop hotkey is not bindable | Fall back to `B` via `normalizeHotkeys()` |

---

## 5. Good / Base / Bad Cases

- **Good**: Two plugin instances on one host send events through the same
  sidecar. Their `server_id`/`instance_id` streams remain isolated, and a
  reconnect with a new `instance_id` starts from a complete baseline snapshot.
- **Good**: The control plane sees a player heartbeat from one server, returns
  that sidecar route, and the client moves to the sidecar without receiving
  high-frequency match data through the control plane.
- **Base**: The client is in browser preview with a mock provider; the same
  contracts and stale-state transitions are exercised without Tauri or a live
  Backend.
- **Bad**: The Backend sends all players to the client and relies on React to
  hide enemies that the player cannot see. This leaks authoritative data and
  is forbidden even if the screen appears correct.
- **Good**: A team-a viewer receives health only for team-a players; the parser
  accepts the snapshot and the opponent HUD view type has no health field.
- **Base**: A friendly health field is absent; the selector produces `null`
  and the HUD renders unknown without guessing a value.
- **Bad**: Both teams receive optional health and the component decides which
  bars to hide. The forbidden data has already crossed the trust boundary.

---

## 6. Tests Required

- Steam identity adapter: current user, no Steam client, account switch, malformed local data, and API failure.
- Identity boundary: a local-steamid route opens the sidecar stream and sends
  commands once live; an unknown identity mode or a route for another SteamID
  is refused (`scripts/contract-smoke.mjs`).
- Real adapters (`scripts/backend-connection-smoke.mjs`): route request shape,
  each rejection reason and HTTP failure, handshake frame, close codes before
  and after the baseline, timeouts, stream rejection, local disconnect, config
  validation and retry delays.
- Event envelope: valid event, unknown schema, stale sequence, and instance
  transition.
- Match HUD contract: unique team ids and roles, viewer-only health, missing
  friendly health, required `sent_at`, stable team score across role swap,
  server/instance baseline transitions, stale/disconnected state, and clock
  interpolation from the accepted snapshot frame. Top-HUD fields
  (`scripts/contract-smoke.mjs`, `scripts/hud-model-smoke.mjs`): the
  slgo-backend publish fixture parses, wrong-typed clocks/loadouts and
  opponent/spectator loadouts are rejected, clock-mode priority and
  interpolation, and the loadout-to-equipment adapter.
- Visibility boundary: an unauthorized minimap marker is rejected before the
  React map component receives it.
- Multi-instance routing: events from two server instances sharing one sidecar
  cannot overwrite each other's accepted state.
- Presence routing: a player heartbeat creates a route with a lease/TTL;
  expiry removes the route and prevents stale server selection.
- Session binding: a route token for player X and instance A is rejected by
  sidecar instance B.
- Map resolution: a supported seed/version produces the expected map geometry
  and coordinate transform; an unsupported version is rejected.
- Generator regression: fixed fixture seeds produce stable room identities,
  positions, rotations, zone bounds, and connectivity for each supported
  template version.
- Sidecar latency: the loopback plugin path does not depend on the public
  client connection and remains usable while a client reconnects.
- Shop and chat: plugin success, plugin rejection, connection loss, and
  reconnect without duplicate command application.
- Windows smoke test: passive click-through and interactive mode must remain
  independent from Backend connection state.
- `scripts/settings-smoke.mjs`: settings fallback, version, clamping,
  per-field recovery, hotkey validation and virtual-key mapping, round trip.
- `scripts/desktop-adapters-smoke.mjs`: overlay state, game process and the
  session status bridge, including invalid payloads and event routing.
- `src-tauri/src/settings.rs` unit tests: atomic save, rejection of non-objects,
  and backup of corrupt or non-UTF-8 files.

---

## 7. Wrong vs Correct

### Wrong

```ts
// The UI receives an omniscient snapshot and hides enemies locally.
const visiblePlayers = snapshot.players.filter((player) =>
  player.team === myTeam || player.isSpotted,
);
```

### Correct

```ts
// The Backend/plugin sends only entities this player may know about.
const visiblePlayers = event.payload.visiblePlayers;
```

The visibility decision belongs to SLGO's authoritative data path. SLUI may
render the filtered result, but it must not be the security boundary.

### HUD health: Wrong

```ts
// The generic payload exposes opponent health and leaves authorization to JSX.
const health = player.health ?? 100;
return isOpponent ? null : <HealthBar value={health} />;
```

### HUD health: Correct

```ts
const parsed = parseMatchSnapshot(payload); // rejects opponent health
const hud = selectRoundHud(state, nowMs);    // opponent view has no health
const health = viewerPlayer.health;          // number | null; null is unknown
```

---

## Pending Decisions

These are the remaining implementation questions that cannot be safely
inferred from the product boundary:

1. Resolved 2026-09-27: claimed SteamID + sidecar IP binding. Stronger proofs
   (Steam session ticket, OpenID, device signature) remain reserved identity
   modes in case the IP-binding trade-offs stop being acceptable.
2. How does a sidecar discover/register `server_id` values and isolate several
  plugin instances on the same host?
3. The current SLGO server log confirms SCP:SL `14.2.7` Release. The initial
   generator candidate supports template `14.2.7` only. The player position
   coordinate/update-rate contract still needs to be finalized in the
   sidecar implementation.
4. Resolved: the control plane returns the sidecar endpoint in the route
   (sidecars register their public endpoint); UI components never choose it.
