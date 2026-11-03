// End to end on Windows: the dev SLUI's overlay is enabled, a stand-in SCPSL.exe takes the foreground for a few
// seconds (Rust shows the overlay), then closes (Rust hides it). The page records, per 500 ms, the visibility Rust
// reports and the per-frame work: radar camera writes and backdrop measures / skips.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
// Build the stand-in first: csc -target:winexe -out:SCPSL.exe fake-game.cs (.NET Framework csc), next to this script.
const [port, fakeSeconds = "5"] = process.argv.slice(2);
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
await evaluate("window.__TAURI_INTERNALS__.invoke('set_overlay_enabled', { enabled: true })");
const totalMs = (Number(fakeSeconds) + 6) * 1000;
const recording = evaluate(`(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const debug = window.__SLUI_BACKDROP_DEBUG__;
  const camera = document.querySelector(".minimap-map__camera");
  let writes = 0;
  const observer = new MutationObserver((records) => { writes += records.length; });
  observer.observe(camera, { attributes: true });
  const buckets = [];
  const t0 = performance.now();
  let last = { measured: debug.measured, skipped: debug.skipped, writes: 0 };
  while (performance.now() - t0 < ${totalMs}) {
    await new Promise((r) => setTimeout(r, 500));
    const v = await invoke("get_overlay_visibility");
    buckets.push({ t: Math.round((performance.now() - t0) / 100) / 10, visible: v.visible, rev: v.revision,
      camera: writes - last.writes, measured: debug.measured - last.measured, skipped: debug.skipped - last.skipped });
    last = { measured: debug.measured, skipped: debug.skipped, writes };
  }
  observer.disconnect();
  return buckets;
})()`);
await new Promise((r) => setTimeout(r, 1500));
spawn(fileURLToPath(new URL("./SCPSL.exe", import.meta.url)), [fakeSeconds], { detached: true, stdio: "ignore" }).unref();
const buckets = await recording;
await evaluate("window.__TAURI_INTERNALS__.invoke('set_overlay_enabled', { enabled: false })");
for (const b of buckets) console.log(JSON.stringify(b));
ws.close();
