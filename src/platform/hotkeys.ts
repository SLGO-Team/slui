// Global overlay hotkeys, stored as KeyboardEvent.code values and matched in
// Rust by Windows virtual-key code. Rust validates the same set (lib.rs).

export type HotkeyCode = string;

export type HotkeySettings = Readonly<{ shop: HotkeyCode }>;

// CS2 opens its buy menu with B.
export const DEFAULT_HOTKEYS: HotkeySettings = { shop: "KeyB" };

// Y (global) and U (team) are the fixed chat keys and digits select shop items,
// so none of them can open the shop.
const RESERVED: ReadonlySet<HotkeyCode> = new Set(["KeyY", "KeyU"]);

const LETTER = /^Key([A-Z])$/;
const FUNCTION = /^F([1-9]|1[0-2])$/;

export function isBindableHotkey(code: unknown): code is HotkeyCode {
  return typeof code === "string" && !RESERVED.has(code) && (LETTER.test(code) || FUNCTION.test(code));
}

export function normalizeHotkeys(value: Partial<Record<keyof HotkeySettings, unknown>> | null | undefined): HotkeySettings {
  const shop = value?.shop;
  return { shop: isBindableHotkey(shop) ? shop : DEFAULT_HOTKEYS.shop };
}

export function hotkeyLabel(code: HotkeyCode): string {
  return LETTER.exec(code)?.[1] ?? code;
}

// Windows virtual-key codes: letters are their ASCII capitals, F1 is 0x70.
export function hotkeyVirtualKey(code: HotkeyCode): number | null {
  const letter = LETTER.exec(code);
  if (letter) return letter[1].charCodeAt(0);
  const fn = FUNCTION.exec(code);
  return fn ? 0x6f + Number(fn[1]) : null;
}
