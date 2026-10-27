import type { WindowLabel } from "./desktop.ts";

// Input types whose WebView2 menu is the edit menu (cut / copy / paste); a range or checkbox
// would only get the page menu.
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number"]);

function editsText(target: Element): boolean {
  if (target instanceof HTMLTextAreaElement) return !target.disabled;
  if (target instanceof HTMLInputElement) return !target.disabled && TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

/** Whether a right-click should keep WebView2's native menu instead of nothing. */
function keepsNativeMenu(label: WindowLabel, event: MouseEvent): boolean {
  // The overlay stands in for CS2's own UI, which has no context menu at all.
  if (label === "overlay") return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (editsText(target)) return true;
  // Right-clicking selected text (an error to copy into a report) keeps the copy menu.
  // Hit-tested on the selection's own boxes: a container under the cursor may hold the selection
  // without the click being on it.
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    for (const rect of selection.getRangeAt(index).getClientRects()) {
      if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return true;
    }
  }
  return false;
}

/**
 * Suppresses WebView2's page menu (Back / Reload / Print): a desktop window has no page to
 * navigate, and Reload would drop the window's state. Release builds already omit Inspect,
 * since Tauri leaves WebView2's DevTools off without its `devtools` feature.
 */
export function suppressPageContextMenu(label: WindowLabel): void {
  window.addEventListener("contextmenu", (event) => {
    if (!keepsNativeMenu(label, event)) event.preventDefault();
  });
}
