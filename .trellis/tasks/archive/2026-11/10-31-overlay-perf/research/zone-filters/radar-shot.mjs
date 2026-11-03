// Build ../hidden-pause/SCPSL.exe from fake-game.cs first. Radar crop from the real WebView2 overlay shown over a stand-in game (1920x1080), motion off, given orientation.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const [port, tag, orientation] = process.argv.slice(2);
const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === "page");
let ws, id = 0;
const call = (method, params = {}) => new Promise((resolve) => {
  const my = ++id;
  const onMessage = (m) => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener("message", onMessage); resolve(d.result); } };
  ws.addEventListener("message", onMessage);
  ws.send(JSON.stringify({ id: my, method, params }));
});
const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
for (const t of targets) {
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  if ((await evaluate("window.__TAURI_INTERNALS__.metadata.currentWindow.label")) === "overlay") break;
  ws.close();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await evaluate(`window.__SLUI_MINIMAP_DEBUG__.configure({ orientation: ${JSON.stringify(orientation)}, motion: false, mapScale: 0.5 })`);
await evaluate("window.__TAURI_INTERNALS__.invoke('set_overlay_enabled', { enabled: true })");
spawn(here("../hidden-pause/SCPSL.exe"), ["9", "1280", "720"], { detached: true, stdio: "ignore" }).unref();
await sleep(4000);
const rect = await evaluate(`(() => { const r = document.querySelector(".minimap-radar__viewport").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1.5 }; })()`);
const shot = await call("Page.captureScreenshot", { format: "png", clip: rect });
writeFileSync(here(`./wv-${tag}-${orientation}.png`), Buffer.from(shot.data, "base64"));
await sleep(5500);
await evaluate("window.__TAURI_INTERNALS__.invoke('set_overlay_enabled', { enabled: false })");
await evaluate(`window.__SLUI_MINIMAP_DEBUG__.configure({ motion: true })`);
console.log(tag, orientation, rect);
ws.close();
