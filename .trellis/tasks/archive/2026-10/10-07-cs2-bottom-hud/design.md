# Design: CS2-style bottom HUD

## 1. Data flow

```text
balance, alive, team          match.snapshot (exists; viewer team loadout.money, is_alive, role)
clip, reserve, round kills    hud.status (new; plugin -> sidecar -> SLUI, one recipient)

plugin main thread  -> SidecarHudStatusPublisher (diff per frame, SLUI-presence gated)
  -> IPC v1 publish hud.status -> sidecar parseEvent + single-recipient cache/replay
  -> SLUI parseEvent -> hudStatusReducer -> selectBottomHud(round HUD, status, steamId) -> BottomHud
```

Repos and order follow `10-05-hud-data-channel`: slui `@slgo/protocol` first (the sidecar validates every
plugin publish with it), then slgo-backend, then the SLGO plugin, then the SLUI renderer.

## 2. Wire event `hud.status` (protocol v0, envelope schema 1)

New event type; old clients skip it (`unsupported-event-type`). Snapshot type (latest per recipient cached
and replayed), exactly one recipient per publish. No time fields, so replay needs no age adjustment.

```ts
type HudReserveIcon = "bullet" | "shotgun_shell" | "revolver_loader";
type HudKillKind = "default" | "grenade" | "shock";

type HudStatusSnapshot = {
  /** Held firearm; null when the held item is not a firearm (SCP, unarmed, Micro-HID, keycard, ...). */
  ammo: null | {
    clip: number;        // rounds ready to fire (magazine + chambered), as the game's own counter shows
    clip_max: number;    // >= 1; capacity for the clip bar and the low-ammo threshold
    reserve: number;     // reserve rounds (SLGO bound reserve of this firearm), not magazines
    reserve_icon: HudReserveIcon;
  };
  /** One entry per kill this round, in order; reset when the buy phase starts (same rule as match.snapshot kills). */
  round_kills: HudKillKind[];
};
```

Validation (parser; plugin self-check equivalent): non-negative integers, `clip_max >= 1`,
`clip <= clip_max` is NOT required (chambered round may exceed), enums closed, `round_kills.length <= 64`,
no unknown fields.

Client feature `CLIENT_FEATURE_HUD_STATUS = "hud-status"`: SLUI declares it to receive `hud.status`. SLUI also
declares the plugin's reserved `hud-money` (`CLIENT_FEATURE_HUD_MONEY`) so the plugin hides its balance hint.
Both join `@slgo/protocol` and the backend README feature list.

## 3. Plugin (SLGO)

- `SidecarHudStatusRules` (pure: build, signature, validate) + publisher in `SidecarIpcManager.PumpOnce`.
- Audience: players whose SLUI presence lists `hud-status` (`SluiPresence`), sidecar-visible Steam players
  only. Per-shot data to every player would load the sidecar for nobody.
- Publish on change: each frame compute the payload per audience player, publish when the signature differs
  from the last one sent. No time throttle (a full-auto weapon changes ~10-15 times per second; one event per
  change keeps the per-shot pop). Forced publish after handshake resync and when a player gains the feature.
- Ammo: held item `Firearm` -> `clip = MagazineAmmo + BarrelAmmo` (verify against the native counter),
  `clip_max = MaxMagazineAmmo` (+ chamber capacity if the native counter counts it), `reserve =
  player.GetAmmo(firearm.AmmoType)` (the FirearmAmmoManager bound reserve for managed guns), icon by
  `ItemType`: `GunShotgun` -> `shotgun_shell`, `GunRevolver` -> `revolver_loader`, other firearms -> `bullet`.
  Non-firearm / dead / no role -> `ammo: null`.
- Round kills: `PlayerStatsManager` round entry keeps an ordered kind list next to `Kills` (same counting
  conditions). Kind from the damage handler: explosion (grenade) -> `grenade`, Micro-HID -> `shock`, else
  `default`.

## 4. Sidecar (slgo-backend)

- `hud.status` in `PUBLISH_EVENT_TYPES`, `SNAPSHOT_EVENT_TYPES` and `SINGLE_RECIPIENT_EVENT_TYPES`; IPC v1
  schema enum, example and `invalid/` fixtures; README event table and feature list (`hud-status`,
  `hud-money`). No new routing logic.

## 5. SLUI

### Model (`src/features/bottomhud/model.ts`)

- `hudStatusReducer`: latest frame of the baseline's instance; another server/instance clears it, a reconnect
  to the same instance keeps it (same rules as `hudMessagesReducer`).
- `selectBottomHud(roundHud, status, localSteamId)` -> `null` (hidden) or
  `{ role, balance, ammo, kills: HudKillKind[] }`. Hidden when: no snapshot, no viewer team, the local player
  is not in it, or the local player is not alive (D3). Debug build falls back to the viewer team's first player
  like `progressViewerFromHud`. Balance from the local player's `loadout.money`; ammo/kills from `hud.status`
  (absent -> no ammo, no cards).
- Pure presentation helpers: `clipBarFraction`, `isLowClip` (`clip <= 0.2 * clip_max`, from the recording),
  odometer digit plan (`balanceDigits(prev, next)`), kill-card layout (fan for 1-5, counter card from 6).

### Component (`BottomHud.tsx` / `BottomHud.css`)

- Fixed overlay layer on the shared 1920x1080 canvas (`useOverlayScale`), below the message zone; geometry from
  the captures (Panorama for proportions only), wash colour `ROLE_COLORS[role]` via a CSS variable (D1).
- Left block: `$` + balance in the CS2 health label style (no health icon, no health bar); odometer roll per
  changed digit, right-aligned like CS2 money.
- Centre: circle emblem with the new SLUI NTF / SCP emblem; kill cards above it.
- Right block: clip + clip bar, reserve + reserve icon (D4). Empty when `ammo` is null.
- Motion is CSS keyed by event (kill index, shot counter, balance change), started at mount/change, never
  driven by the 250 ms UI clock. Kill burst (beam, emblem flash, stroke glow, number flash) per new kill; the
  card fan re-lays out; counter card from 6. A round reset (kills shrink) clears the cards without motion.
- No text shadow (spec). Glows on beams/strokes are drawn shapes, not text shadows.

### Assets (`public/assets/bottomhud/`, all SLUI-drawn)

- Kill cards `kill-1..5`, `kill-extra`; pips `kill-pip-default|grenade|shock`; reserve icons
  `reserve-bullet|shotgun-shell|revolver-loader` (traced from the in-game look to ~95 %, D4); emblems
  `emblem-ntf|scp` (new drawings in CS2's one-colour line style).
- `scripts/public-content-check.mjs` rules apply (no extracted files).

## 6. Compatibility and rollback

- Additive everywhere: old SLUI ignores `hud.status`; an old plugin never sends it (SLUI then shows balance only,
  no ammo or cards). Declaring `hud-money` against an old plugin is harmless (reserved name already handled).
- Rollback: drop the two features from `OVERLAY_CLIENT_FEATURES`; the plugin then shows its balance hint again
  and stops publishing `hud.status`.
