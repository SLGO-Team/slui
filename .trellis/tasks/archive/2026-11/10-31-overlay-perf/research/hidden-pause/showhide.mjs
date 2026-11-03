// Measures the overlay page's rAF rate hidden, shown (native SetWindowPos SWP_SHOWWINDOW) and hidden again (SW_HIDE).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const [port, pid, hwnd] = process.argv.slice(2);
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
const win = (action) => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./win.ps1", import.meta.url)), pid, action], { env: { ...process.env, OVERLAY: hwnd } }).toString().trim();
const sample = (ms) => evaluate(`new Promise((resolve) => { let n = 0; const t0 = performance.now();
  (function f() { n++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); else resolve({ rafPerSec: Math.round(n * 1000 / ${ms}), vis: document.visibilityState }); })();
  setTimeout(() => resolve({ rafPerSec: Math.round(n * 1000 / ${ms}), vis: document.visibilityState, stalled: true }), ${ms} + 1500); })`);
console.log("hidden since start", await sample(2000));
console.log(win("small"));
console.log(win("show"));
console.log("shown", await sample(2000));
console.log(win("hide"));
await new Promise((r) => setTimeout(r, 300));
console.log("hidden after SW_HIDE", await sample(2000));
await new Promise((r) => setTimeout(r, 5000));
console.log("hidden 5 s later", await sample(2000));
ws.close();
