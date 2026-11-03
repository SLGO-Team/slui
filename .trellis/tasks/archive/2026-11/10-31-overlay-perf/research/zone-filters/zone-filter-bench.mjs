// Build ../hidden-pause/SCPSL.exe from fake-game.cs first. One radar raster run in the real WebView2 overlay: a stand-in SCPSL.exe holds the foreground (Rust shows the overlay
// over it at 1920x1080), the mock radar runs in the given orientation, and gpu-sample.ps1 records 8 s of the WebView2
// GPU process (CPU and GPU engine utilization) and renderer CPU.
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const [port, devPid, label, orientation] = process.argv.slice(2);
const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === "page");
let ws, id = 0;
const call = (method, params = {}) => new Promise((resolve) => {
  const my = ++id;
  const onMessage = (m) => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener("message", onMessage); resolve(d.result); } };
  ws.addEventListener("message", onMessage);
  ws.send(JSON.stringify({ id: my, method, params }));
});
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
for (const t of targets) {
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  if ((await evaluate("window.__TAURI_INTERNALS__.metadata.currentWindow.label")) === "overlay") break;
  ws.close();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await evaluate(`window.__SLUI_MINIMAP_DEBUG__.configure({ orientation: ${JSON.stringify(orientation)} })`);
await evaluate("window.__TAURI_INTERNALS__.invoke('set_overlay_enabled', { enabled: true })");
spawn(here("../hidden-pause/SCPSL.exe"), ["14", "1280", "720"], { detached: true, stdio: "ignore" }).unref();
await sleep(4000);
const sampling = new Promise((resolve, reject) => execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  here("./gpu-sample.ps1"), "-RootPid", devPid, "-Seconds", "8"], (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout))));
const page = await evaluate(`(async () => {
  const camera = document.querySelector(".minimap-map__camera");
  let writes = 0;
  const observer = new MutationObserver((records) => { writes += records.length; });
  document.querySelectorAll(".minimap-map__camera").forEach((node) => observer.observe(node, { attributes: true }));
  const visible = (await window.__TAURI_INTERNALS__.invoke("get_overlay_visibility")).visible;
  await new Promise((r) => setTimeout(r, 8000));
  observer.disconnect();
  return { visible, size: [innerWidth, innerHeight, devicePixelRatio], filtered: document.querySelectorAll(".minimap-radar [filter]").length,
    cameraGroups: document.querySelectorAll(".minimap-map__camera").length, cameraWritesPerSec: Math.round(writes / 8) };
})()`);
const gpu = await sampling;
await sleep(2500);
await evaluate("window.__TAURI_INTERNALS__.invoke('set_overlay_enabled', { enabled: false })");
console.log(JSON.stringify({ label, orientation, ...page, ...gpu }));
ws.close();
