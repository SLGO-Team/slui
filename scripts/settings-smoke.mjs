import assert from "node:assert/strict";
import { DEFAULT_RADAR_PREFERENCES, RADAR_NUMERIC_RANGES } from "../src/features/minimap/preferences.ts";
import { DEFAULT_APP_SETTINGS, parseSettings, parseSettingsText, serializeSettings, SETTINGS_VERSION } from "../src/platform/settings.ts";
import { DEFAULT_AUDIO_SETTINGS } from "../src/platform/audioSettings.ts";
import { DEFAULT_HOTKEYS, hotkeyLabel, hotkeyVirtualKey, isBindableHotkey } from "../src/platform/hotkeys.ts";
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

// Shop volume: 0-1 of the CS2 volumes, 15% by default; out-of-range values clamp, anything else recovers.
assert.equal(DEFAULT_AUDIO_SETTINGS.shopVolume, 0.15);
const audioOf = (audio) => parseSettings({ version: SETTINGS_VERSION, audio }).audio.shopVolume;
assert.equal(audioOf({ shopVolume: 0 }), 0);
assert.equal(audioOf({ shopVolume: 0.75 }), 0.75);
assert.equal(audioOf({ shopVolume: 1.5 }), 1);
assert.equal(audioOf({ shopVolume: -0.2 }), 0);
for (const shopVolume of [Number.NaN, Infinity, "0.5", null, undefined, true]) assert.equal(audioOf({ shopVolume }), 0.15, `recover ${String(shopVolume)}`);
assert.equal(audioOf([]), 0.15, "array audio");

// Shop hotkey: letters except the chat keys Y and U, and F1-F12; anything else recovers to the default.
for (const code of ["KeyA", "KeyB", "KeyZ", "F1", "F12"]) assert.equal(isBindableHotkey(code), true, code);
for (const code of ["KeyY", "KeyU", "Digit1", "Digit0", "F13", "F0", "Escape", "ShiftLeft", "b", "", 66, null]) {
  assert.equal(isBindableHotkey(code), false, String(code));
  assert.deepEqual(parseSettings({ version: SETTINGS_VERSION, hotkeys: { shop: code } }).hotkeys, DEFAULT_HOTKEYS, `recover ${String(code)}`);
}
assert.deepEqual(parseSettings({ version: SETTINGS_VERSION, hotkeys: [] }).hotkeys, DEFAULT_HOTKEYS, "array hotkeys");
// Virtual-key codes must match the Rust hook (is_bindable_shop_hotkey).
assert.equal(hotkeyVirtualKey("KeyA"), 0x41);
assert.equal(hotkeyVirtualKey("KeyB"), 0x42);
assert.equal(hotkeyVirtualKey("KeyZ"), 0x5a);
assert.equal(hotkeyVirtualKey("F1"), 0x70);
assert.equal(hotkeyVirtualKey("F12"), 0x7b);
assert.equal(hotkeyVirtualKey("Digit1"), null);
assert.equal(hotkeyLabel("KeyG"), "G");
assert.equal(hotkeyLabel("F5"), "F5");

// Round trip keeps all eleven preferences plus the overlay, hotkeys and audio blocks.
const custom = {
  overlay: { autoEnableOnConnect: false },
  radar: { ...DEFAULT_RADAR_PREFERENCES, orientation: "heading-up", mapScale: 0.25, hudScale: 1.1, dynamicZoom: true },
  hotkeys: { shop: "F3" },
  audio: { shopVolume: 0.55 },
};
const text = serializeSettings(custom);
assert.deepEqual(Object.keys(JSON.parse(text)), ["version", "overlay", "radar", "hotkeys", "audio"]);
assert.deepEqual(parseSettingsText(text), custom);
assert.equal(Object.keys(parseSettingsText(text).radar).length, 11);

console.log("settings smoke: fallback, version, clamping, per-field recovery, hotkeys, audio, overlay auto-enable and round trip ok");
