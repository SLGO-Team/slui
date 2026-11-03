// profile-overlay.cjs over raw CDP for machines without Playwright: same React hook (read from that file), re-renders/s
// and radar DOM writes in the mock overlay. Usage: npm run dev:mock, then node profile-overlay-cdp.mjs research/profile-overlay.cjs
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const source = readFileSync(process.argv[2], "utf8");
const hook = source.slice(source.indexOf("const HOOK = ") + "const HOOK = ".length, source.indexOf("\n\nasync function run")).replace(/;\s*$/, "");
const browser = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--no-first-run", "--remote-debugging-port=0",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "slui-prof-"))}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise((resolve) => browser.stderr.on("data", (d) => { const m = String(d).match(/ws:\/\/\S+/); if (m) resolve(m[0]); }));
const port = new URL(wsUrl).port;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(label, query) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const call = (method, params = {}) => new Promise((resolve) => {
    const my = ++id;
    const onMessage = (m) => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener("message", onMessage); resolve(d.result); } };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
  const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  await call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await call("Page.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `(${hook})();` });
  await call("Performance.enable");
  await call("Page.navigate", { url: `http://127.0.0.1:1420/?hudDebug=0&shopDebug=0&background=0&${query}` });
  for (let i = 0; i < 80 && !(await evaluate("Boolean(document.querySelector(\".minimap-radar[data-availability='live']\"))")); i++) await sleep(250);
  await sleep(1500);
  const metric = async () => Object.fromEntries((await call("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const before = await metric();
  await evaluate(`(() => { window.__STATS__.commits = 0; window.__STATS__.renders = {};
    const mutations = { map: 0, other: 0 }; window.__MUTATIONS__ = mutations;
    new MutationObserver((records) => { for (const r of records) (r.target.closest?.(".minimap-radar__map") ? mutations.map++ : mutations.other++); })
      .observe(document.querySelector(".minimap-radar"), { subtree: true, attributes: true, childList: true, characterData: true }); })()`);
  await sleep(10000);
  const after = await metric();
  const stats = await evaluate("window.__STATS__"), mutations = await evaluate("window.__MUTATIONS__");
  const d = (k) => ((after[k] - before[k]) * 100).toFixed(1);
  console.log(`== ${label}  rooms=${await evaluate("document.querySelectorAll('.minimap-map__room').length")} filtered=${await evaluate("document.querySelectorAll('.minimap-radar [filter]').length")}`);
  console.log(`  commits/s ${(stats.commits / 10).toFixed(1)}  re-renders/s ${Object.entries(stats.renders).map(([k, v]) => `${k}=${(v / 10).toFixed(1)}`).join(" ")}`);
  console.log(`  radar DOM mutations/s map=${(mutations.map / 10).toFixed(1)} other=${(mutations.other / 10).toFixed(1)}  main ms/s Task=${d("TaskDuration")} Script=${d("ScriptDuration")}`);
  ws.close();
}
await run("default radar", "");
await run("dynamic zoom + heading-up + not centered", "minimapDynamicZoom=1&minimapOrientation=heading-up&minimapAlwaysCentered=0&minimapDynamicTargets=far");
browser.kill();
