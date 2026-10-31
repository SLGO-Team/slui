// Raster/paint cost of the mock overlay from a Chromium trace: a proxy for GPU work in this GPU-less container.
// Headless Chromium rasterizes in software on its raster threads, so SVG filter and composite work shows up as
// `RasterTask` time there; main-thread `Paint` is the display-list recording. Numbers are relative, not WebView2's.
// Usage: start `npm run dev:mock` (or a static build, OVERLAY_URL=...), then
//   node .trellis/tasks/10-31-overlay-perf/research/raster-trace.cjs ["<extra query>"] [seconds]
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const query = process.argv[2] ?? "";
const SECONDS = Number(process.argv[3] ?? 8);
const base = process.env.OVERLAY_URL ?? "http://localhost:1420/";
const CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "viz"];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${base}?hudDebug=0&shopDebug=0&background=0&${query}`);
  await page.waitForSelector(".minimap-radar[data-availability='live']", { timeout: 20000 });
  await page.waitForTimeout(1500);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "raster-trace-")), "trace.json");
  await browser.startTracing(page, { path: file, categories: CATEGORIES });
  await page.waitForTimeout(SECONDS * 1000);
  await browser.stopTracing();
  const filtered = await page.$$eval(".minimap-radar__map [filter]", (nodes) => nodes.length);
  await browser.close();

  const { traceEvents } = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
  const totals = new Map();
  const counts = new Map();
  for (const event of traceEvents) {
    if (event.ph !== "X" || typeof event.dur !== "number") continue;
    if (!["RasterTask", "Paint", "PaintArtifactCompositor::Update", "UpdateLayerTree", "Layout", "CompositeLayers"].includes(event.name)) continue;
    totals.set(event.name, (totals.get(event.name) ?? 0) + event.dur);
    counts.set(event.name, (counts.get(event.name) ?? 0) + 1);
  }
  console.log(`== ${query || "default radar"}  (${SECONDS} s, filtered elements in radar map: ${filtered})`);
  for (const [name, us] of [...totals].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(34)} ${(us / 1000 / SECONDS).toFixed(1).padStart(7)} ms/s  (${(counts.get(name) / SECONDS).toFixed(0)} events/s)`);
  }
})().catch((error) => { console.error(error); process.exit(1); });
