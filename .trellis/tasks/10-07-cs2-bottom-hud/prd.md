# CS2-style bottom HUD (balance, ammo/reserve, kill cards)

## Goal

SLUI renders CS2's bottom-centre health/ammo HUD (`hudhealthammocenter`) for the local player, adapted to
SLGO: the left block (CS2 health/armor) shows the balance, the right block (CS2 clip / reserve magazines)
shows the clip and the reserve rounds (SLGO counts reserve ammo in rounds, not magazines), and the centre
shows CS2's round kill cards with CS2's motion. Source: user request 2026-10-07 with three in-game
recordings (kill cards, firing, balance changes; local only, never committed).

## Background (verified)

- `match.snapshot` carries, for the viewer's own team, `loadout.money` (the plugin publishes immediately on
  every balance change), `is_alive` and the team role. SLUI finds the local player by Steam id
  (`src/features/hud/presentation.ts`).
- No event carries ammo or kill kinds. `match.snapshot` is a per-team broadcast, so per-shot data needs a new
  per-player event from the plugin (`../SLGO`) through slgo-backend IPC v1 and `@slgo/protocol` (same path as
  `10-05-hud-data-channel`). SLGO's `FirearmAmmoManager` keeps a CS2-style bound reserve per firearm (8 shop
  guns); `PlayerStatsManager` counts round kills.
- The plugin shows its own balance hint and reserves the takeover feature `hud-money`; when SLUI declares it,
  the plugin hides that hint and keeps the balance updated.
- References: `../cs2ui/panorama/.../hudhealthammocenter.*` (measurements only); recordings summarised in
  `research/cs2-bottom-hud-motion.md`.

## Requirements

- R1 Layout: CS2 bottom-centre HUD with 1080p geometry from the recordings; left block = balance, centre =
  emblem + kill cards, right block = clip + reserve. CS2's separate bottom-left money panel is not drawn; no
  health or armor display.
- R2 Balance: `$` + the local player's `loadout.money`, CS2 odometer roll per changed digit, right-aligned.
- R3 Ammo: clip and reserve rounds of the held firearm, updated per shot; CS2 shot pop, clip bar, low-ammo red
  (clip <= 20 % of capacity, from the recording). No firearm held (SCP, unarmed, Micro-HID, other items): the
  right block is empty, like CS2's knife.
- R4 Kill cards: one card per kill this round with CS2's motion (beam, emblem flash, stroke glow, number flash;
  fan for kills 1-5, counter card from kill 6); cleared when the round count resets.
- R5 Takeover: SLUI declares `hud-money` (plugin hides its balance hint) and the new `hud-status` (plugin sends
  `hud.status` only to such players).

## Decisions (user, 2026-10-07)

- D1 Colour: SLGO team colours (`ROLE_COLORS`: NTF `rgb(150, 200, 250)`, SCP `#d94652`) for every washed
  element, as in the win panel (`10-05-cs2-hud-panels` R2), not CS2's T gold / CT blue.
- D2 Kill pips: three kinds only. Grenade (explosion) kills -> `grenade`, Micro-HID kills -> `shock`, every
  other kill (headshots included) -> `default`.
- D3 Dead local player: the whole bottom HUD is hidden; it returns on respawn / the next round. No spectator
  panel.
- D4 Reserve icon: SLUI redraws (traced to ~95 % likeness) of CS2's reserve icons. Shotgun ->
  `ammo_reserve_shotgun_shell`, revolver -> `ammo_reserve_revolver_loader`, every other firearm ->
  `ammo_reserve_generic_bullet` (the single-round icon of the pre-magazine CS2 HUD: its
  `HUD--ammo-reserve--generic_bullet` rule is still in `hudhealthammocenter.css`, the current layout dropped
  the image).
- D5 Centre emblem: new SLUI-drawn NTF and SCP emblems in CS2's one-colour emblem style, by the local player's
  team.

## Acceptance Criteria

- [ ] Contract: `hud.status` example parses in slui (`npm test`), slgo-backend (`bun test`) and the plugin
      self-check; invalid inputs rejected (unknown field, bad kind/icon, negative or non-integer numbers,
      `clip_max` 0, too many kills, more than one recipient).
- [ ] Plugin: firing changes `clip` per shot, reloading moves rounds from `reserve` to `clip`, switching to a
      non-firearm sends `ammo: null`; grenade / Micro-HID / other kills produce `grenade` / `shock` / `default`;
      only players with `hud-status` receive the event; the balance hint disappears for `hud-money` players.
- [ ] SLUI mock scenes show: kills 1-14 with the fan and counter card and all three pips; a magazine emptied
      to red and reloaded; balance changes rolling; SCP side with empty right block; dead player with no HUD.
- [ ] Motion and geometry match the recordings frame by frame (numbers recorded in the research file); no text
      shadow; works at 1920x1080 and a smaller 16:9 size (`npm run bottomhud-layout-audit`).
- [ ] `npm test`, `npm run lint`, `npm run build:local`, `npm run tauri:check` pass.
- [ ] User visual review of the mock preview, then a live test on a server.

## Out of Scope

- CS2 spectator panel (observed player's name, avatar, ADR, ammo) and anything shown while dead.
- Health, armor, fire-mode icons; headshot / burn / slash pips.
- Changes to SCP:SL's native HUD (its own ammo counter stays as it is).
