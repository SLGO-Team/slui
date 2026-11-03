// Overlay page work while its window is hidden: rAF rate, radar store dispatches, backdrop measures/skips over `ms`.
const [port, ms = "5000"] = process.argv.slice(2);
const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === "page");
for (const t of targets) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const result = await new Promise((resolve) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d.result?.result?.value ?? d); };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { awaitPromise: true, returnByValue: true, expression: `
      (async () => {
        if (window.__TAURI_INTERNALS__.metadata.currentWindow.label !== "overlay") return null;
        const debug = window.__SLUI_BACKDROP_DEBUG__;
        const camera = document.querySelector(".minimap-map__camera");
        let mutations = 0;
        const observer = new MutationObserver((records) => { mutations += records.length; });
        if (camera) observer.observe(camera, { attributes: true });
        const before = debug ? { measured: debug.measured, skipped: debug.skipped } : null;
        let raf = 0; const t0 = performance.now();
        await new Promise((resolve) => { (function f() { raf++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); else resolve(); })(); });
        observer.disconnect();
        const s = (performance.now() - t0) / 1000;
        return { vis: document.visibilityState, rafPerSec: Math.round(raf / s), cameraWritesPerSec: Math.round(mutations / s),
          backdropMeasuredPerSec: before ? +((debug.measured - before.measured) / s).toFixed(1) : null,
          backdropSkippedPerSec: before ? Math.round((debug.skipped - before.skipped) / s) : null };
      })()` } }));
  });
  ws.close();
  if (result) console.log(JSON.stringify(result));
}
