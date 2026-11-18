// The overlay stands in for CS2's own UI, which has none of a web page's built-in input behaviour. WebView2's
// browser accelerator keys (reload, find, print, back, DevTools) are already off for every window
// (src-tauri/src/webview_keys.rs); this removes what the page itself does with the keyboard and mouse.
// Feature key handlers still receive every key: only the page's default action is cancelled.

/** Keys that scroll the page, or activate the focused button, when focus is not in a text field. */
const PAGE_KEYS: ReadonlySet<string> = new Set([
  "Enter", " ", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

export type NativeKey = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">;

/**
 * Whether the page's default action for a key-down is cancelled. `editing` is focus in a text field, where the
 * caret and editing keys keep working. Tab never moves focus (CS2 has no focus order; the chat's own Tab still runs).
 */
export function blocksNativeKey(key: NativeKey, editing: boolean): boolean {
  if (key.key === "Tab") return true;
  if (editing) return false;
  // Select all would highlight the whole overlay.
  if ((key.ctrlKey || key.metaKey) && !key.altKey && key.key.toLowerCase() === "a") return true;
  return PAGE_KEYS.has(key.key);
}

/** Mouse buttons with a page default: middle (autoscroll), back and forward (history navigation). */
export function blocksNativeButton(button: number): boolean {
  return button === 1 || button === 3 || button === 4;
}

/** Focus or a selection inside a text field (a selection starts on a text node). */
function editing(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return element?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") != null;
}

export function suppressOverlayNativeInput(): void {
  // Capture phase on the window: before any feature handler, which only reads the key.
  window.addEventListener("keydown", (event) => {
    if (!event.isComposing && blocksNativeKey(event, editing(event.target))) event.preventDefault();
  }, true);
  for (const type of ["mousedown", "mouseup", "auxclick"] as const) {
    window.addEventListener(type, (event) => {
      if (blocksNativeButton(event.button)) event.preventDefault();
    }, true);
  }
  // Dragging an image or a text run out of the overlay, and selecting text outside the text fields.
  window.addEventListener("dragstart", (event) => event.preventDefault(), true);
  window.addEventListener("selectstart", (event) => {
    if (!editing(event.target)) event.preventDefault();
  }, true);
}
