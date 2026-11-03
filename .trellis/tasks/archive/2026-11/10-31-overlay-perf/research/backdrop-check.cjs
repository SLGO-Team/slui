// Checks that the backdrop loop never skips a frame whose regions changed (task 10-31-perf-backdrop-measure).
// With `window.__SLUI_BACKDROP_DEBUG__.check = true`, src/platform/backdrop.ts re-measures every frame it skips
// and counts as `stale` the ones whose regions differ from the list it last sent. This drives the mock preview
// through panels appearing, moving, turning and fading, and fails unless stale stays 0.
// Usage: npm run dev:mock -- --port 1420 --strictPort   (another shell), then
//        node .trellis/tasks/10-31-overlay-perf/research/backdrop-check.cjs
// Set CHECK=0 to count measured/skipped frames without the self-check (it measures every skipped frame itself).
const { chromium } = require("playwright");

const base = process.env.OVERLAY_URL ?? "http://localhost:1420/";
const check = process.env.CHECK !== "0";

async function phase(page, label, seconds, act) {
  const before = await page.evaluate(() => ({ ...window.__SLUI_BACKDROP_DEBUG__ }));
  const started = Date.now();
  if (act) await act();
  const rest = seconds * 1000 - (Date.now() - started);
  if (rest > 0) await page.waitForTimeout(rest);
  const after = await page.evaluate(() => ({ ...window.__SLUI_BACKDROP_DEBUG__ }));
  const elapsed = (Date.now() - started) / 1000;
  const d = (key) => after[key] - before[key];
  console.log(`${label.padEnd(34)} measured/s=${(d("measured") / elapsed).toFixed(1).padStart(5)}  skipped/s=${(d("skipped") / elapsed).toFixed(1).padStart(5)}  stale=${d("stale")}`);
  return d("stale");
}

async function open(browser, query) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript((enabled) => {
    window.__SLUI_BACKDROP_DEBUG__ = { measured: 0, skipped: 0, stale: 0, check: enabled };
  }, check);
  await page.goto(`${base}?hudDebug=0&shopDebug=0&background=0&${query}`);
  await page.waitForSelector(".minimap-radar[data-availability='live']", { timeout: 20000 });
  await page.waitForTimeout(1500);
  return page;
}

(async () => {
  const browser = await chromium.launch();
  let stale = 0;
  let page = await open(browser, "");
  stale += await phase(page, "idle (default mock stream)", 6);
  stale += await phase(page, "shop open (KeyB) and close (Escape)", 6, async () => {
    await page.keyboard.press("KeyB");
    await page.waitForTimeout(2500);
    await page.keyboard.press("Escape");
  });
  stale += await phase(page, "scoreboard held (CapsLock)", 5, async () => {
    await page.keyboard.down("CapsLock");
    await page.waitForTimeout(2500);
    await page.keyboard.up("CapsLock");
  });
  stale += await phase(page, "window 1280x720 and back", 5, async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(2000);
    await page.setViewportSize({ width: 1920, height: 1080 });
  });
  stale += await phase(page, "radar blur off and on", 4, async () => {
    await page.evaluate(() => window.__SLUI_MINIMAP_DEBUG__?.configure({ blurBackground: false }));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__SLUI_MINIMAP_DEBUG__?.configure({ blurBackground: true }));
  });
  await page.close();
  for (const scene of ["all-slots", "win-mvp-kills", "bottom-kills", "bottom-fire", "generator-start-progress", "match-point"]) {
    page = await open(browser, `hudScene=${scene}`);
    stale += await phase(page, `hudScene=${scene}`, 8);
    await page.close();
  }
  await browser.close();
  console.log(check ? (stale ? `FAILED: ${stale} stale frame(s)` : "stale frames: 0") : "self-check off (CHECK=0)");
  process.exit(stale ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
