const previewUrl = process.env.HUD_PREVIEW_URL ?? "http://127.0.0.1:1423/";
const viewportWidth = Number(process.env.HUD_VIEWPORT_WIDTH ?? 1920);
const viewportHeight = Number(process.env.HUD_VIEWPORT_HEIGHT ?? 1080);
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
// The mock HUD writes its debug options into the query string after the first load,
// so the target is matched on origin + path rather than the exact preview URL.
const preview = new URL(previewUrl);
const target = targets.find((candidate) => {
  if (candidate.type !== "page" || !URL.canParse(candidate.url)) return false;
  const url = new URL(candidate.url);
  return url.origin === preview.origin && url.pathname === preview.pathname;
});
if (!target) throw new Error("HUD preview target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
socket.send(JSON.stringify({ id: -1, method: "Emulation.setDeviceMetricsOverride", params: { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false } }));
// Navigate instead of reloading: a reload keeps whatever preset the debug panel last wrote
// into the URL, while the preview URL restores the default (standard) HUD debug options.
socket.send(JSON.stringify({ id: 0, method: "Page.navigate", params: { url: previewUrl } }));
await new Promise((resolve) => setTimeout(resolve, 1200));
// A cold Vite load imports the overlay lazily and can take longer than the fixed wait.
for (let attempt = 0; attempt < 40; attempt += 1) {
  const readyId = 100 + attempt;
  socket.send(JSON.stringify({ id: readyId, method: "Runtime.evaluate", params: { expression: 'document.querySelectorAll(".hud-player").length', returnByValue: true } }));
  const ready = await new Promise((resolve) => {
    socket.addEventListener("message", function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.id !== readyId) return;
      socket.removeEventListener("message", onMessage);
      resolve(message.result?.result?.value ?? 0);
    });
  });
  if (ready > 0) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const expression = `JSON.stringify([
  ".hud-overlay", ".hud-design-canvas", ".hud-team-counter",
  ".hud-team--ct", ".hud-player", ".hud-scoreboard",
  ".hud-scoreboard__timer", ".hud-scoreboard__scores", ".hud-score--ct",
  ".hud-score--t", ".hud-scoreboard__counts", ".hud-team--t"
].map(selector => {
  const node = document.querySelector(selector);
  if (!node) return { selector, missing: true };
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    display: style.display, position: style.position, flex: style.flex,
    marginLeft: style.marginLeft, marginRight: style.marginRight };
}).concat([...document.querySelector(".hud-team--ct").children].map((node, index) => {
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return { selector: ".hud-team--ct > " + index + ":" + node.tagName + "." + node.className,
    x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display,
    position: style.position, flex: style.flex, marginLeft: style.marginLeft, marginRight: style.marginRight };
})).concat((() => {
  const cards = [...document.querySelectorAll(".hud-player")].map((node) => node.getBoundingClientRect());
  const left = Math.min(...cards.map((rect) => rect.left));
  const right = Math.max(...cards.map((rect) => rect.right));
  return { selector: "$cluster", x: left, width: right - left };
})()).concat({ selector: "$state",
  playerCount: document.querySelectorAll(".hud-player").length,
  deadCount: document.querySelectorAll('[data-player-state="dead"]').length,
  offlineCount: document.querySelectorAll('[data-player-state="offline"]').length,
  generatedNodeCount: document.querySelectorAll("[data-panorama-tag]").length,
  bombNodeCount: document.querySelectorAll('[id*="Bomb"], [class*="bomb"]').length,
  hasRawBindingText: /[#{](?:d:|g:|mini)/.test(document.body.innerText)
}))`;
socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
const response = await new Promise((resolve, reject) => {
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id === 1) resolve(message);
  });
  socket.addEventListener("error", reject, { once: true });
});
socket.close();
const value = response.result?.result?.value;
if (!value) throw new Error(JSON.stringify(response.result?.exceptionDetails ?? response));
const audit = JSON.parse(value);
assert.equal(audit.some((entry) => entry.missing), false);
const scale = Math.min(viewportWidth / 1920, viewportHeight / 1080);
const counter = audit.find((entry) => entry.selector === ".hud-team-counter");
const player = audit.find((entry) => entry.selector === ".hud-player");
const scoreboard = audit.find((entry) => entry.selector === ".hud-scoreboard");
const timer = audit.find((entry) => entry.selector === ".hud-scoreboard__timer");
const scores = audit.find((entry) => entry.selector === ".hud-scoreboard__scores");
const counts = audit.find((entry) => entry.selector === ".hud-scoreboard__counts");
const cluster = audit.find((entry) => entry.selector === "$cluster");
const state = audit.find((entry) => entry.selector === "$state");
// The counter row spans the whole design canvas: each team flex-fills its half and packs
// its cards against the score column, matching Panorama's `fit-children` Team__Large.
assert.ok(Math.abs(counter.x + counter.width / 2 - viewportWidth / 2) < 0.1);
assert.ok(Math.abs(counter.width - 1920 * scale) < 0.1);
// The visible HUD is the card cluster: per side five 54px cards with 2px gaps and 1px team
// padding, around the 84px score column -> 2 * (5 * 54 + 4 * 2 + 1) + 84 = 642.
assert.ok(Math.abs(cluster.x + cluster.width / 2 - viewportWidth / 2) < 0.1);
assert.ok(Math.abs(cluster.width - 642 * scale) < 0.1);
assert.ok(Math.abs(player.width - 54 * scale) < 0.1);
assert.ok(Math.abs(scoreboard.y - 3 * scale) < 0.1);
assert.ok(Math.abs(scoreboard.width - 84 * scale) < 0.1);
assert.ok(Math.abs(scoreboard.height - 106 * scale) < 0.1);
assert.ok(Math.abs(timer.y - 3 * scale) < 0.1);
assert.ok(Math.abs(timer.height - 32 * scale) < 0.1);
assert.ok(Math.abs(scores.y - 36 * scale) < 0.1);
assert.ok(Math.abs(scores.height - 30 * scale) < 0.1);
assert.ok(Math.abs(counts.y - 63 * scale) < 0.1);
assert.deepEqual(state, {
  selector: "$state",
  playerCount: 10,
  // Standard mock roster: team-b Phantom is dead, Warden is offline (offline is not dead).
  deadCount: 1,
  offlineCount: 1,
  generatedNodeCount: 0,
  bombNodeCount: 0,
  hasRawBindingText: false,
});
console.log(JSON.stringify(audit, null, 2));
console.log(`manual HUD layout audit: ${viewportWidth}x${viewportHeight} ok`);
import assert from "node:assert/strict";
