// Profiles the mock overlay in Chromium: React commits/s, which components re-render, CDP main-thread metrics.
// Usage: start `npm run dev:mock` first, then `node .trellis/tasks/10-31-overlay-perf/research/profile-overlay.cjs`
// (playwright resolved from the global install: NODE_PATH=$(npm root -g)). Numbers are dev-build, headless.
const { chromium } = require("playwright");

const HOOK = () => {
  const stats = { commits: 0, renders: {} };
  const watch = new Set(["HudTeamCounterImpl", "ShopPanelImpl", "ChatInputImpl", "App", "HudTeamCounter", "MinimapRadar", "ShopPanel", "ChatInput", "PlayerSlot", "PlayerMarker", "TeamPlayers"]);
  const nameOf = (f) => { const t = f.type; return t && (t.displayName || t.name) || null; };
  window.__STATS__ = stats;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false, checkDCE() {},
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      stats.commits++;
      const stack = [root.current];
      while (stack.length) {
        const f = stack.pop();
        const name = nameOf(f);
        // Rendered this commit: a fresh fiber, or one whose props object changed.
        if (name && watch.has(name) && (!f.alternate || f.memoizedProps !== f.alternate.memoizedProps)) {
          stats.renders[name] = (stats.renders[name] ?? 0) + 1;
        }
        if (f.child) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
      }
    },
  };
};

async function run(label, query) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(HOOK);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(`http://localhost:1420/?hudDebug=0&shopDebug=0&background=0&${query}`);
  await page.waitForSelector(".minimap-radar[data-availability='live']", { timeout: 20000 });
  await page.waitForTimeout(1500);
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const before = await metric();
  await page.evaluate(() => { window.__STATS__.commits = 0; window.__STATS__.renders = {}; });
  const SECONDS = 10;
  await page.waitForTimeout(SECONDS * 1000);
  const after = await metric();
  const stats = await page.evaluate(() => window.__STATS__);
  const d = (k) => ((after[k] - before[k]) * 1000 / SECONDS).toFixed(1);
  const rooms = await page.$$eval(".minimap-map__room", (n) => n.length);
  console.log(`\n== ${label}  (rooms in DOM: ${rooms})`);
  console.log(`  React commits/s: ${(stats.commits / SECONDS).toFixed(1)}`);
  console.log(`  re-renders/s: ${Object.entries(stats.renders).map(([k, v]) => `${k}=${(v / SECONDS).toFixed(1)}`).join("  ")}`);
  console.log(`  main thread ms/s: Task=${d("TaskDuration")} Script=${d("ScriptDuration")} Layout=${d("LayoutDuration")} RecalcStyle=${d("RecalcStyleDuration")}`);
  await browser.close();
}

(async () => {
  await run("default radar", "");
  await run("dynamic zoom + heading-up + not centered", "minimapDynamicZoom=1&minimapOrientation=heading-up&minimapAlwaysCentered=0&minimapDynamicTargets=far");
})().catch((e) => { console.error(e); process.exit(1); });
