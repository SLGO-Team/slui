import assert from "node:assert/strict";

// Chat panel geometry against CS2 hudchat.xml/hudchat.css, in a CDP-enabled preview
// (same setup as hud-layout-audit). Opens team chat with U and measures every layer.
// Vite listens on localhost, which may not include 127.0.0.1.
const previewUrl = process.env.CHAT_PREVIEW_URL ?? "http://localhost:1430/?hudDebug=0&shopDebug=0";
const viewportWidth = Number(process.env.CHAT_VIEWPORT_WIDTH ?? 1920);
const viewportHeight = Number(process.env.CHAT_VIEWPORT_HEIGHT ?? 1080);
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
// Any page will do: the audit navigates it to the preview.
const target = targets.find((candidate) => candidate.type === "page");
if (!target) throw new Error("No CDP page target was found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const call = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  const onMessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== id) return;
    socket.removeEventListener("message", onMessage);
    resolve(message);
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", reject, { once: true });
  socket.send(JSON.stringify({ id, method, params }));
});
await call("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
await call("Page.navigate", { url: previewUrl });
await new Promise((resolve) => setTimeout(resolve, 2500));
await call("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyU", key: "u", windowsVirtualKeyCode: 85 });
await call("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyU", key: "u", windowsVirtualKeyCode: 85 });
await new Promise((resolve) => setTimeout(resolve, 300));

const expression = `JSON.stringify(Object.fromEntries([
  ".chat-main", ".chat-fg", ".chat-history", ".chat-history-text", ".chat-text-entry",
  ".chat-text-entry-box", ".chat-send-button"
].map((selector) => {
  const node = document.querySelector(selector);
  if (!node) return [selector, null];
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color }];
}).concat([["$state", {
  placeholder: document.querySelector(".chat-text-entry-box")?.placeholder ?? null,
  send: document.querySelector(".chat-send-button")?.textContent ?? null,
  focused: document.activeElement?.classList.contains("chat-text-entry-box") ?? false,
  hasRawBindingText: /#SFUI_|{[sdg]:/.test(document.body.innerText),
}]])))`;
const response = await call("Runtime.evaluate", { expression, returnByValue: true });
socket.close();
const value = response.result?.result?.value;
if (!value) throw new Error(JSON.stringify(response.result?.exceptionDetails ?? response));
const audit = JSON.parse(value);
const scale = Math.min(viewportWidth / 1920, viewportHeight / 1080);
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected * scale) < 0.5, `${label}: ${actual} vs ${expected * scale}`);
for (const [selector, entry] of Object.entries(audit)) assert.ok(entry, `${selector} is missing`);

// #ChatContainer padding 0 10px 72px, bottom-left; #ChatMain = #ChatFG (553px) + 8px margins.
const main = audit[".chat-main"];
near(main.x, 10, "main x");
near(viewportHeight - (main.y + main.height), 72, "main bottom");
near(main.width, 569, "main width");
near(main.height, 399, "main height");
near(audit[".chat-fg"].x - main.x, 8, "fg margin");
near(audit[".chat-history"].height, 327, "history height");
near(audit[".chat-text-entry"].height, 48, "entry height");
near(audit[".chat-text-entry"].y - (audit[".chat-history"].y + audit[".chat-history"].height), 8, "entry margin-top");
const box = audit[".chat-text-entry-box"];
near(box.x - audit[".chat-fg"].x, 15, "entry box margin-left");
near(box.width, 450, "entry box width");
near(box.height, 36, "entry box height");
assert.equal(box.fontSize, "20px");
assert.equal(box.fontWeight, "300");
near(audit[".chat-send-button"].width, 75, "send width");
assert.equal(audit[".chat-history-text"].fontSize, "18px");
assert.deepEqual(audit.$state, { placeholder: "队内聊天", send: "发送", focused: true, hasRawBindingText: false });
console.log(JSON.stringify(audit, null, 2));
console.log(`manual chat layout audit: ${viewportWidth}x${viewportHeight} ok`);
