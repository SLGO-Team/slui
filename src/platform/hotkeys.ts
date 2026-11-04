// Global overlay hotkeys, stored as KeyboardEvent.code values and matched in
// Rust by Windows virtual-key code. Rust validates the same set (lib.rs).

export type HotkeyCode = string;

export type HotkeyAction = "shop" | "scoreboard" | "chatGlobal" | "chatTeam";

export type HotkeySettings = Readonly<Record<HotkeyAction, HotkeyCode>>;

/** Every configurable key, in the order normalizeHotkeys keeps them when two collide. */
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = ["shop", "scoreboard", "chatGlobal", "chatTeam"];

// CS2 opens its buy menu with B and its chats with Y (all) and U (team). It holds Tab
// for the scoreboard, which SCP:SL uses for the inventory, so the scoreboard takes
// CapsLock like the plugin's own binding.
export const DEFAULT_HOTKEYS: HotkeySettings = { shop: "KeyB", scoreboard: "CapsLock", chatGlobal: "KeyY", chatTeam: "KeyU" };

const LETTER = /^Key([A-Z])$/;
const FUNCTION = /^F([1-9]|1[0-2])$/;
const CAPS_LOCK = "CapsLock";
// The open shop requests the hovered item for a teammate with R, and selects items with digits.
const SHOP_REQUEST = "KeyR";

/** A key any action may use: letters except R, and F1-F12. Digits and R belong to the open shop. */
export function isBindableHotkey(code: unknown): code is HotkeyCode {
  return typeof code === "string" && code !== SHOP_REQUEST && (LETTER.test(code) || FUNCTION.test(code));
}

/** A key the scoreboard may use: the shop's keys plus CapsLock. */
export function isBindableScoreboardHotkey(code: unknown): code is HotkeyCode {
  return code === CAPS_LOCK || isBindableHotkey(code);
}

export function isBindableFor(action: HotkeyAction, code: unknown): code is HotkeyCode {
  return action === "scoreboard" ? isBindableScoreboardHotkey(code) : isBindableHotkey(code);
}

/** The action other than `except` that already uses `code`, if any. */
export function hotkeyOwner(hotkeys: HotkeySettings, code: HotkeyCode, except?: HotkeyAction): HotkeyAction | null {
  return HOTKEY_ACTIONS.find((action) => action !== except && hotkeys[action] === code) ?? null;
}

/**
 * Each key valid for its action and all four different. A key that is invalid, or taken by
 * an earlier action, falls back to its default; when that default is taken too (only a
 * hand-edited file gets there), every key falls back.
 */
export function normalizeHotkeys(value: Partial<Record<HotkeyAction, unknown>> | null | undefined): HotkeySettings {
  const keys: Partial<Record<HotkeyAction, HotkeyCode>> = {};
  const used = new Set<HotkeyCode>();
  for (const action of HOTKEY_ACTIONS) {
    const stored = value?.[action];
    const key = isBindableFor(action, stored) && !used.has(stored) ? stored : DEFAULT_HOTKEYS[action];
    if (used.has(key)) return DEFAULT_HOTKEYS;
    used.add(key);
    keys[action] = key;
  }
  return keys as HotkeySettings;
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
