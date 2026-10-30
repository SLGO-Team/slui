import assert from "node:assert/strict";
import {
  createNativeGameConditionsSource,
  inputBlockedBy,
  NO_GAME_CONDITIONS,
  relaunchElevated,
  subscribeGameConditions,
} from "../src/platform/gameConditions.ts";
import {
  activeGameConditions,
  CONDITION_HINT_MS,
  CONDITION_HINT_TEXTS,
  claimedFeatures,
  gameConditionBanners,
  INPUT_CLIENT_FEATURES,
  nextConditionHint,
  RELAUNCH_IDLE,
  RELAUNCH_LABEL,
  startConditionHint,
  withConditionHint,
} from "../src/app/gameConditionsModel.ts";
import { readGameConditionsPreview } from "../src/mocks/gameConditionsPreview.ts";
import {
  CLIENT_FEATURE_CHAT_INPUT,
  CLIENT_FEATURE_HUD_KILLFEED,
  CLIENT_FEATURE_HUD_MESSAGES,
  CLIENT_FEATURE_SCOREBOARD,
  CLIENT_FEATURE_SHOP_MENU,
  CLIENT_FEATURE_TEAM_SELECT,
  CLIENT_FEATURE_TOP_HUD,
} from "../src/contracts/index.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function nativeFixture() {
  const registration = deferred();
  const snapshot = deferred();
  let callback;
  let cleanupCount = 0;
  let snapshotCount = 0;
  const source = createNativeGameConditionsSource({
    listen(listener) { callback = listener; return registration.promise; },
    getSnapshot() { snapshotCount += 1; return snapshot.promise; },
  });
  return {
    source, snapshot,
    register: () => registration.resolve(() => { cleanupCount += 1; }),
    emit: (conditions) => callback(conditions),
    get cleanupCount() { return cleanupCount; },
    get snapshotCount() { return snapshotCount; },
  };
}
const conditions = (elevatedGame, exclusiveFullscreen, revision) => ({ elevatedGame, exclusiveFullscreen, revision });

// ---- Native source: listen first, then query; revisions only move forward; a malformed frame fails closed ----
{
  const race = nativeFixture();
  const observed = [];
  const stop = race.source.subscribeGameConditions((value) => observed.push(value));
  assert.deepEqual(observed, [NO_GAME_CONDITIONS]);
  assert.equal(race.snapshotCount, 0, "snapshot waits for listener registration");
  race.register();
  await flush();
  race.emit(conditions(false, true, 3));
  race.snapshot.resolve(conditions(false, false, 2));
  await flush();
  assert.deepEqual(observed.at(-1), conditions(false, true, 3), "a late snapshot cannot revert the verdict");
  race.emit(conditions(true, true, 3));
  race.emit(conditions(true, true, 1));
  assert.equal(observed.length, 2, "duplicate and old revisions are ignored");
  race.emit(conditions(true, false, 4));
  assert.deepEqual(observed.at(-1), conditions(true, false, 4));
  stop();
  stop();
  race.emit(conditions(false, false, 5));
  assert.equal(race.cleanupCount, 1);
  assert.equal(observed.length, 3, "no delivery after disposal");
}
{
  const warnings = [];
  const originalError = console.error;
  console.error = (...args) => warnings.push(args);
  try {
    const malformed = nativeFixture();
    const states = [];
    malformed.source.subscribeGameConditions((value) => states.push(value));
    malformed.register();
    await flush();
    malformed.emit(conditions(false, true, 2));
    malformed.emit({ elevatedGame: true, exclusiveFullscreen: false, revision: 3, extra: 1 });
    assert.deepEqual(states.at(-1), conditions(false, false, 3), "a malformed frame drops back to no condition");
    malformed.emit(conditions(true, true, 9));
    assert.equal(states.at(-1).elevatedGame, false, "a failed source stays closed");
    assert.equal(malformed.cleanupCount, 1);

    const failed = nativeFixture();
    const failedStates = [];
    failed.source.subscribeGameConditions((value) => failedStates.push(value));
    failed.register();
    await flush();
    failed.snapshot.reject(new Error("native query failed"));
    await flush();
    assert.deepEqual(failedStates.at(-1), conditions(false, false, 1));
    assert.equal(warnings.length, 2, "failures are diagnosed");
  } finally {
    console.error = originalError;
  }
}
{
  const browser = [];
  subscribeGameConditions((value) => browser.push(value))();
  assert.deepEqual(browser, [NO_GAME_CONDITIONS], "a browser preview has no game conditions");
}

// ---- Hand-back: the input features go back to the plugin, the passive ones stay ----
{
  assert.equal(inputBlockedBy(NO_GAME_CONDITIONS), false);
  assert.equal(inputBlockedBy(conditions(true, false, 1)), true, "elevated game");
  assert.equal(inputBlockedBy(conditions(false, true, 1)), true, "exclusive fullscreen");
  const all = [CLIENT_FEATURE_CHAT_INPUT, CLIENT_FEATURE_SHOP_MENU, CLIENT_FEATURE_TOP_HUD, CLIENT_FEATURE_HUD_MESSAGES,
    CLIENT_FEATURE_HUD_KILLFEED, CLIENT_FEATURE_SCOREBOARD, CLIENT_FEATURE_TEAM_SELECT];
  assert.deepEqual([...INPUT_CLIENT_FEATURES].sort(), [CLIENT_FEATURE_CHAT_INPUT, CLIENT_FEATURE_SHOP_MENU, CLIENT_FEATURE_TEAM_SELECT].sort());
  assert.deepEqual(claimedFeatures(all, true, false), all, "nothing blocked: every feature");
  assert.deepEqual(claimedFeatures(all, true, true),
    [CLIENT_FEATURE_TOP_HUD, CLIENT_FEATURE_HUD_MESSAGES, CLIENT_FEATURE_HUD_KILLFEED, CLIENT_FEATURE_SCOREBOARD],
    "blocked: the HUD, killfeed and scoreboard stay with SLUI");
  assert.deepEqual(claimedFeatures(all, false, false), [], "a disabled overlay claims nothing");
  assert.deepEqual(claimedFeatures(all, false, true), []);
}

// ---- In-game hint: once per condition, only in an empty high-hint slot, gone after its time ----
{
  assert.deepEqual(activeGameConditions(conditions(true, true, 1)), ["elevated-game", "exclusive-fullscreen"]);
  assert.equal(nextConditionHint(NO_GAME_CONDITIONS, new Set()), null);
  assert.equal(nextConditionHint(conditions(true, true, 1), new Set()), "elevated-game");
  assert.equal(nextConditionHint(conditions(true, true, 1), new Set(["elevated-game"])), "exclusive-fullscreen");
  assert.equal(nextConditionHint(conditions(false, true, 1), new Set(["exclusive-fullscreen"])), null, "once per run");

  const empty = { alert: null, hintHigh: null, hintLow: null };
  const hint = startConditionHint("exclusive-fullscreen", 1_000);
  assert.deepEqual(hint, { condition: "exclusive-fullscreen", shownAtMs: 1_000, expiresAtMs: 1_000 + CONDITION_HINT_MS });
  const shown = withConditionHint(empty, hint, 2_000);
  assert.equal(shown.hintHigh.slot, "hint_high");
  assert.equal(shown.hintHigh.text, CONDITION_HINT_TEXTS["exclusive-fullscreen"]);
  assert.equal(shown.hintHigh.tone, "default");
  assert.equal(shown.hintHigh.flash, null);
  assert.equal(shown.hintHigh.expiresAtMs, hint.expiresAtMs, "the slot plays its exit at the hint's own expiry");
  assert.equal(shown.alert, null);
  assert.equal(withConditionHint(empty, hint, hint.expiresAtMs), empty, "gone after its time");
  assert.equal(withConditionHint(empty, null, 2_000), empty);
  const plugin = { ...empty, hintHigh: { slot: "hint_high", id: "hint_high-1", key: "SLGO_Hint", text: "plugin", tone: "warning", flash: null, shownAtMs: 0, expiresAtMs: null } };
  assert.equal(withConditionHint(plugin, hint, 2_000), plugin, "the plugin's own high hint wins the slot");
  for (const text of Object.values(CONDITION_HINT_TEXTS)) assert.ok(text.length <= 32, `two hint lines at most: ${text}`);
}

// ---- Home banners and the relaunch action ----
{
  assert.deepEqual(gameConditionBanners(NO_GAME_CONDITIONS, RELAUNCH_IDLE), []);
  const [elevated, exclusive] = gameConditionBanners(conditions(true, true, 1), RELAUNCH_IDLE);
  assert.equal(elevated.condition, "elevated-game");
  assert.deepEqual(elevated.action, { label: RELAUNCH_LABEL, busy: false });
  assert.equal(exclusive.condition, "exclusive-fullscreen");
  assert.equal(exclusive.action, null, "nothing for SLUI to do; the game's display setting fixes it");
  assert.match(exclusive.detail, /无边框/);
  const [busy] = gameConditionBanners(conditions(true, false, 1), { phase: "busy" });
  assert.equal(busy.action.busy, true, "one UAC prompt at a time");
  assert.match(gameConditionBanners(conditions(true, false, 1), { phase: "cancelled" })[0].detail, /已取消/);
  assert.match(gameConditionBanners(conditions(true, false, 1), { phase: "failed", reason: "error 2" })[0].detail, /error 2/);

  assert.equal(await relaunchElevated(async () => undefined), "started");
  assert.equal(await relaunchElevated(async () => { throw "cancelled"; }), "cancelled", "Tauri rejects with the command's string");
  await assert.rejects(relaunchElevated(async () => { throw "Windows did not start SLUI elevated (error 2)"; }), /error 2/);
  await assert.rejects(relaunchElevated(null), /仅桌面版可用/, "a browser preview cannot relaunch");

  assert.equal(readGameConditionsPreview(""), null);
  assert.equal(readGameConditionsPreview("?gameConditions=other"), null);
  assert.deepEqual(readGameConditionsPreview("?gameConditions=both&relaunch=cancelled"),
    { conditions: conditions(true, true, 1), relaunch: { phase: "cancelled" } });
}

console.log("Game conditions smoke checks passed.");
