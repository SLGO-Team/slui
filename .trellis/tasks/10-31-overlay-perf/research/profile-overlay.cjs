// Profiles the mock overlay in Chromium: React commits/s, which components re-render, radar DOM writes,
// CDP main-thread metrics.
// Usage: start `npm run dev:mock` first, then `node .trellis/tasks/10-31-overlay-perf/research/profile-overlay.cjs`
// (playwright resolved from the global install, or NODE_PATH=$(npm root -g)). Numbers are dev-build, headless.
// OVERLAY_URL=<url> profiles another server, e.g. a static production-React mock build (see perf-baseline.md).
const { chromium } = require("playwright");

const HOOK = () => {
  const stats = { commits: 0, renders: {} };
  const watch = new Set(["App", "HudTeamCounter", "WinPanel", "BottomHud", "ProgressCard", "MessageZone", "KillFeed", "Scoreboard",
    "LiveMinimapRadar", "MinimapRadar", "MapRooms", "ShopPanel", "ChatInput", "PlayerSlot"]);
  const nameOf = (f) => { const t = f.type; return t && (t.displayName || t.name) || null; };
  const seen = new WeakSet();
  const fresh = (value) => value !== null && typeof value === "object" && !seen.has(value) && (seen.add(value), true);
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
        // Rendered this commit <=> the fiber holds a props or hook-state object no earlier commit held. A render
        // creates both anew; a bailout (memo, or a subtree React skipped and never cloned) keeps both. Comparing with
        // `f.alternate` instead miscounts every commit inside skipped subtrees, whose alternates are stale.
        const freshProps = fresh(f.memoizedProps), freshState = fresh(f.memoizedState);
        if (name && watch.has(name) && (freshProps || freshState)) {
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
  await page.goto(`${process.env.OVERLAY_URL ?? "http://localhost:1420/"}?hudDebug=0&shopDebug=0&background=0&${query}`);
  await page.waitForSelector(".minimap-radar[data-availability='live']", { timeout: 20000 });
  await page.waitForTimeout(1500);
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const before = await metric();
  await page.evaluate(() => {
    window.__STATS__.commits = 0; window.__STATS__.renders = {};
    // DOM writes inside the radar map layer (rooms + camera group) vs. the marker layer.
    const mutations = { map: 0, other: 0 };
    window.__MUTATIONS__ = mutations;
    const radar = document.querySelector(".minimap-radar");
    new MutationObserver((records) => {
      for (const r of records) (r.target.closest?.(".minimap-radar__map") ? mutations.map++ : mutations.other++);
    }).observe(radar, { subtree: true, attributes: true, childList: true, characterData: true });
  });
  const SECONDS = 10;
  await page.waitForTimeout(SECONDS * 1000);
  const after = await metric();
  const stats = await page.evaluate(() => window.__STATS__);
  const mutations = await page.evaluate(() => window.__MUTATIONS__);
  const d = (k) => ((after[k] - before[k]) * 1000 / SECONDS).toFixed(1);
  const rooms = await page.$$eval(".minimap-map__room", (n) => n.length);
  console.log(`\n== ${label}  (rooms in DOM: ${rooms})`);
  console.log(`  React commits/s: ${(stats.commits / SECONDS).toFixed(1)}`);
  console.log(`  re-renders/s: ${Object.entries(stats.renders).map(([k, v]) => `${k}=${(v / SECONDS).toFixed(1)}`).join("  ")}`);
  console.log(`  radar DOM mutations/s: map layer=${(mutations.map / SECONDS).toFixed(1)}  markers/other=${(mutations.other / SECONDS).toFixed(1)}`);
  console.log(`  main thread ms/s: Task=${d("TaskDuration")} Script=${d("ScriptDuration")} Layout=${d("LayoutDuration")} RecalcStyle=${d("RecalcStyleDuration")}`);
  await browser.close();
}

(async () => {
  await run("default radar", "");
  await run("dynamic zoom + heading-up + not centered", "minimapDynamicZoom=1&minimapOrientation=heading-up&minimapAlwaysCentered=0&minimapDynamicTargets=far");
})().catch((e) => { console.error(e); process.exit(1); });
