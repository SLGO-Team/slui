# Minimap Contracts

## 1. Scope / Trigger

Apply these rules to radar contracts, map resolution, connection diagnostics,
viewpoint/camera changes, mock streams, and game foreground integration.
The client displays only Entrance and HeavyContainment. Backend LOS filtering
remains authoritative; the client validates structural and relationship errors.

## 2. Signatures

```ts
type RadarPreferences = {
  alwaysCentered: boolean; orientation: "fixed" | "heading-up";
  mapBlend: boolean; blurBackground: boolean; backgroundAlpha: number;
  hudScale: number; mapScale: number; alternateMapScale: number;
  squareWithScoreboard: boolean; forceSquare: boolean; dynamicZoom: boolean;
};
type GameForegroundState = { focused: boolean; revision: number };

resolveMinimap(init: MinimapInit): Promise<MapGeometry>;
minimapReducer(state: MinimapState, action: MinimapAction): MinimapState;
normalizeRadarPreferences(value?: Partial<RadarPreferences> | null): RadarPreferences;
useMinimapFeature(options?: {
  preferences?: Partial<RadarPreferences>;
  controls?: Partial<{ alternateZoomActive: boolean }>;
  renderCapabilities?: Partial<{ pageBackdrop: boolean }>;
  now?: () => number;
});
selectMinimap(state: MinimapState, nowMs: number,
  preferences?: Partial<RadarPreferences>,
  renderCapabilities?: Partial<{ pageBackdrop: boolean }>): MinimapViewModel;
subscribeGameForeground(listener: (state: GameForegroundState) => void): () => void;

interface SlgoConnection {
  subscribe(listener: (event: SlgoEvent) => void): () => void;
  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void;
  subscribeDiagnostic(listener: (diagnostic: MinimapDiagnostic) => void): () => void;
}
```

The feature hook receives all three notifications through the session callbacks.
App must forward status changes immediately; a React effect observing only the
last batched status can miss a connecting/baseline-required reset.

## 3. Contracts

- Envelope remains protocol 0 / schema 1. Both minimap events require nonempty
  `round_id`, valid `sent_at`, and payload `minimap_schema_version: 5`.
- Markers (since v3) carry `status` (`live` / `last-known` / `dead`) and
  `status_age_ms` instead of `is_alive`. The SLGO plugin runs the CS2 radar
  state machine (last-known 6000 ms, death 4000 ms); the client never keeps an
  omitted marker or invents a last-known pose. `last-known` is opponent-only,
  `self` is `live` exactly when the viewer is alive, and the viewpoint must
  match a `live` marker. `status` is part of the authorization key, so any
  status change needs a new `visibility_revision`.
- `observed` markers come from the plugin's observation rights (the same rule as
  nametags and first-person spectating: e.g. a dead Casual player, an authorized
  team-less spectator, Overwatch). They are never self, never a teammate of an
  assigned viewer, never `last-known`, and are the only markers a team-less viewer
  may receive. A viewer that is not alive may follow a `live` teammate or
  `observed` player (including an opponent). The client never infers these rights.
  Markers on the other team than the viewer use the red enemy style; a team-less
  viewer sees team colors. The followed marker shows its view sector and heading.
- Friendly markers (self included, death X too) use the CS2 five-colour slot
  colour from `playerSlotColors` (hud/presentation.ts), the same source as the top
  HUD counter and the chat dot, so one player keeps one colour everywhere. The
  role colours are only a fallback before a match snapshot. Opponents and
  last-known ghosts stay red. The heading tip is never washed: it keeps the
  original white image with its black outline (the wash rule `.minimap-marker img`
  must not outrank the `filter: none` on `__heading` / `__ghost`; give those a
  selector at least as specific, e.g. `.minimap-marker .minimap-marker__heading`).
  The heading box is 9×9 at y=-10 so ~4px of white tip clears the 8px disc (8px
  read as too thin, 11px as oversized). The source wedge's axis is at x=16.5 of
  32, so it is centred with `transform: translateX(-51.5625%)`, never a
  fractional `left` (browsers snap that to device pixels and the tip drifts off
  the dot's axis).
- v4 commander keycard (SLGO's C4) follows the CS2 radar bomb (CS:GO
  `sfhudradar.cpp`: `player_has_c4` on spotted players, `m_fBombSeenTime`,
  `BOMB_FADE_TIME = 8`). `has_commander_keycard` may be true on any `live`
  marker (an opponent spotted while carrying it included), at most one per
  frame. `commander_keycard` is null or `{ x, y, z, zone, room_id, team_id,
  status, status_age_ms, state }`, the card as a radar item when no marker holds
  it; `team_id` is the match team currently playing NTF (the plugin takes it
  from `MatchTeamManager`, never from marker roles) and decides the enemy colour.
  `state` is `carried` / `dropped` / `planted` (planted = in the generator the NTF
  side started, fixed there like the CS2 planted bomb). `live` (age 0, `dropped`
  or `planted`) = seen now; `last-known` = where the viewer's side last knew it
  (any state), `age < MINIMAP_KEYCARD_FADE_MS` (8000). The plugin alone decides
  knowledge (NTF side and NTF observers always know a dropped or planted card,
  SCP side only with line of sight); the client never infers it. Both are in
  `authorizationKey` (holder flag per marker + item `[status, state]`), mirroring the plugin `Signature`, so a
  change needs a new `visibility_revision`; age changes reuse it. The item room
  must belong to its zone (`validRooms`).
- Keycard rendering follows CS2 `RI_BombDefuserPackage`: the holder gets
  `KeycardNTFCommander.svg` (12×12 box, black drop shadow) centred *over* its dot
  like the CS2 bomb pack over its carrier, washed with the carrier's marker wash
  (slot colour; red for an opponent), as confirmed in CS2. The item is the same
  icon, white for its own side and team-less observers and washed red when
  `team_id` is not the viewer's team, plus the
  `#DroppedBomb` pulse ring (80px = 110px × ~0.73, 2px `#880000`) when `dropped`
  or the `#PlantedBomb` ring (51px = 70px × ~0.73, 2px `#D10000`) when `planted`,
  both screen blend with `DroppedBomb--Animate` 0.75s; a `last-known` item fades as
  `1 - age/8000` with age advanced by the local clock (`keycardOpacity`) and is not
  drawn once expired. It uses the markers' projection and edge clamp
  (`clampToRadar`), shows only the icon at the edge, renders beneath every player
  marker and never drives the camera or dynamic zoom. The item wash goes through
  `--keycard-wash` with an empty fallback (`var(--keycard-wash,)`), never `none`:
  `none drop-shadow(...)` is an invalid filter list and silently drops the
  shadow. Mock preview:
  `?minimapKeycard=carried`, `=dropped`, `=planted` or `=lost` (8 s fade loop); with
  `viewerTeam=team-b` the carried card sits on the spotted NTF enemy.
- v5 bombsites (CS2 radar `BombZoneA/B`, SLGO generator sites) live in
  `minimap.init.bombsites`: a required array (empty allowed, at most 26) of
  `{ label, x, y, z, zone, room_id }`, a heading-less pose with the marker
  zone/room rules and `label` one uppercase letter (`typeof` string and
  `/^[A-Z]$/`, never coerced), unique in the init. The order carries no meaning.
  The plugin alone decides the set (its configured generator rooms in config
  order = A, B, ..., a missing room skipped without shifting later letters) with
  the same calculation that places the generators; the client never derives
  sites from rooms. `positions` is unchanged apart from the version.
- Bombsites are committed together with the geometry (`MinimapState.bombsites`)
  on `resolved`, only after every non-null `room_id` belongs to its zone in the
  geometry; a mismatch rejects the whole init like an init-level error
  (`clearInit` + `NO_MAP`, `invalid`). They are static map data: shown
  whenever the geometry is (warmup with no frame, stale / invalid positions and a
  dropped connection that retains the geometry included). Every path that drops
  the geometry drops them too (spread `NO_MAP`, never a bare `geometry: null`),
  so they cannot outlive or mismatch the map they were validated against; they
  return only with the next init's resolution. Never part of `authorizationKey`; they never drive
  the camera or dynamic zoom. `selectMinimap().bombsites` uses `clampToRadar`
  (the markers' projection and edge clamp); the full map fits them unclamped.
- Bombsite rendering follows CS2 `.BombZone`: SLUI-drawn white `A` / `B`
  letters (`bombsite-a/b.svg`, after `icon-bomb-zone-a/b_png.png`), washed `#ffcc00` through the shared
  sRGB `ColorWash` (`${id}-bombzone`) via `--bombsite-wash` with an empty
  fallback, plus two 1px `#111` drop-shadows. Width follows the source aspect,
  centred on the site with `translate(-50%, -50%)`. Clamped to the edge: 18px
  high (6% of the 300px panel), opacity 0.7; in range: 12px (`.BombZone_OnMap`,
  4%), opacity 0.4. That tiering is inferred from the class names (user accepted
  2026-10-02). Letters from C on are heavy `#ffcc00` text with the same outline.
  They are always upright (the HTML layer never rotates) and render first in
  `.minimap-radar__markers`, beneath the keycard item and every player marker.
  Mock preview: the init carries A = Hcz939, B = HczNuke (`HczWarhead`) computed
  with mock-only copies of the plugin `GeneratorConstants` offsets;
  `?minimapBombsites=0` sends an empty list (toggling it sends a new init).
- CS2 marker rendering (CS2 `client.dll` / CS:GO `sfhudradar.cpp` timings):
  `last-known` is the red ghost `?` (upright, 6.6×11, opacity 0.8) and fades as
  `1 - age/6000`; `dead` is the death `X` (14×14, washed red for enemies, white for
  self, team color for friends) and fades as `1 - age/4000`. Age = the frame's
  `status_age_ms` + local monotonic time since receipt; an expired marker is not
  drawn even while its frame is fresh. At the edge a ghost uses the offscreen
  arrow, a death `X` stays an `X`. Frozen markers render beneath live ones, are
  never interpolated, and never drive the camera, viewpoint or dynamic zoom.
- Init pins SCP:SL 14.2.7, map-seed 1.0.0, map schema 1, and unity-world-xz.
  Vendored commit is `65c82b8f930eaef3ee30304a23c96af3a75711a3`; retain the
  actual Apache-2.0 LICENSE and modification notice. Upstream package metadata's
  MIT value is not a substitute for the actual license.
- `map_id` identifies a physical generation, even when its seed repeats.
  Geometry caches use the full generator descriptor. A cache hit does not
  authorize a new session, round, or map without baseline/init.
- Positions atomically replace viewer, viewpoint, scoreboard, and markers.
  Viewer is the authenticated route SteamID and stable team. A dead viewer may
  follow an authorized living teammate without reducing the shared marker set.
- Every nested object uses an explicit field whitelist. Enum validation checks
  the primitive string type before membership; never coerce untrusted values.
  Positions/yaw/rate are finite; sequence/revision are nonnegative safe integers.
- The viewpoint must exactly match a living self/teammate pose in the same frame.
  Null viewpoint fits both zones in fixed orientation while retaining fresh
  authorized markers. No historical death position supplies the camera.
- `visibility_revision` tracks membership/team/visibility changes. Same revision
  permits only movement, headings, scoreboard, and authorized viewpoint changes.
  Room references must validate before committing the revision or authorization
  key; a pending frame is not an accepted authorization state.
- Renderer projects world `(x, -z)`. Yaw 0 is +Z; yaw 90 is +X. Following camera
  and followed marker consume the same interpolated pose, with shortest-angle
  interpolation and no extrapolation or interpolation from dead markers.
- Radar uses a stable 300px design panel with a 250px circle or 290px square
  within the shared 1920x1080 overlay scale, multiplied by radar-only `hudScale`.
  Shape is `forceSquare || (fullMap && squareWithScoreboard)`. Camera projection,
  SVG clipping, offscreen markers and full-map fitting must share that shape
  and view size. Full map fits both zones with 12px inset and never changes
  overlay input mode. At mapScale=0.70 the circular radius is 45 world units;
  otherwise it is `45 * 0.70 / mapScale`. Square mode preserves the same
  world-to-design-pixel scale and uses the additional visible area.
- Room placement uses actual generated centers, rotations, and connectors.
  Room artwork is the maintained SCP-079 room SVG set in
  `public/assets/minimap/rooms/`. Resolve by `prefabName` using the explicit
  mapping in `room-artwork.json`; neither
  `Unnamed` nor the shared checkpoint display name identifies the artwork.
  Preserve the source paths and opacity layers. Keep provenance and asset hashes
  with the bundled files; production and tests use only repository files.
  Pin the hashed room-art mapping and SVGs to `text eol=lf` in
  `.gitattributes` so Windows checkout does not change their source hashes.
- Each supported room's full 256x256 SVG canvas occupies its 15x15 world grid
  cell with the center anchor. In projected world `(x,-z)`, the equivalent
  image transform is `translate(x,-z) rotate(rotationY) scale(15/256)` with
  image origin `(-128,-128)`. Do not add the artwork's native 180-degree
  correction after changing projections or stretch the drawn area to the
  grid. Full-map bounds
  must include rotated full-canvas corners, not the former chamber squares.
- Cross-zone adjacency is absent: only the two template-verified
  checkpoint pairs receive derived links. Source artwork supplies room
  illustrations, not collision walls or new connectivity. Some special rooms
  explicitly share artwork in the mapping; document that reuse.
  The checkpoint halves' SVG exits already meet at their shared grid boundary.
  Retain the links as geometry, but draw no center lines
  through the room artwork; their width can leak outside its narrow channels.
- The user's approved CS2 visual update removes all per-room labels from inside
  the map. Do not retain an unused label layout function or reintroduce text in
  the SVG layer. The sole location title below the radar uses validated
  viewpoint room identity and the explicit Chinese vocabulary, falling back
  to its zone when unnamed. No internal prefab identifiers appear as text.
  Sources are in `public/assets/minimap/SOURCE-MAP.md`.
- All eleven radar preferences have centralized defaults and normalization.
  `backgroundAlpha` clamps to [0,1], `hudScale` to [0.8,1.3], base/alternate map
  scales to [0.25,1]. Wrong types and non-finite numbers fall back to defaults;
  do not coerce strings or overwrite caller objects. Partial orientation-only
  inputs remain supported. The user's `cs2-reference` preset (heading-up,
  mapScale=0.25, alpha=0.63, hudScale=1) is distinct from SLUI defaults and is
  not claimed to be CS2 factory settings.
- Alternate-zoom activation is a separate transient control, not scoreboard
  visibility and not a mutation of base mapScale. Focus loss/stale/source reset
  suppress it; an old held-true input must not silently reactivate on recovery.
  Full-map/absent-viewpoint overview takes precedence over manual/dynamic zoom.
- Dynamic zoom uses only fresh, already-authorized markers in the viewpoint's
  zone. Fit with 12px edge padding within [0.25,user-selected scale], expand
  immediately, and after 2s of sustained smaller target extent restore at
  0.35 scale units/s. These constants are SLUI behavior, not recovered native
  CS2 values. Keep only camera scalar/time state, never retained enemy poses;
  clear transient recovery when its source/context stops applying.
  Target identity and recovery timing use the same same-zone/alive filter as
  fitting; an unrelated off-zone change must not postpone local recovery.
  Fit the displayed interpolated poses shared by the camera and markers, not
  the raw latest pose alone, so new targets enter immediately during movement.
- Render capabilities distinguish a composited page backdrop from an external
  game window. Requested `blurBackground` only becomes effective with a page
  backdrop; transparent native WebView cannot claim to blur the external game.
  `mapBlend` can blend artwork with the radar's own background, with source
  opacity detail preserved. Do not globally fade markers/text for background
  alpha or simulate native success based only on CSS support detection.
  Apply effective backdrop blur at the shared radar viewport boundary, not
  only to a background sibling below a screen-blended map: that sibling setup
  can let the map resample the unblurred scene. A viewport backdrop filter
  blurs pixels behind the radar without blurring its artwork/markers. The
  visually calibrated CSS radius is 64px; it is not a conversion of Source2's
  `gaussian(2,2,2)` values. Background alpha remains independently configurable.
- Freshness uses local `performance.now()` and
  `max(1000, 3000 / position_update_hz)` milliseconds. Other feature events do
  not renew minimap age. Invalid/stale/disconnected frames clear all markers
  and temporary full-map state immediately.
- Scoreboard input is plugin actual UI visibility, never CapsLock state.
  Foreground loss disarms zoom; restoration requires a current false frame
  before a later true frame. Windows checks the foreground process image's
  `SCPSL.exe` basename with limited query rights. The browser fixture is a
  separate fake source and proves no native game focus behavior.
- Preview uses `.env.mock` via `npm run dev:mock`, 15Hz frames, and the gated
  `window.__SLUI_MINIMAP_DEBUG__` interface. It does not provide production
  authentication, WSS transport, or actual game scoreboard bridging.
  `minimapPreset=cs2-reference` selects the supplied screenshot configuration;
  `minimap<FieldName>` parameters override fields (e.g. `minimapMapScale=1`).
  Debug `configure` accepts the same direct fields and `alternateZoomActive`.
  `background=0` explicitly disables the page scene and backdrop capability.
  The preview-only `dynamicTargets=near|far` fixture exercises real zoom changes;
  it changes existing authorized marker poses and never adds wire fields.
  `minimapLastKnown=1` turns the second enemy into a looping 6 s last-known marker
  and `minimapDeaths=1` adds a looping 4 s dead teammate; toggling either bumps the
  preview revision, like any status change.

## 4. Validation & Error Matrix

| Input | Result |
| --- | --- |
| Old sequence | Ignore without refreshing age, clearing markers, or changing live status |
| Invalid baseline payload | Do not activate the sequence guard's baseline eligibility |
| Valid envelope, invalid minimap payload | Consume sequence; publish a safe local diagnostic; clear dynamic data |
| Unknown minimap version | Local incompatible state; later valid HUD/shop remain usable |
| Unknown envelope version or wrong authenticated viewer | Revoke connection eligibility; require a new authenticated connection |
| Invalid JSON/route while connected | Publish global status; require a new baseline |
| Invalid room while geometry loads | Reject on resolution without committing its visibility revision |
| Bombsite room outside its zone or unknown | Reject the init on resolution (`invalid`, no geometry, no bombsites) |
| Late resolver after reset | Ignore by request token and descriptor/source qualification |
| Stale positions while HUD continues | Clear all dynamic markers; preserve applicable static geometry |
| Focus restored with scoreboard true | Keep normal camera until false then true arrives |

Diagnostics carry only fixed client categories and validated envelope metadata,
including event type, source, round, sequence, event ID, and monotonic receipt
time. Never attach raw payloads, markers, or server-supplied error strings.

## 5. Good / Base / Bad Cases

- Good: a dead player changes between two teammates while both teammates'
  authorized enemy markers remain visible.
- Base: no viewpoint is available; both zones and fresh team markers still show.
- Bad: a rejected loading frame advances revision and prevents legal recovery.
- Bad: array `["spotted-by-self"]` passes a `String(value)` enum check and
  bypasses the dead-viewer rule or crashes marker rendering.

## 6. Tests Required

- `npm test`: protocol, adapter/session, generator, reducer/camera, preview
  provider, and foreground subscription tests. Generator tests cover 16 pinned
  complete-output hashes and browser execution without Node globals.
- Room-art checks cover all 110 supported-zone template entries, including
  holiday variants, exact local asset hashes, asymmetric connector directions
  at quarter-turn rotations, distinct checkpoint halves, and full-map bounds.
  Browser movement assertions must inspect the rendered room image transform,
  and the visual audit must verify bundled SVG loading as well as DOM counts.
- Bombsites: contract smoke covers valid (A/B, empty, null room, all 26) and
  malformed inits (missing / non-array / 27 entries, duplicate, `"AB"`, lowercase,
  numeric label, non-finite coordinate, unsupported zone, extra key); model smoke
  covers projection, edge clamp, heading-up, full map, retention through stale /
  invalid / offline, replacement by a new init and room/zone rejection; the
  visual audit asserts the labels per state, both size/opacity tiers, aspect
  (upright), centring, wash filter and layer order beneath markers.
- `resolver.ts` is also loaded directly by Node's `--experimental-strip-types`
  through the full smoke suite. New runtime TypeScript imports on that path
  must use explicit `.ts` extensions (allowed by the existing tsconfig).
  A bundled model test and Vite build alone do not exercise Node ESM resolution.
- `npm run minimap-visual-audit`: start the mock server first; captures 1920x1080
  and 1280x720 states and checks dimensions, zones, labels, movement, permissions,
  stale/invalid clearing, rebuilding, focus rearming, disconnect and reconnect.
  `MINIMAP_PREVIEW_URL` and `MINIMAP_BROWSER_PATH` select local test resources.
- Configuration regressions cover all numeric bounds/invalid inputs, partial
  compatibility, circle/square projection and fitting, non-centered rotated
  cameras, base/alternate/dynamic precedence and focus/stale/permission resets.
  Browser audits assert no room-label layer, a correct bottom location title,
  independently scaled radar HUD, and actual pixel changes for blur/blend/alpha
  switches under a fixed page background. Native capability fallback is tested
  separately and does not constitute real game-window blur acceptance.
  Blur verification must measure reduced contrast of a known background test
  pattern; computed styles and a changed screenshot hash are insufficient.
  Use a browser that actually composites backdrop filters. The local Chromium
  133 headless shell failed this calibration despite accepting the CSS, while
  the installed Chrome 153 rendered an independent stripe probe correctly.
- `npm run lint`, `npm run build:local`, `npm run tauri:check`, and foreground Rust
  tests validate the shared build boundaries.
- Real Windows focus/click-through/DPI, plugin LOS, authenticated player/room
  mapping, version negotiation, and scoreboard visibility still require live
  integration. Mock screenshots do not prove these or CS2 pixel equivalence.

## 7. Wrong vs Correct

```ts
// Wrong: an array can stringify to an allowed enum token.
allowed.includes(String(value.visibility));

// Correct: primitive shape is part of the wire contract.
typeof value.visibility === "string" && allowed.includes(value.visibility);
```

Non-baseline receive order is envelope -> route -> sequence -> payload -> event
or diagnostic. Baseline receive order is envelope -> route -> full baseline
payload -> sequence guard -> event. Keep this exception when adding transports.
