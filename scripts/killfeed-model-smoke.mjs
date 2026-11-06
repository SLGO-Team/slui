import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { HUD_KILLFEED_ASSIST_KINDS, HUD_KILLFEED_WEAPONS, parseHudKillfeed } from "../packages/protocol/src/index.ts";
import { createHudSceneFrame, hudSceneLoopMs } from "../src/mocks/hudScenes.ts";
import { ROLE_COLORS } from "../src/shared/roleColors.ts";
import { initialKillfeedState, KILLFEED_FADE_MS, killfeedReducer, sameKillfeedTime, selectKillfeed } from "../src/features/killfeed/model.ts";
import {
  KILLFEED_ASSIST_ICONS,
  KILLFEED_BLIND_ICON,
  KILLFEED_FALLBACK_WEAPONS,
  KILLFEED_HEADSHOT_ICON,
  KILLFEED_SKULL_ICON,
  KILLFEED_SUICIDE_ICON,
  KILLFEED_TEAM_COLORS,
  KILLFEED_UNASSIGNED_COLOR,
  KILLFEED_WEAPON_ICONS,
  killfeedNameColor,
  killfeedWeaponIcon,
} from "../src/features/killfeed/presentation.ts";

// Killfeed (`hud.killfeed`): replace-on-copy, first-seen time across replays, local fade, round clear, instance
// changes, icons and colours.

let sequence = 0;
const envelope = (type, payload, instance = "instance-a") => ({
  protocol_version: 0,
  schema_version: 1,
  event_id: `${type}-${++sequence}`,
  server_id: "server-a",
  instance_id: instance,
  sequence,
  type,
  sent_at: "2026-10-18T12:00:00.000Z",
  payload,
});
const baseline = (instance = "instance-a") => envelope("sidecar.baseline", { baseline: true }, instance);
const player = (id, name, team) => ({ player_id: id, display_name: name, team });
const NOVA = player("76561198000000001", "Nova", "ntf");
const ECHO = player("76561198000000005", "Echo", "scp");
const LIMA = player("76561198000000002", "Lima", "ntf");
const kill = (entryId, overrides = {}) => ({
  entry_id: entryId,
  suicide: false,
  killer: NOVA,
  assister: null,
  victim: ECHO,
  weapon: "e11sr",
  headshot: false,
  viewer: null,
  visible_remaining_ms: 5_000,
  ...overrides,
});
const feed = (...entries) => envelope("hud.killfeed", { entries });
const event = (value, receivedAtMs) => ({ type: "event", event: value, receivedAtMs });

{
  // A copy replaces the feed; an entry keeps its first-seen time and takes the new remaining time.
  let state = killfeedReducer(initialKillfeedState, event(baseline(), 0));
  state = killfeedReducer(state, event(feed(kill("kill-1")), 1_000));
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].fadeAtMs, 6_000);
  state = killfeedReducer(state, event(feed(kill("kill-1", { visible_remaining_ms: 3_000 }), kill("kill-2", { victim: LIMA })), 3_000));
  assert.deepEqual(state.items.map((item) => item.entry.entry_id), ["kill-1", "kill-2"]);
  assert.equal(state.items[0].firstSeenAtMs, 1_000, "a replayed entry keeps its first-seen time");
  assert.equal(state.items[0].fadeAtMs, 6_000);
  assert.equal(state.items[1].firstSeenAtMs, 3_000);

  // Shown until its fade-out has finished.
  assert.equal(selectKillfeed(state, 6_999).length, 2);
  assert.deepEqual(selectKillfeed(state, 6_000 + KILLFEED_FADE_MS).map((view) => view.id), ["kill-2"]);
  // The overlay clock keeps the drawn list while the same notices stay (KillFeed re-renders only when one leaves).
  assert.equal(sameKillfeedTime(selectKillfeed(state, 4_000), selectKillfeed(state, 6_999)), true);
  assert.equal(sameKillfeedTime(selectKillfeed(state, 4_000), selectKillfeed(state, 6_000 + KILLFEED_FADE_MS)), false);

  // An entry the next copy leaves out while it is fading finishes its fade; one still on screen goes at once.
  const fading = killfeedReducer(state, event(feed(kill("kill-2", { victim: LIMA, visible_remaining_ms: 1_500 })), 6_500));
  assert.deepEqual(fading.items.map((item) => item.entry.entry_id), ["kill-1", "kill-2"]);
  const cleared = killfeedReducer(state, event(feed(), 4_000));
  assert.deepEqual(cleared.items, [], "a new round clears the feed at once");

  // Events of another instance are ignored; a new baseline from another instance clears; an ended session clears.
  assert.equal(killfeedReducer(state, event(envelope("hud.killfeed", { entries: [] }, "instance-b"), 4_000)), state, "another instance's feed is ignored");
  assert.deepEqual(killfeedReducer(state, event(baseline("instance-b"), 4_000)).items, []);
  assert.equal(killfeedReducer(state, event(baseline(), 4_000)), state, "a reconnect to the same instance keeps the feed");
  assert.equal(killfeedReducer(state, { type: "connection", status: "stale" }), state);
  assert.equal(killfeedReducer(state, { type: "connection", status: "ended" }), initialKillfeedState);
  for (const status of ["not-in-game", "game-not-running"]) assert.equal(killfeedReducer(state, { type: "connection", status }), initialKillfeedState, `${status} ends the match`);
  assert.equal(killfeedReducer(initialKillfeedState, event(feed(kill("kill-9")), 0)), initialKillfeedState, "no feed before a baseline");
}

{
  // Modifiers: the assist kind draws its icon before the assister (CS2 assistedflash), a blind killer the blind icon
  // before the killer (CS2 attackerblind); the legacy assisted_flash reads as the flash kind.
  let state = killfeedReducer(initialKillfeedState, event(baseline(), 0));
  state = killfeedReducer(state, event(feed(
    ...HUD_KILLFEED_ASSIST_KINDS.map((assist_kind, index) => kill(`kill-${index}`, { assister: LIMA, assist_kind })),
    kill("kill-legacy", { assister: LIMA, assisted_flash: true }),
    kill("kill-blind", { attacker_blind: true }),
  ), 0));
  const views = selectKillfeed(state, 100);
  assert.deepEqual(views.map((view) => view.assistKind), [...HUD_KILLFEED_ASSIST_KINDS, "flash", null]);
  assert.deepEqual(views.map((view) => view.attackerBlind), [false, false, false, false, false, true]);
  assert.equal(views[0].assister.name, "Lima");
  assert.equal(KILLFEED_ASSIST_ICONS.flash, "/assets/killfeed/flash-assist.svg", "no longer the shop's flashbang silhouette");
}

{
  // Views: suicide has no weapon (skull instead), names in side colours, unassigned grey.
  let state = killfeedReducer(initialKillfeedState, event(baseline(), 0));
  state = killfeedReducer(state, event(feed(
    kill("kill-1", { assister: LIMA, headshot: true, viewer: "killer", visible_remaining_ms: 7_500 }),
    kill("kill-2", { suicide: true, killer: NOVA, weapon: "other", victim: NOVA, viewer: "victim", visible_remaining_ms: 7_500 }),
    kill("kill-3", { killer: player(null, "Dummy", null), weapon: "com45" }),
    kill("kill-4", { suicide: true, killer: null, weapon: "other", victim: ECHO }),
  ), 0));
  const [own, suicide, dummy, world] = selectKillfeed(state, 100);
  assert.equal(own.viewer, "killer");
  assert.equal(own.headshot, true);
  assert.equal(own.assister.name, "Lima");
  assert.equal(own.assistKind, null, "a damage assist has no icon");
  assert.equal(own.attackerBlind, false);
  assert.equal(own.killer.color, "#6f9ce6", "NTF in CS2's CT blue");
  assert.equal(own.victim.color, ROLE_COLORS.scp, "SCP keeps the SLGO red (user decision 2026-10-18)");
  assert.equal(own.weaponIcon, KILLFEED_WEAPON_ICONS.e11sr);
  assert.equal(own.suicide, false);
  assert.equal(suicide.suicide, true);
  assert.equal(suicide.killer.name, "Nova", "a self-kill names the player twice, as in CS2");
  assert.equal(suicide.weaponIcon, null, "CS2 hides the weapon of a suicide");
  assert.equal(suicide.viewer, "victim");
  assert.equal(world.killer, null, "a death without an attacker is the skull and the victim");
  assert.equal(world.weaponIcon, null);
  assert.equal(dummy.killer.color, KILLFEED_UNASSIGNED_COLOR);
  assert.equal(dummy.weaponIcon, KILLFEED_SKULL_ICON, "a weapon without artwork falls back to the skull");
}

{
  // Icons: every artwork file exists; every other wire id is a fallback.
  const publicPath = (url) => new URL(`../public${url}`, import.meta.url);
  for (const [weapon, url] of Object.entries(KILLFEED_WEAPON_ICONS)) {
    assert.ok(HUD_KILLFEED_WEAPONS.includes(weapon), weapon);
    assert.ok(existsSync(publicPath(url)), url);
  }
  assert.ok(existsSync(publicPath(KILLFEED_SKULL_ICON)));
  assert.ok(existsSync(publicPath(KILLFEED_HEADSHOT_ICON)));
  assert.ok(existsSync(publicPath(KILLFEED_SUICIDE_ICON)));
  assert.ok(existsSync(publicPath(KILLFEED_BLIND_ICON)));
  assert.deepEqual(Object.keys(KILLFEED_ASSIST_ICONS), [...HUD_KILLFEED_ASSIST_KINDS]);
  for (const url of Object.values(KILLFEED_ASSIST_ICONS)) assert.ok(existsSync(publicPath(url)), url);
  assert.notEqual(KILLFEED_SUICIDE_ICON, KILLFEED_SKULL_ICON, "the weapon fallback never reads as a suicide");
  assert.equal(Object.keys(KILLFEED_WEAPON_ICONS).length + KILLFEED_FALLBACK_WEAPONS.length, HUD_KILLFEED_WEAPONS.length);
  assert.deepEqual([...KILLFEED_FALLBACK_WEAPONS].sort(), ["a7", "com45", "jailbird", "other", "particle_disruptor", "revolver", "scp018", "scp127", "shotgun"]);
  for (const weapon of KILLFEED_FALLBACK_WEAPONS) assert.equal(killfeedWeaponIcon(weapon), KILLFEED_SKULL_ICON);
  assert.equal(killfeedNameColor("scp"), KILLFEED_TEAM_COLORS.scp);
  assert.equal(killfeedNameColor(null), KILLFEED_UNASSIGNED_COLOR);
}

{
  // The `killfeed` mock scene: valid frames, the full stack around 7 s, the viewer's notices outlive the rest.
  for (const viewerRole of ["ntf", "scp"]) {
    const loopMs = hudSceneLoopMs("killfeed", viewerRole);
    for (let elapsedMs = 0; elapsedMs <= loopMs; elapsedMs += 250) {
      assert.equal(parseHudKillfeed(createHudSceneFrame("killfeed", viewerRole, elapsedMs, 1).killfeed).ok, true, `${viewerRole} at ${elapsedMs}`);
    }
  }
  const stack = createHudSceneFrame("killfeed", "ntf", 7_100, 1).killfeed.entries;
  assert.deepEqual(stack.map((entry) => entry.viewer), ["killer", null, null, null, null, "victim"]);
  assert.deepEqual(stack.map((entry) => entry.suicide), [false, true, false, false, true, false]);
  assert.equal(stack[0].headshot, true);
  assert.equal(stack[0].assister.display_name, "Cipher");
  assert.equal(stack[1].killer.display_name, stack[1].victim.display_name, "the self-kill");
  assert.equal(stack[2].weapon, "com45");
  assert.equal(stack[4].killer, null, "the death without an attacker");
  assert.equal(createHudSceneFrame("killfeed", "scp", 7_100, 1).killfeed.entries[0].headshot, false, "SCP attacks are no headshots");
  assert.deepEqual(createHudSceneFrame("win-mvp-kills", "ntf", 0).killfeed, { entries: [] });
}

{
  // The `killfeed-modifiers` mock scene: valid frames; around 3 s every assist icon and the blind icon are on screen
  // for either viewer side, with the viewer's own kill and death.
  for (const viewerRole of ["ntf", "scp"]) {
    const loopMs = hudSceneLoopMs("killfeed-modifiers", viewerRole);
    for (let elapsedMs = 0; elapsedMs <= loopMs; elapsedMs += 250) {
      assert.equal(parseHudKillfeed(createHudSceneFrame("killfeed-modifiers", viewerRole, elapsedMs, 1).killfeed).ok, true, `${viewerRole} at ${elapsedMs}`);
    }
    const stack = createHudSceneFrame("killfeed-modifiers", viewerRole, 3_000, 1).killfeed.entries;
    assert.equal(stack.length, 8, viewerRole);
    assert.deepEqual(new Set(stack.map((entry) => entry.assist_kind).filter(Boolean)), new Set(HUD_KILLFEED_ASSIST_KINDS), viewerRole);
    assert.ok(stack.some((entry) => entry.attacker_blind && entry.viewer === "killer"), `${viewerRole}: the viewer's blind kill`);
    assert.ok(stack.some((entry) => entry.attacker_blind && entry.viewer === "victim"), `${viewerRole}: the viewer's death to a blind killer`);
    assert.ok(stack.some((entry) => entry.assister !== null && entry.assist_kind === undefined), `${viewerRole}: a damage assist`);
    assert.ok(stack.some((entry) => entry.suicide), `${viewerRole}: a self-kill`);
    assert.ok(stack.every((entry) => entry.assisted_flash === undefined), "the mock speaks the current keys");
  }
  const ntf = createHudSceneFrame("killfeed-modifiers", "ntf", 3_000, 1).killfeed.entries;
  assert.ok(ntf.some((entry) => entry.attacker_blind && entry.assist_kind && entry.headshot), "blind + assist icon + headshot");
}

console.log("killfeed model smoke passed");
