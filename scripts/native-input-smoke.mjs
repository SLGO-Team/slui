import assert from "node:assert/strict";
import { blocksNativeButton, blocksNativeKey } from "../src/platform/nativeInput.ts";

const key = (name, modifiers = {}) => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, ...modifiers });

// Tab never moves focus, in a text field too.
assert.equal(blocksNativeKey(key("Tab"), false), true);
assert.equal(blocksNativeKey(key("Tab"), true), true);
assert.equal(blocksNativeKey(key("Tab", { shiftKey: true }), false), true);

// Scrolling and button activation outside text fields; the caret keys keep working inside them.
for (const name of ["End", "Home", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "]) {
  assert.equal(blocksNativeKey(key(name), false), true, name);
  assert.equal(blocksNativeKey(key(name), true), false, `${name} in a text field`);
}
assert.equal(blocksNativeKey(key("a", { ctrlKey: true }), false), true, "select all");
assert.equal(blocksNativeKey(key("A", { ctrlKey: true }), false), true, "select all with Caps Lock");
assert.equal(blocksNativeKey(key("a", { ctrlKey: true }), true), false, "select all in a text field");

// Feature keys keep their default (nothing to cancel): digits, letters, Escape, Backspace, Delete.
for (const name of ["1", "b", "r", "Escape", "Backspace", "Delete", "."]) assert.equal(blocksNativeKey(key(name), false), false, name);

// Middle (autoscroll), back and forward; never the left or right button.
assert.deepEqual([0, 1, 2, 3, 4].map(blocksNativeButton), [false, true, false, true, true]);

console.log("native input smoke passed");
