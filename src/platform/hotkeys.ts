// Global overlay hotkeys, stored as KeyboardEvent.code values and matched in
// Rust by Windows virtual-key code. Rust validates the same set (lib.rs).

export type HotkeyCode = string;

export type HotkeySettings = Readonly<{ shop: HotkeyCode; scoreboard: HotkeyCode }>;

// CS2 opens its buy menu with B. It holds Tab for the scoreboard, which SCP:SL uses
// for the inventory, so the scoreboard takes CapsLock like the plugin's own binding.
export const DEFAULT_HOTKEYS: HotkeySettings = { shop: "KeyB", scoreboard: "CapsLock" };

// Y (global) and U (team) are the fixed chat keys and digits select shop items,
// so none of them can open the shop.
const RESERVED: ReadonlySet<HotkeyCode> = new Set(["KeyY", "KeyU"]);

const LETTER = /^Key([A-Z])$/;
const FUNCTION = /^F([1-9]|1[0-2])$/;
const CAPS_LOCK = "CapsLock";

/** A key the shop may use: letters except Y and U, F1-F12. */
export function isBindableHotkey(code: unknown): code is HotkeyCode {
  return typeof code === "string" && !RESERVED.has(code) && (LETTER.test(code) || FUNCTION.test(code));
}

/** A key the scoreboard may use: the shop's keys plus CapsLock. */
export function isBindableScoreboardHotkey(code: unknown): code is HotkeyCode {
  return code === CAPS_LOCK || isBindableHotkey(code);
}

/** Each key valid for its action and the two different; anything else falls back per key to the defaults. */
export function normalizeHotkeys(value: Partial<Record<keyof HotkeySettings, unknown>> | null | undefined): HotkeySettings {
  const shop = isBindableHotkey(value?.shop) ? value.shop : DEFAULT_HOTKEYS.shop;
  // The default scoreboard key (CapsLock) can never be a shop key, so the pair stays distinct.
  const scoreboard = isBindableScoreboardHotkey(value?.scoreboard) && value.scoreboard !== shop ? value.scoreboard : DEFAULT_HOTKEYS.scoreboard;
  return { shop, scoreboard };
}

export function hotkeyLabel(code: HotkeyCode): string {
  if (code === CAPS_LOCK) return "Caps Lock";
  return LETTER.exec(code)?.[1] ?? code;
}

// Windows virtual-key codes: letters are their ASCII capitals, F1 is 0x70, CapsLock 0x14.
export function hotkeyVirtualKey(code: HotkeyCode): number | null {
  if (code === CAPS_LOCK) return 0x14;
  const letter = LETTER.exec(code);
  if (letter) return letter[1].charCodeAt(0);
  const fn = FUNCTION.exec(code);
  return fn ? 0x6f + Number(fn[1]) : null;
}
