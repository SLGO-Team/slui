# SLUI Protocol v0

This directory contains the first client-visible protocol contract for the
SLGO-specific SLUI client. It is deliberately a contract-only package: the
Backend is closed source and the SLGO plugin remains the authority for game,
shop, and chat rules.

## Topology

```text
SLGO plugin --loopback--> sidecar --WSS--> SLUI
                             ^
                             |
                    control-plane route
```

The control plane resolves a player to a sidecar. High-frequency match and
minimap events stay on the sidecar connection.

## Compatibility

- `protocol_version`: `0`
- Envelope `schema_version`: `1`; minimap payload `minimap_schema_version`: `5`.
- Current game template: SCP:SL `14.2.7`
- Map generator: `@scpsl-tools/map-seed` pinned to release `1.0.0`
- `schema_version` is an integer and must be rejected when unknown.
- `sequence` is monotonic within one `server_id` + `instance_id` stream.
- A new `instance_id` requires a fresh baseline before incremental events are
  applied.
- Clients skip event types they do not know (`unsupported-event-type`): the
  frame consumes its sequence and the stream stays live. New event types that
  older clients may simply ignore therefore need no handshake change; only
  payloads older clients must not receive (like minimap v5) are negotiated in
  `session.open`.

## Event envelope

Every sidecar event uses the shape in [envelope.schema.json](./envelope.schema.json).
The client ignores stale sequence numbers and never merges events from two
instances.

Payload schemas:

- [control-route.schema.json](./control-route.schema.json)
- [match-snapshot.schema.json](./match-snapshot.schema.json)
- [minimap-init.schema.json](./minimap-init.schema.json)
- [minimap-positions.schema.json](./minimap-positions.schema.json)
- [shop-snapshot.schema.json](./shop-snapshot.schema.json)
- [hud-messages.schema.json](./hud-messages.schema.json)
- [round-result.schema.json](./round-result.schema.json)
- [command.schema.json](./command.schema.json)
- [command-result.schema.json](./command-result.schema.json)
- [session-open.schema.json](./session-open.schema.json)
- [client-features.schema.json](./client-features.schema.json)
- [route-request.schema.json](./route-request.schema.json)
- [route-rejected.schema.json](./route-rejected.schema.json)

## v0 message set

| Direction | Type | Purpose |
|---|---|---|
| client -> control | `control.route.request` | Identity proof; asks for the active sidecar |
| control -> client | `control.route.resolved` | Select the active sidecar |
| control -> client | `control.route.rejected` | Unauthorized, invalid, or player not in game |
| client -> sidecar | `session.open` | First WebSocket frame: session token + capabilities |
| sidecar -> client | `sidecar.baseline` | Validated synchronization barrier after connect/restart |
| sidecar -> client | `match.snapshot` | Round, score, teams, players, timer |
| sidecar -> client | `minimap.init` | Map seed and generator/template versions |
| sidecar -> client | `minimap.positions` | Player positions already filtered by in-game visibility |
| client -> sidecar | `command.shop.purchase` | Plugin-defined purchase request |
| client -> sidecar | `command.chat.send` | Plugin-defined chat request |
| client -> sidecar | `client.features` | Features this client takes over from the plugin |
| sidecar -> client | `command.result` | Authoritative success or rejection |
| sidecar -> client | `chat.message` | Plugin-defined chat message |
| sidecar -> client | `chat.notice` | Plugin notice in the chat history (no sender) |
| sidecar -> client | `hud.messages` | The viewer's bottom-centre message slots (progress, alert, high/low hint) |
| sidecar -> client | `round.result` | The viewer's round / match result panel (win panel, MVP) |

The shop and chat payloads intentionally remain plugin-defined. SLUI must not
reimplement their permissions or success rules.

Chat history mirrors the plugin's in-game message area, with the same
recipients. `chat.message` carries `command_id` when a client's
`command.chat.send` produced it, so the sender's client can replace its local
echo; messages sent from the game omit it. The plugin publishes the message
before the command's `command.result`. `chat.notice` is a sender-less line
(money, joins, compensation): 1-8 `{ text, tone }` segments, at most 512
characters in total, `tone` one of `default`, `money`, `muted`. Both are
delivered once and never replayed; `message_id` / `notice_id` are unique within
an instance.

`team_id` is the stable match identity (`team-a` or `team-b`). `role` is the
current in-game side (`ntf` or `scp`) and may change when SLGO swaps sides.
Scores and shared-visibility authority follow `team_id`; current side presentation
follows `role`.

### Match snapshot top-HUD fields

Additive optional fields (no `schema_version` change; slgo-backend
`protocol/ipc/README.md` "match.snapshot top-HUD fields" is the plugin-side
authority). Older plugins omit them; the client treats absent as `null`.

| Field | Where | Meaning |
|---|---|---|
| `generator_remaining_ms` | payload | Integer ms or `null`. Non-null while a generator overload counts down; `phase_remaining_ms` is then the frozen action clock. |
| `pause_remaining_ms` | payload | Integer ms or `null`. Non-null during a tactical pause (`phase_paused` is `true`, `phase_remaining_ms` is `0`). |
| `loadout` | player | Viewer's own team only, like `health`; `null` for an offline teammate. Never present for the other team or when `viewer_team_id` is `null`. |
| `max_health` / `max_shield` | player | Viewer's own team only, like `health`. Caps of `health` / `shield` (`shield` is Hume shield + AHP); `null` when not alive. Absent from older plugins: the client then scales both to 100 as before. |
| `aux_power` / `max_aux_power` | player | Viewer's own team only. An alive SCP-079's auxiliary power and its cap; 079 has no health or shield, so it carries no `health` / `shield` / caps (the aux bar takes their place). Absent for every other player. |

`loadout` carries `money` (integer), `primary_item_id` (string or `null`),
`utility_item_ids` (strings), `armor` (`light` / `combat` / `heavy` / `null`),
`has_commander_keycard` and `has_generator_upgrade` (booleans). Ids use the
`shop.snapshot` `item_id` vocabulary: NTF primary is an `ItemType` name, SCP
primary is the current role (`Scp173`, ...), SCP utility ids are the highest
owned `HealthUpgradeN` / `ShieldUpgradeN` / `Scp079LevelN`. A dead teammate
carries money only. A wrong type on any of these fields, or a `loadout` on a
non-viewer team, rejects the snapshot.

The top-HUD timer shows, in priority order: nothing in `Idle`,
`WaitingForPlayers` and `RoundEnd`; the generator indicator (no digits: the
interpolated `generator_remaining_ms` only sets how fast the commander keycard
icon blinks); the pause countdown; else the phase clock. Each is interpolated
from the snapshot's `sent_at`. The shop countdown always uses the phase clock.

Every `minimap.positions` event is a complete visibility-filtered frame, not a
delta. When an entity is omitted from the next accepted frame, its marker must
be removed. Stale positions survive only as the explicit, plugin-authored
`last-known` markers defined below; the client never keeps an omitted marker.

## HUD messages and round result

`hud.messages` and `round.result` carry the plugin's message board
(`HudMessageBoard`) and win panel (`RoundResultModel`). They are new event
types: older clients skip them (`unsupported-event-type`), so no handshake
change is needed. Both require envelope `sent_at`. Both are snapshots: the
sidecar caches the latest per recipient and replays it after the baseline,
with every `*_remaining_ms` reduced by the time the frame spent in its cache
(clamped at 0) and `sent_at` moved forward by the same amount.

Timing: every `*_ms` value is an integer in `0..86400000` and means
"milliseconds remaining at `sent_at`". The client interpolates it from its own
receive time only; it never compares `sent_at` with the local clock.

Text is resolved by the plugin (`HudMessageCatalog`): parameters are filled
in, rich-text tags never appear, and SLUI keeps no catalog of its own. `text`
is not blank, at most 256 UTF-16 code units, and may contain line breaks. A
countdown is not filled in: the text keeps a literal token and
`countdown_remaining_ms` carries its value. `{time_remaining}` is drawn as
`m:ss`, `{seconds_remaining}` as the whole seconds rounded up (`40`, ..., `1`,
`0`); a text uses one kind only. `countdown_remaining_ms` is non-null exactly
when the text contains a token. `key` (`^[A-Za-z0-9_]{1,96}$`, a CS2 localisation key
or `SLGO_*`) and `tone` are style hooks only; `key` is never shown.

`hud.messages` (one recipient per publish) has exactly the four slots
`progress`, `alert`, `hint_high`, `hint_low` (top to bottom on screen), each
`null` or `{ message_id, key, text, tone, visible_remaining_ms,
countdown_remaining_ms }`. `progress` additionally has `progress: {
remaining_ms, total_ms }` with `total_ms > 0` and `remaining_ms <= total_ms`.
`visible_remaining_ms` is `null` for a message that stays until replaced or
cleared. `message_id` changes on every board write. `tone` is one of
`default`, `success`, `warning`, `info`, `gold`, `match_point`,
`final_round`, `ntf_team`, `scp_team` (`HUD_TONES`). A structural change
(slot appears or disappears, key, text or tone changes) is published at once;
a time-only change at most once per second per player.

`round.result` is `{ panel: null }` (no panel, or it ended early: new round,
match restart) or `{ panel: { result_id, winner_team, is_match_end, title:
{ text, outcome }, subtitle_text, mvp, visible_remaining_ms } }`. The title is
viewer-relative and resolved by the plugin, so a result goes out in up to three
audience variants (NTF participants, SCP participants, everyone else).
`winner_team` is `ntf`, `scp` or `null` (draw, only at a match end);
`outcome` is `won` / `lost` for a participant, `observer` for a viewer without
a side and `draw` exactly when `winner_team` is `null`. `subtitle_text` is the
line under the title (the end reason today). `mvp` is `null` or `{ player_id,
display_name, reason_text, music_kit_name }`; the avatar comes from the
player's `match.snapshot` entry. The client also hides the panel when
`visible_remaining_ms` runs out, so a lost `panel: null` cannot pin it.

Every object rejects unknown fields.

## Minimap payload v5

Both minimap event types require non-empty envelope `round_id` and valid `sent_at`.
Each physical map generation gets a non-reused `map_id`, including when a seed is
reused. A new connection or round needs baseline, init, then a complete frame.
`sidecar.baseline` has exactly `{ "baseline": true }`; it is a synchronization
barrier, not a map snapshot. An invalid baseline cannot authorize later frames.

Only `Entrance` and `HeavyContainment` are supported. The coordinate system is
Unity world XZ projected as `(x, -z)`. Finite `yaw_degrees` lies in `[0, 360)`:
zero points toward +Z and 90 toward +X. Non-null `room_id` refers to the pinned
generator's room identity in the declared zone, requiring a trusted plugin
mapping; an unknown room is represented by null, never a guessed id.

Each frame atomically carries the stable authenticated `viewer`, spatial
`viewpoint`, actual plugin `scoreboard_visible` state and filtered `positions`.
The first client contract binds `viewer.player_id` to the authenticated route's
SteamID64. Spectating never changes this identity or the viewer's stable team.
A viewer without a team may receive only `observed` markers. Self must match the viewer
and their alive state; teammates must be other players on that team; spotted
markers must be opponents. A dead viewer cannot use `spotted-by-self` but retains
all authorized `spotted-by-teammate` markers.

Each marker carries `status` and `status_age_ms` (v3 replaced the v2 marker
`is_alive`). The plugin runs the CS2 radar state machine and is the only
authority; the client renders what it receives:

| `status` | Meaning | `status_age_ms` |
|---|---|---|
| `live` | Real-time pose of a spotted enemy, teammate or self | always `0` |
| `last-known` | Frozen pose where an enemy was last spotted (CS2 red `?`) | `< 6000` (`MINIMAP_LAST_KNOWN_MS`) |
| `dead` | Death marker (CS2 `X`) of a teammate, self, or an enemy killed while spotted | `< 4000` (`MINIMAP_DEAD_MS`) |

`last-known` is only valid for opponents. A `self` marker is `live` exactly when
the viewer is alive and `dead` otherwise. A dead viewer still may not receive
`spotted-by-self`; the plugin labels such markers `spotted-by-teammate`. The age is
the plugin-side time since the marker entered its status when the frame was
captured; the client advances it with its local monotonic clock and stops
rendering an expired marker even if a later frame still carries it. An enemy that
dies while `last-known` is simply omitted.

`observed` means the plugin's observation rights let this viewer watch that
player: the same rule SLGO uses for nametags and first-person spectating (for
example a dead player in Casual, an authorized team-less spectator or Overwatch).
Observed players are sent as `live` (or `dead` for a death marker) without line
of sight; they are never the viewer, never a teammate of an assigned viewer and
never `last-known`. Whether a viewer has these rights is a plugin decision; the
client does not infer it.

### Commander keycard (v4)

v4 adds SLGO's commander keycard (the CS2 C4 counterpart) and nothing else,
following the CS2 radar bomb (`sfhudradar.cpp`, `BOMB_FADE_TIME = 8`). Every
marker carries a boolean `has_commander_keycard`; every frame carries
`commander_keycard`, either null or `{ x, y, z, zone, room_id, team_id, status,
status_age_ms, state }` (a pose without heading, with the same zone and room
rules; `team_id` is the match team currently playing NTF, which owns the card,
so opponents of it draw it red like an enemy marker; `state` is `carried`,
`dropped` or `planted`).

- Only a `live` marker may carry the keycard, at most one per frame. As with
  the CS2 bomb carrier, this includes an opponent spotted while holding it.
- `commander_keycard` is the card as a radar item when no marker holds it:
  `live` (age 0, `state` `dropped` or `planted`) = a card on the ground, or
  planted in the generator the NTF side started (like the CS2 planted bomb,
  fixed at the generator), seen this frame; `last-known` = frozen where this
  viewer's side last saw it (any `state`, `carried` meaning on a holder who left
  sight), fading as `1 - age/8000` and gone at 8000 ms
  (`MINIMAP_KEYCARD_FADE_MS`). The plugin decides: the NTF side and observers of
  the NTF team always know a dropped or planted card (`live`) and its holder;
  the SCP side sees it only while one of its players (SCP-079 cameras included)
  has line of sight, then the fading item. Outside Entrance / HeavyContainment
  it is not seen. A frame cannot have both a holder flag and an item.
- Both fields are part of the authorization set: a holder flag change or the
  item appearing, disappearing or changing status needs a new
  `visibility_revision`.

### Bombsites (v5)

v5 adds the bombsites (SLGO generator sites, the CS2 radar `BombZoneA/B`) to
`minimap.init` and nothing else; `minimap.positions` only bumps its version.
`bombsites` is a required array (possibly empty, at most 26 entries) of
`{ label, x, y, z, zone, room_id }`: a pose without heading at the site's
centre, with the same zone and room rules as markers, and `label` a single
uppercase letter `A`-`Z`, unique within the init. The array order carries no
meaning; the letter is the identity.

The plugin alone decides the set: it resolves its configured generator rooms in
configuration order (first = `A`, second = `B`, ...) with the same calculation
that places the generators, skips a room missing from this map without shifting
later letters, and skips sites outside Entrance / HeavyContainment. Sites are
static for a `map_id` (sent during warmup too, before any generator spawns) and
are replaced only by a new init. The client validates that a non-null `room_id`
belongs to its zone in the resolved geometry and otherwise rejects the init.

A non-null viewpoint must exactly match a `live` authorized marker's pose:
self while alive; while not alive, a teammate or an `observed` player (the
spectated target, which may be an opponent when the plugin grants it). Null viewpoint still permits team
shared positions and uses a two-zone overview. Every object rejects unknown
fields; duplicate player ids, non-finite numbers and invalid relationships reject
the entire frame. JSON Schema expresses structural checks; the runtime parser
also validates cross-object identity and pose relationships.

`visibility_revision` is a non-negative safe integer. It increases when the
authorized member/relationship/status set, the keycard holder or drop visibility,
or the viewer team changes; movement, heading and
same-team spectating changes may reuse it. It does not replace the instance-wide
safe-integer `sequence`. Frame receipt uses a local monotonic clock; only accepted
new positions refresh age. Stale, disconnected or invalid frames clear all
dynamic markers and temporary scoreboard zoom, preserving only applicable
static geometry.

The adapter validates envelope, route and sequence before ordinary payloads.
Even a rejected payload consumes its valid sequence; old events are ignored
without disturbing a live connection. Baseline payload validation happens before
sequence acceptance so invalid baselines cannot activate synchronization.
Unknown minimap payload/generator versions produce local safe diagnostics and
leave later valid HUD/shop/chat events usable. Invalid envelope/global versions,
route and authentication errors use continuous connection-status notifications.
Diagnostics contain fixed categories and validated envelope metadata only.

Legacy or unknown minimap payload versions are rejected. A sidecar must negotiate
v5 capability before sending these frames to older clients; the mock implementation
does not provide production capability negotiation. Actual plugin scoreboard
state, viewer/room mapping and server-side LOS filtering remain integration
dependencies. The client does not compute or verify physical LOS.

## Control-plane route request

`POST {control_plane}/v0/route` with a JSON body matching
[route-request.schema.json](./route-request.schema.json) (`parseRouteRequest`).
`proof` is the snake_case wire form of the client's identity proof.

| HTTP | Body | Meaning |
|---|---|---|
| 200 | `control.route.resolved` | route + session token (short-lived; used once to open the sidecar session) |
| 400 | `control.route.rejected` `invalid-request` / `unsupported-protocol` | malformed request |
| 401 | `control.route.rejected` `unauthorized` | proof kind not accepted (only `local-steamid` is accepted today) |
| 404 | `control.route.rejected` `not-in-game` | no registered server hosts this player right now; retry later |
| 429 | `control.route.rejected` `rate-limited` | too many requests from this address; retry with backoff |

Rejections match [route-rejected.schema.json](./route-rejected.schema.json)
(`parseRouteRejected`). A route is not an authorization by itself: the sidecar
admits the session only through IP binding (see Security boundary).

## Sidecar session handshake

The client opens a WebSocket to the route's `sidecar_endpoint`. Its first text
frame must be [session-open.schema.json](./session-open.schema.json)
(`parseSessionOpen`), sent within 5 seconds, and carries the route's
`session_token`, never in the URL. `minimap_schema_versions` lists the minimap
payload versions the client can render. If it does not include `5`, the sidecar
sends no `minimap.*` events on that connection. This is the v5 capability
negotiation.

The token binds SteamID64, `server_id`, `instance_id` and identity mode. On
success the sidecar sends `sidecar.baseline` for the routed instance, then
replays the latest snapshots for that viewer, then live events. The token is
checked only when the session opens, so an open session outlives the token's
expiry. After the baseline, each client text frame is one
[command](./command.schema.json) (discriminated by `kind`) or one
[`client.features`](./client-features.schema.json) frame (discriminated by
`type`). Every command gets exactly one `command.result`.

`client.features` lists the plugin features this connection currently takes
over, always as the full list (lowercase kebab-case, at most 16, no
duplicates; `[]` = none, which is also the state before the first frame). The
sidecar tells the plugin, per player, the union over that player's live
connections, and withdraws it when a connection closes. It gets no answer.
Known features:

- `chat-input`: SLUI owns text chat (the input hotkeys Y global / U team and
  the message feed), so the plugin ignores its own message-area toggle for
  this player and hides its bottom-left message area. SLUI sends it while the
  overlay is enabled and `[]` when the overlay is disabled (the session stays
  live while the overlay is hidden).
- `shop-menu`: SLUI owns the buy-menu hotkey (B), so the plugin no longer opens
  its in-game shop from that key for this player (an in-game shop that is
  already open can still be closed with it). Sent together with `chat-input`
  while the overlay is enabled.
- `top-hud`: SLUI owns the top HUD, so the plugin hides its own top score,
  round timer and team counts for this player (restored as soon as the
  feature is withdrawn). Sent together with the two above while the overlay
  is enabled.
- `hud-messages`: SLUI owns the bottom-centre message zone (all four
  `hud.messages` slots), so the plugin hides its own hints there for this
  player.
- `win-panel`: SLUI owns the round / match result panel (`round.result`), so
  the plugin hides its own result card for this player.

A sidecar that predates the frame logs and drops it like an invalid command;
the session stays open. The sidecar answers `failed` itself if the plugin is
unreachable or does not answer within 5 seconds, and `rejected` with reason
`rate-limited` when a player sends commands too fast. Too many connection
attempts from one address are refused with HTTP 429 before the WebSocket
upgrade.

Close codes (`SIDECAR_CLOSE_CODES`):

| Code | Meaning | Client action |
|---|---|---|
| 4000 | invalid handshake, or a frame arrived before the baseline | report `incompatible` |
| 4001 | token invalid/expired/not for this sidecar; source address does not match the player's game connection; player left the server or their game address changed | report `unauthorized` |
| 4002 | unsupported `protocol_version` / `schema_version` | report `incompatible` |
| 4003 | routed instance unknown or ended (server restart) | resolve a new route |

## Security boundary

`local-steamid` on its own is not proof. It is only a claim. A sidecar must not
send player-scoped data or accept commands because of a claimed SteamID alone.
Player-scoped streams are authorized by **IP binding**: the SLGO plugin reports
the address of each player's game connection to its sidecar, and the sidecar
admits a session for SteamID X only if the WebSocket source address equals X's
game address. It closes the session when X leaves the server or X's address
changes. Addresses never leave the game host. This stops remote code sharing,
not people on the same network or a deliberate relay. That is an accepted
trade-off, since a player can always share their own screen.

Client-side consequence: SLUI opens the sidecar session with a `local-steamid`
route, and `canOpenPlayerScopedStream` accepts it. The client does not gate
player-scoped data or commands by identity mode; the sidecar does. The other
identity modes remain reserved for stronger proofs. Because the check compares
addresses, SLUI must run on the same PC (and network connection) as the game,
and must reach the sidecar over the same address family as the game. A 4001
close is how a mismatch shows up.

Client rejection mapping: `not-in-game` and `rate-limited` map to the
`ParseErrorCode`s of the same name and are retried with backoff;
`invalid-request` maps to `invalid-route`; `unsupported-protocol` and
`unauthorized` keep their names.

## Fixtures

The JSON fixtures are protocol examples for browser mocks and contract tests;
they are not production credentials or live server data.
