import assert from "node:assert/strict";
import { DEFAULT_RADAR_PREFERENCES, RADAR_NUMERIC_RANGES } from "../src/features/minimap/preferences.ts";
import { DEFAULT_APP_SETTINGS, parseSettings, parseSettingsText, serializeSettings, SETTINGS_VERSION } from "../src/platform/settings.ts";
import { DEFAULT_AUDIO_SETTINGS } from "../src/platform/audioSettings.ts";
import {
  DEFAULT_HOTKEYS, HOTKEY_ACTIONS, hotkeyLabel, hotkeyOwner, hotkeyVirtualKey, isBindableFor, isBindableHotkey, isBindableScoreboardHotkey,
} from "../src/platform/hotkeys.ts";
import { DEFAULT_OVERLAY_SETTINGS, shouldAutoEnableOverlay } from "../src/platform/overlaySettings.ts";

// Missing or unreadable files fall back to the radar contract defaults.
for (const text of [null, undefined, "", "{", "null", "[]", "42", "\"text\""]) {
  assert.deepEqual(parseSettingsText(text), DEFAULT_APP_SETTINGS, `fallback for ${String(text)}`);
}
assert.deepEqual(parseSettings({ version: 2, radar: { hudScale: 1.2 } }), DEFAULT_APP_SETTINGS, "unknown version");
assert.deepEqual(parseSettings({ radar: { hudScale: 1.2 } }), DEFAULT_APP_SETTINGS, "missing version");
assert.deepEqual(parseSettings({ version: SETTINGS_VERSION }).radar, DEFAULT_RADAR_PREFERENCES, "missing radar");
assert.deepEqual(parseSettings({ version: SETTINGS_VERSION, radar: [] }).radar, DEFAULT_RADAR_PREFERENCES, "array radar");

// Out-of-range numbers clamp, wrong types and non-finite numbers recover per field.
const mixed = parseSettings({ version: SETTINGS_VERSION, radar: {
  hudScale: 9, mapScale: -1, backgroundAlpha: Number.NaN, alternateMapScale: "0.5",
  mapBlend: "yes", forceSquare: true, orientation: "sideways", unknownField: 1,
} });
assert.equal(mixed.radar.hudScale, RADAR_NUMERIC_RANGES.hudScale[1]);
assert.equal(mixed.radar.mapScale, RADAR_NUMERIC_RANGES.mapScale[0]);
assert.equal(mixed.radar.backgroundAlpha, DEFAULT_RADAR_PREFERENCES.backgroundAlpha);
assert.equal(mixed.radar.alternateMapScale, DEFAULT_RADAR_PREFERENCES.alternateMapScale);
assert.equal(mixed.radar.mapBlend, DEFAULT_RADAR_PREFERENCES.mapBlend);
assert.equal(mixed.radar.forceSquare, true);
assert.equal(mixed.radar.orientation, "fixed");
assert.equal("unknownField" in mixed.radar, false, "unknown fields dropped");

// Files written before hotkeys existed keep their radar block and get default hotkeys.
const legacy = parseSettings({ version: SETTINGS_VERSION, radar: { hudScale: 1.2 } });
assert.equal(legacy.radar.hudScale, 1.2);
assert.deepEqual(legacy.hotkeys, DEFAULT_HOTKEYS, "missing hotkeys");
assert.equal(DEFAULT_HOTKEYS.shop, "KeyB");
assert.deepEqual(legacy.audio, DEFAULT_AUDIO_SETTINGS, "missing audio");
assert.deepEqual(legacy.overlay, DEFAULT_OVERLAY_SETTINGS, "missing overlay");

// Auto-enable on connect: on by default, only a boolean is accepted.
assert.equal(DEFAULT_OVERLAY_SETTINGS.autoEnableOnConnect, true);
const autoOf = (overlay) => parseSettings({ version: SETTINGS_VERSION, overlay }).overlay.autoEnableOnConnect;
assert.equal(autoOf({ autoEnableOnConnect: false }), false, "a player can turn it off");
for (const autoEnableOnConnect of ["false", 0, null, undefined]) assert.equal(autoOf({ autoEnableOnConnect }), true, `recover ${String(autoEnableOnConnect)}`);
assert.equal(autoOf([]), true, "array overlay");
// Once per connection (session attempt), on reaching live; a later attempt enables again.
const on = { autoEnableOnConnect: true };
assert.equal(shouldAutoEnableOverlay(on, "live", 3, null), true);
assert.equal(shouldAutoEnableOverlay(on, "live", 3, 3), false, "a manual disable sticks for this connection");
assert.equal(shouldAutoEnableOverlay(on, "live", 4, 3), true, "the next connection enables again");
for (const status of ["not-in-game", "connecting", "baseline-required", "stale", "offline"]) {
  assert.equal(shouldAutoEnableOverlay(on, status, 3, null), false, `${status} is not connected`);
}
assert.equal(shouldAutoEnableOverlay(DEFAULT_OVERLAY_SETTINGS, "live", 3, null), true, "on by default");
assert.equal(shouldAutoEnableOverlay({ autoEnableOnConnect: false }, "live", 3, null), false, "off keeps the manual switch only");

// World blur: on at strength 1 by default; only a boolean and 1-3 are accepted.
assert.equal(DEFAULT_OVERLAY_SETTINGS.worldBlur, true);
assert.equal(DEFAULT_OVERLAY_SETTINGS.worldBlurStrength, 1);
const overlayOf = (overlay) => parseSettings({ version: SETTINGS_VERSION, overlay }).overlay;
assert.equal(overlayOf({ worldBlur: false }).worldBlur, false, "a player can turn it off");
assert.equal(overlayOf({ worldBlur: "false" }).worldBlur, true, "recover a string");
assert.equal(overlayOf({ worldBlurStrength: 3 }).worldBlurStrength, 3);
for (const worldBlurStrength of [0, 4, 1.5, "2", null]) assert.equal(overlayOf({ worldBlurStrength }).worldBlurStrength, 1, `recover ${String(worldBlurStrength)}`);
assert.equal(overlayOf({ autoEnableOnConnect: false }).worldBlur, true, "files written before the blur keep its default");

// Shop volume: 0-1 of the CS2 volumes, 15% by default; out-of-range values clamp, anything else recovers.
assert.equal(DEFAULT_AUDIO_SETTINGS.shopVolume, 0.15);
const audioOf = (audio) => parseSettings({ version: SETTINGS_VERSION, audio }).audio.shopVolume;
assert.equal(audioOf({ shopVolume: 0 }), 0);
assert.equal(audioOf({ shopVolume: 0.75 }), 0.75);
assert.equal(audioOf({ shopVolume: 1.5 }), 1);
assert.equal(audioOf({ shopVolume: -0.2 }), 0);
for (const shopVolume of [Number.NaN, Infinity, "0.5", null, undefined, true]) assert.equal(audioOf({ shopVolume }), 0.15, `recover ${String(shopVolume)}`);
assert.equal(audioOf([]), 0.15, "array audio");

// Shop and chat hotkeys: letters except R (the open shop's teammate request) and F1-F12;
// anything else recovers to the default.
for (const code of ["KeyA", "KeyB", "KeyY", "KeyU", "KeyZ", "F1", "F12"]) assert.equal(isBindableHotkey(code), true, code);
for (const code of ["KeyR", "Digit1", "Digit0", "F13", "F0", "Escape", "ShiftLeft", "b", "", 66, null]) {
  assert.equal(isBindableHotkey(code), false, String(code));
  assert.deepEqual(parseSettings({ version: SETTINGS_VERSION, hotkeys: { shop: code } }).hotkeys, DEFAULT_HOTKEYS, `recover ${String(code)}`);
  assert.deepEqual(parseSettings({ version: SETTINGS_VERSION, hotkeys: { chatTeam: code } }).hotkeys, DEFAULT_HOTKEYS, `recover chat ${String(code)}`);
}
assert.deepEqual(parseSettings({ version: SETTINGS_VERSION, hotkeys: [] }).hotkeys, DEFAULT_HOTKEYS, "array hotkeys");
// Virtual-key codes must match the Rust hook (is_bindable_hotkey).
assert.equal(hotkeyVirtualKey("KeyA"), 0x41);
assert.equal(hotkeyVirtualKey("KeyB"), 0x42);
assert.equal(hotkeyVirtualKey("KeyU"), 0x55);
assert.equal(hotkeyVirtualKey("KeyY"), 0x59);
assert.equal(hotkeyVirtualKey("KeyZ"), 0x5a);
assert.equal(hotkeyVirtualKey("F1"), 0x70);
assert.equal(hotkeyVirtualKey("F12"), 0x7b);
assert.equal(hotkeyVirtualKey("Digit1"), null);
assert.equal(hotkeyLabel("KeyG"), "G");
assert.equal(hotkeyLabel("F5"), "F5");

// Scoreboard key (held): the shop's keys plus CapsLock (Rust is_bindable_scoreboard_hotkey).
assert.deepEqual(DEFAULT_HOTKEYS, { shop: "KeyB", scoreboard: "CapsLock", chatGlobal: "KeyY", chatTeam: "KeyU" });
assert.deepEqual(HOTKEY_ACTIONS, ["shop", "scoreboard", "chatGlobal", "chatTeam"], "the order set_hotkeys takes them in");
for (const code of ["CapsLock", "KeyA", "KeyT", "KeyY", "F1", "F12"]) assert.equal(isBindableScoreboardHotkey(code), true, code);
for (const code of ["Tab", "KeyR", "Digit1", "ShiftLeft", "", null]) assert.equal(isBindableScoreboardHotkey(code), false, String(code));
assert.equal(isBindableHotkey("CapsLock"), false, "CapsLock never opens the shop or a chat");
assert.equal(isBindableFor("scoreboard", "CapsLock"), true);
assert.equal(isBindableFor("chatGlobal", "CapsLock"), false);

// All four keys different; a key taken by an earlier action recovers to its own default
// (Rust validate_hotkeys rejects any shared key).
const hotkeysOf = (hotkeys) => parseSettings({ version: SETTINGS_VERSION, hotkeys }).hotkeys;
const withKeys = (keys) => ({ ...DEFAULT_HOTKEYS, ...keys });
assert.deepEqual(hotkeysOf({ shop: "KeyB", scoreboard: "KeyT" }), withKeys({ scoreboard: "KeyT" }), "files from before the chat keys");
assert.deepEqual(hotkeysOf({ shop: "KeyT", scoreboard: "KeyT" }), withKeys({ shop: "KeyT" }), "a shared key goes back to CapsLock");
assert.deepEqual(hotkeysOf({ shop: "F3", scoreboard: "Tab" }), withKeys({ shop: "F3" }));
assert.deepEqual(hotkeysOf({ shop: "F3" }), withKeys({ shop: "F3" }), "files from before the scoreboard key");
assert.deepEqual(hotkeysOf(withKeys({ chatGlobal: "KeyT", chatTeam: "F2" })), withKeys({ chatGlobal: "KeyT", chatTeam: "F2" }));
assert.deepEqual(hotkeysOf(withKeys({ shop: "KeyY", chatGlobal: "KeyT" })), withKeys({ shop: "KeyY", chatGlobal: "KeyT" }),
  "Y may open the shop once global chat moved");
assert.deepEqual(hotkeysOf(withKeys({ chatTeam: "KeyY" })), DEFAULT_HOTKEYS, "both chats on Y: team chat goes back to U");
assert.deepEqual(hotkeysOf(withKeys({ chatGlobal: "KeyB" })), DEFAULT_HOTKEYS, "global chat on the shop key goes back to Y");
assert.deepEqual(hotkeysOf({ shop: "KeyY", scoreboard: "KeyB" }), DEFAULT_HOTKEYS,
  "Y opens the shop, so global chat cannot have its default: every key goes back");
assert.deepEqual(hotkeysOf(withKeys({ chatGlobal: "CapsLock" })), DEFAULT_HOTKEYS, "CapsLock is the scoreboard's alone");
assert.equal(hotkeyVirtualKey("CapsLock"), 0x14);
assert.equal(hotkeyLabel("CapsLock"), "Caps Lock");

// The settings page names the action that already holds a key.
assert.equal(hotkeyOwner(DEFAULT_HOTKEYS, "KeyU", "shop"), "chatTeam");
assert.equal(hotkeyOwner(DEFAULT_HOTKEYS, "KeyU", "chatTeam"), null, "a key is never taken from itself");
assert.equal(hotkeyOwner(DEFAULT_HOTKEYS, "KeyT"), null);

// Round trip keeps all eleven preferences plus the overlay, hotkeys and audio blocks.
const custom = {
  overlay: { autoEnableOnConnect: false, worldBlur: false, worldBlurStrength: 2 },
  radar: { ...DEFAULT_RADAR_PREFERENCES, orientation: "heading-up", mapScale: 0.25, hudScale: 1.1, dynamicZoom: true },
  hotkeys: { shop: "F3", scoreboard: "KeyT", chatGlobal: "KeyY", chatTeam: "F4" },
  audio: { shopVolume: 0.55 },
};
const text = serializeSettings(custom);
assert.deepEqual(Object.keys(JSON.parse(text)), ["version", "overlay", "radar", "hotkeys", "audio"]);
assert.deepEqual(parseSettingsText(text), custom);
assert.equal(Object.keys(parseSettingsText(text).radar).length, 11);

console.log("settings smoke: fallback, version, clamping, per-field recovery, hotkeys, audio, overlay auto-enable, world blur and round trip ok");
