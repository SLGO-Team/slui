import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const previewUrl = process.env.MINIMAP_PREVIEW_URL ?? "http://127.0.0.1:1420/";
const outputDir = resolve(process.argv[2] ?? ".trellis/tasks/08-25-minimap/research/screenshots");
const requestedBrowser = process.env.MINIMAP_BROWSER_PATH;
if (requestedBrowser && !existsSync(requestedBrowser)) throw new Error(`MINIMAP_BROWSER_PATH does not exist: ${requestedBrowser}`);
const browserPath = [requestedBrowser,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  join(process.env.LOCALAPPDATA ?? "", "ms-playwright/chromium-1155/chrome-win/chrome.exe"),
].find((path) => path && existsSync(path));
if (!browserPath) throw new Error("Set MINIMAP_BROWSER_PATH to a local Chromium executable");
await mkdir(outputDir, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "slui-minimap-audit-"));
const browser = spawn(browserPath, ["--headless=new", "--no-first-run", "--disable-background-networking", "--disable-component-update",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
let socket;
let auditError;
const report = [], cameraMotion = [], pixelComparisons = [], backdropContrast = [], runtimeErrors = [];
const bombsiteTiers = new Set();
async function saveReport(status, error) {
  await writeFile(join(outputDir, "audit.json"), JSON.stringify({ previewUrl, browserPath, status,
    error: error ? error.stack ?? String(error) : null,
    results: report, cameraMotion, pixelComparisons, backdropContrast, runtimeErrors }, null, 2));
}
try {
  const endpoint = await new Promise((done, reject) => {
    let log = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      if (error) reject(error); else done(value);
    };
    const timeout = setTimeout(() => finish(new Error(`Chromium did not open its audit endpoint: ${log}`)), 20_000);
    // New Windows Chrome can de-elevate into a child whose stderr is detached.
    // The port file in this audit's isolated profile still identifies its endpoint.
    const poll = setInterval(async () => {
      try {
        const [port, path] = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/);
        // Chrome may expose this file before both lines have finished writing.
        if (Number(port) > 0 && Number(port) <= 65535
          && /^\/devtools\/browser\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(path ?? "")) {
          finish(null, `ws://127.0.0.1:${port}${path}`);
        }
      } catch (error) {
        if (error.code !== "ENOENT") finish(error);
      }
    }, 100);
    browser.once("error", (error) => finish(error));
    browser.stderr.on("data", (data) => {
      log += data.toString();
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log);
      if (match) finish(null, match[1]);
    });
    browser.once("exit", (code) => { if (code !== 0) finish(new Error(`Chromium exited ${code}: ${log}`)); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP socket did not open: ${endpoint}`)), 10_000);
    socket.addEventListener("open", () => { clearTimeout(timeout); done(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error(`CDP socket failed: ${endpoint}`)); }, { once: true });
  });
  let nextId = 0;
  let sessionId;
  const pending = new Map();
  socket.addEventListener("close", () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("CDP browser connection closed"));
    }
    pending.clear();
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      runtimeErrors.push({ source: "javascript", text: details.exception?.description ?? details.text,
        url: details.url ?? details.stackTrace?.callFrames[0]?.url ?? null, line: details.lineNumber });
      console.error("Browser exception:", runtimeErrors.at(-1));
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      const entry = message.params.entry;
      runtimeErrors.push({ source: entry.source, text: entry.text, url: entry.url ?? null });
      console.error("Browser resource error:", runtimeErrors.at(-1));
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.done(message.result);
  });
  function request(method, params = {}, targetSession = sessionId) {
    if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP socket is not open: ${method}`));
    const id = ++nextId;
    return new Promise((done, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
      pending.set(id, { done, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(targetSession ? { sessionId: targetSession } : {}) }));
    });
  }
  const target = await request("Target.createTarget", { url: "about:blank" });
  sessionId = (await request("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  await request("Runtime.enable");
  await request("Log.enable");
  await request("Page.enable");
  // Chrome otherwise requests /favicon.ico for this icon-less overlay page.
  // Only suppress that implicit request in the isolated audit; declared assets
  // still load normally and every resource error still fails the audit.
  await request("Page.addScriptToEvaluateOnNewDocument", { source: `
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.querySelector('link[rel~="icon"]')) {
        const icon = document.createElement('link'); icon.rel = 'icon'; icon.href = 'data:,';
        document.head.append(icon);
      }
    }, { once: true });
  ` });
  async function evaluate(expression) {
    const result = await request("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function until(expression) {
    for (let tries = 0; tries < 70; tries += 1) {
      if (await evaluate(expression)) return;
      await wait(80);
    }
    throw new Error(`Page state timed out: ${expression}`);
  }
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    await request("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await request("Page.navigate", { url: `${previewUrl}?hudDebug=0&shopDebug=0&background=1&minimapMotion=0` });
    await until('document.querySelector(".minimap-radar")?.dataset.availability === "live" && !!window.__SLUI_MINIMAP_DEBUG__');
    const control = "window.__SLUI_MINIMAP_DEBUG__";
    let expectedBombsites = ["A", "B"];
    async function configure(options) {
      await evaluate(`${control}.configure(${JSON.stringify(options)})`);
      await wait(180);
    }
    async function auditMapTransform() {
      const result = await evaluate(`(() => {
        const rooms = [...document.querySelectorAll('.minimap-map__room')].map(room => {
          const image = room.querySelector('image');
          const center = new DOMPoint(image.width.baseVal.value / 2, image.height.baseVal.value / 2)
            .matrixTransform(image.transform.baseVal.consolidate().matrix);
          return {id: room.dataset.roomId, x: center.x, y: center.y, transform: image.getAttribute('transform')};
        });
        return { rooms, labels: document.querySelectorAll('.minimap-radar__labels, .minimap-radar__map text').length };
      })()`);
      assert.equal(result.labels, 0, "the room-label layer has been removed");
      for (const room of result.rooms) assert.ok(Number.isFinite(room.x) && Number.isFinite(room.y), "image centers stay finite");
      return result;
    }
    async function capture(name, expected = {}) {
      const artwork = await evaluate(`(async () => {
        const elements = [...document.querySelectorAll('.minimap-map__room image')];
        const sources = [...new Set(elements.map(e => e.getAttribute('href')))];
        const decoded = await Promise.all(sources.map(async source => {
          const image = new Image(); image.src = source; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let painted = 0, translucent = 0;
          for (let i = 3; i < rgba.length; i += 4) {
            if (rgba[i] > 0) painted++;
            if (rgba[i] > 0 && rgba[i] < 255) translucent++;
          }
          return { source, width: image.width, height: image.height, painted, translucent };
        }));
        return { count: elements.length, decoded,
          invalidTransforms: elements.filter(e => {
            const m = e.getCTM();
            return !m || ![m.a,m.b,m.c,m.d,m.e,m.f].every(Number.isFinite) || m.a*m.d-m.b*m.c <= 0;
          }).length,
          polygons: document.querySelectorAll('.minimap-map__room polygon').length,
          connectionLines: document.querySelectorAll('.minimap-radar__map line').length };
      })()`);
      const details = await evaluate(`(() => {
        const root=document.querySelector('.minimap-radar');
        const viewport=document.querySelector('.minimap-radar__viewport');
        const r=root.getBoundingClientRect(), v=viewport.getBoundingClientRect();
        const location=document.querySelector('.minimap-radar__location');
        const l=location.getBoundingClientRect();
        const background=getComputedStyle(document.querySelector('.minimap-radar__background'));
        const hud=document.querySelector('.hud-team-counter');
        const markerElements=[...document.querySelectorAll('.minimap-marker')];
        return {name:${JSON.stringify(name)},viewport:[innerWidth,innerHeight],...root.dataset,
          frame:{x:r.x,y:r.y,width:r.width,height:r.height},circle:{x:v.x,y:v.y,width:v.width,height:v.height},
          markers:markerElements.map(e=>({...e.dataset,x:e.style.left,y:e.style.top})),
          bombsites:[...document.querySelectorAll('.minimap-bombsite')].map(e=>{
            const glyph=e.querySelector('.minimap-bombsite__icon, .minimap-bombsite__letter'), b=glyph.getBoundingClientRect(), anchor=e.getBoundingClientRect();
            return {label:e.dataset.label,edge:e.dataset.edge,opacity:Number(getComputedStyle(e).opacity),
              width:b.width,height:b.height,offsetX:b.x+b.width/2-anchor.x,offsetY:b.y+b.height/2-anchor.y,
              loaded:glyph.tagName!=='IMG'||(glyph.complete&&glyph.naturalWidth>0),
              aspect:glyph.tagName==='IMG'?glyph.naturalWidth/glyph.naturalHeight:null,filter:getComputedStyle(glyph).filter};
          }),
          layerOrder:[...(document.querySelector('.minimap-radar__markers')?.children??[])].map(e=>e.classList.contains('minimap-bombsite')?'bombsite':'other'),
          markerImages:[...root.querySelectorAll('.minimap-marker img')].map(e=>({source:e.getAttribute('src'),loaded:e.complete&&e.naturalWidth>0,mask:getComputedStyle(e).maskImage})),
          roomCount:document.querySelectorAll('.minimap-map__room').length,
          zones:[...new Set([...document.querySelectorAll('.minimap-map__room')].map(e=>e.dataset.zone))].sort(),
          location:location.textContent, locationBox:{x:l.x,y:l.y,width:l.width,height:l.height},
          status:root.querySelector('.minimap-radar__status')?.textContent??null,
          background:background.backgroundColor,backdropFilter:getComputedStyle(viewport).backdropFilter,
          blendMode:getComputedStyle(root.querySelector('.minimap-radar__map')).mixBlendMode,
          borderWidth:getComputedStyle(root.querySelector('.minimap-radar__border')).borderTopWidth,
          hudWidth:hud?.getBoundingClientRect().width??null,
          labels:document.querySelectorAll('.minimap-radar__labels, .minimap-radar__map text').length,
          pointerEvents:getComputedStyle(document.querySelector('.minimap-overlay')).pointerEvents,
          generated:document.querySelectorAll('[data-panorama-node],[data-generated]').length};
      })()`);
      details.artwork = artwork;
      details.mapTransforms = await auditMapTransform();
      assert.equal(artwork.count, details.roomCount, `${name}: every room renders a full SVG image`);
      assert.equal(artwork.invalidTransforms, 0, `${name}: nonempty, unmirrored image transforms`);
      assert.equal(artwork.polygons, 0, `${name}: simplified chambers are replaced`);
      assert.equal(artwork.connectionLines, 0, `${name}: center lines cannot cover room details`);
      for (const source of artwork.decoded) {
        assert.match(source.source, /^\/assets\/minimap\/rooms\/[^/]+\.svg$/);
        assert.equal(source.width, 256);
        assert.equal(source.height, 256);
        assert.ok(source.painted > 0 && source.painted < 256 * 256, `${name}: visible artwork and transparent canvas`);
      }
      for (const [key, value] of Object.entries(expected)) assert.equal(details[key], value, `${name}: ${key}`);
      const renderScale = width / 1920 * Number(details.hudScale);
      assert.ok(Math.abs(details.frame.width - 300 * renderScale) < 0.1);
      assert.ok(Math.abs(details.circle.width - (details.shape === "square" ? 290 : 250) * renderScale) < 0.1);
      assert.ok(Math.abs(details.circle.height - details.circle.width) < 0.1);
      assert.ok(details.locationBox.y >= details.circle.y + details.circle.height, "location sits below the radar");
      assert.equal(details.labels, 0);
      assert.equal(details.borderWidth, "1px");
      assert.ok(!/^(Hcz|Ez|Unnamed|room-)/.test(details.location), "no internal room token is exposed");
      if (details.availability === "live" && details.viewerAlive === "true") assert.equal(details.status, null, "no permanent live/debug status");
      if (details.availability !== "live") assert.ok(details.status, "abnormal state remains visible");
      for (const icon of details.markerImages) { assert.ok(icon.loaded, `marker image decodes: ${icon.source}`); assert.equal(icon.mask, "none"); }
      assert.equal(details.pointerEvents, "none");
      assert.equal(details.generated, 0);
      if (details.roomCount) assert.deepEqual(details.zones, ["Entrance", "HeavyContainment"]);
      // Bombsites are static map data: shown with the map whatever the positions do, upright, yellow, beneath markers.
      assert.deepEqual(details.bombsites.map((site) => site.label).sort(), details.roomCount ? expectedBombsites : [], `${name}: bombsites follow the map`);
      const firstOther = details.layerOrder.indexOf("other");
      assert.ok(firstOther === -1 || details.layerOrder.lastIndexOf("bombsite") < firstOther, `${name}: bombsites render beneath the keycard and every marker`);
      for (const site of details.bombsites) {
        const tier = site.edge === "true" ? { height: 18, opacity: 0.7 } : { height: 12, opacity: 0.4 };
        bombsiteTiers.add(site.edge);
        assert.ok(site.loaded, `${name}: bombsite ${site.label} artwork decodes`);
        assert.ok(Math.abs(site.height - tier.height * renderScale) < 0.6, `${name}: bombsite ${site.label} ${site.edge === "true" ? "edge 18px" : "on-map 12px"} tier`);
        assert.ok(Math.abs(site.opacity - tier.opacity) < 1e-6, `${name}: bombsite ${site.label} opacity tier`);
        // An unrotated box keeps the source image's aspect ratio, so heading-up never turns the letter.
        if (site.aspect) assert.ok(Math.abs(site.width / site.height - site.aspect) < 0.08, `${name}: bombsite ${site.label} stays upright`);
        assert.ok(Math.abs(site.offsetX) < 0.6 && Math.abs(site.offsetY) < 0.6, `${name}: bombsite ${site.label} is centred on its site`);
        assert.match(site.filter, /url\(.*drop-shadow/, `${name}: bombsite ${site.label} is washed yellow with a dark outline`);
        if (details.fullMap === "true") assert.equal(site.edge, "false", `${name}: the full map fits every bombsite`);
      }
      const shot = await request("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(join(outputDir, `${width}x${height}-${name}.png`), Buffer.from(shot.data, "base64"));
      const crop = await request("Page.captureScreenshot", { format: "png", clip: { ...details.circle, scale: 1 } });
      const cropBuffer = Buffer.from(crop.data, "base64");
      details.radarPixelHash = createHash("sha256").update(cropBuffer).digest("hex");
      await writeFile(join(outputDir, `${width}x${height}-${name}-radar.png`), cropBuffer);
      report.push(details);
      console.log(`${width}x${height} ${name}: ${details.availability}, ${details.shape}, ${details.roomCount} rooms, ${details.markers.length} markers`);
      return details;
    }
    await capture("hcz-fixed", { availability: "live", camera: "follow", orientation: "fixed" });
    await configure({ orientation: "heading-up", motion: true });
    const movingBefore = await evaluate('document.querySelector(".minimap-map__room image").getAttribute("transform")');
    const samples = [];
    for (let index = 0; index < 8; index++) {
      await wait(80);
      samples.push(await auditMapTransform());
    }
    assert.ok(samples.some((sample) => sample.rooms.some((room) => {
      const initial = samples[0].rooms.find((item) => item.id === room.id);
      return initial && Math.hypot(initial.x - room.x, initial.y - room.y) > 0.01;
    })), "full room images follow actual camera motion");
    cameraMotion.push({ viewport: [width, height], samples });
    assert.notEqual(await evaluate('document.querySelector(".minimap-map__room image").getAttribute("transform")'), movingBefore, "Live browser SVG must follow moving viewpoint");
    await configure({ motion: false });
    await capture("hcz-heading", { availability: "live", camera: "follow", orientation: "heading-up" });
    await configure({ zone: "Entrance", orientation: "fixed" });
    await capture("entrance-fixed", { availability: "live", orientation: "fixed" });
    await configure({ zone: "Entrance", orientation: "heading-up" });
    await capture("entrance-heading", { availability: "live", orientation: "heading-up" });
    await configure({ scoreboard: true });
    await capture("alive-full-map", { fullMap: "true", viewerAlive: "true", shape: "square" });
    await configure({ life: "dead", scoreboard: true });
    await until('document.querySelector(".minimap-radar").dataset.fullMap === "true"');
    const full = await capture("dead-full-map", { fullMap: "true", viewerAlive: "false" });
    assert.equal(full.markers.filter((m) => m.visibility === "spotted-by-teammate").length, 2);
    await evaluate(`${control}.setFocused(false)`);
    await capture("focus-lost", { fullMap: "false" });
    await evaluate(`${control}.setFocused(true)`);
    await wait(180);
    await capture("focus-restored-held", { fullMap: "false" });
    await configure({ scoreboard: false });
    await configure({ scoreboard: true });
    await capture("scoreboard-rearmed", { fullMap: "true" });
    await configure({ scoreboard: false, spectate: 1 });
    const spectated = await capture("dead-spectate", { viewerAlive: "false", fullMap: "false" });
    assert.equal(spectated.markers.filter((m) => m.visibility === "spotted-by-teammate").length, 2);
    await configure({ life: "no-viewpoint" });
    const noViewpoint = await capture("no-viewpoint", { availability: "waiting-viewpoint", camera: "overview" });
    await configure({ enemies: false });
    const removed = await capture("enemy-removed");
    assert.equal(removed.markers.length, 2);
    assert.deepEqual(removed.mapTransforms, noViewpoint.mapTransforms, "removing markers with a fixed camera does not move room artwork");
    await configure({ paused: true });
    await until('document.querySelector(".minimap-radar").dataset.availability === "stale"');
    const stale = await capture("stale", { availability: "stale", fullMap: "false" });
    assert.equal(stale.markers.length, 0);
    assert.ok(stale.roomCount > 0);
    await configure({ paused: false, life: "alive", enemies: true });
    await evaluate(`${control}.invalidate("invalid")`);
    await until('document.querySelector(".minimap-radar").dataset.availability === "invalid"');
    assert.equal((await capture("invalid-frame", { fullMap: "false" })).markers.length, 0);
    await evaluate(`${control}.rebuild()`);
    await configure({ paused: false });
    await until('document.querySelector(".minimap-radar").dataset.availability === "live"');
    await capture("rebuilt", { availability: "live" });
    await evaluate(`${control}.invalidate("incompatible")`);
    await until('document.querySelector(".minimap-radar").dataset.availability === "incompatible"');
    assert.equal((await capture("incompatible", { availability: "incompatible" })).markers.length, 0);
    await evaluate(`${control}.reconnect()`);
    await configure({ paused: false, scoreboard: false });
    await until('document.querySelector(".minimap-radar").dataset.availability === "live"');
    await capture("reconnected", { availability: "live" });
    await configure({ bombsites: false });
    await until('document.querySelector(".minimap-radar").dataset.availability === "live" && !document.querySelector(".minimap-bombsite")');
    expectedBombsites = [];
    await capture("no-bombsites", { availability: "live" });
    await configure({ bombsites: true });
    await until('document.querySelector(".minimap-radar").dataset.availability === "live" && document.querySelectorAll(".minimap-bombsite").length === 2');
    expectedBombsites = ["A", "B"];
    await evaluate(`${control}.disconnect()`);
    await until('document.querySelector(".minimap-radar").dataset.availability === "disconnected"');
    assert.equal((await capture("disconnected", { fullMap: "false" })).markers.length, 0);

    // Exercise the public preview preset, then hold the map stationary so actual
    // raster differences cannot come from moving markers, titles or HUD clocks.
    await request("Page.navigate", { url: `${previewUrl}?hudDebug=0&shopDebug=0&background=1&minimapMotion=0&minimapPreset=cs2-reference` });
    await until('document.querySelector(".minimap-radar")?.dataset.availability === "live" && !!window.__SLUI_MINIMAP_DEBUG__');
    const reference = await capture("cs2-reference", { shape: "circle", orientation: "heading-up", mapScale: "0.25", mapBlend: "true", blurBackground: "true", pageBackdrop: "true" });
    assert.ok(reference.location.length > 0 && !["两区概览", "办公区", "重收容区"].includes(reference.location), "fixture named room appears in the dashboard");
    const referenceTransform = reference.mapTransforms;
    // Measure a known page background through the real, screen-blended radar.
    // Hash changes alone also passed on browsers that never composited blur.
    const sceneStyle = await evaluate(`(() => {
      const scene = document.querySelector('#SlgoOverlayRoot');
      const original = scene.getAttribute('style');
      scene.style.background = 'repeating-linear-gradient(90deg, #000 0 8px, #fff 8px 16px)';
      return original;
    })()`);
    const clip = { x: Math.floor(reference.circle.x), y: Math.floor(reference.circle.y),
      width: Math.ceil(reference.circle.x + reference.circle.width) - Math.floor(reference.circle.x),
      height: Math.ceil(reference.circle.y + reference.circle.height) - Math.floor(reference.circle.y), scale: 1 };
    const contrastSamples = [];
    try {
      for (const enabled of [false, true]) {
        await configure({ mapBlend: true, backgroundAlpha: 0.63, blurBackground: enabled });
        const shot = await request("Page.captureScreenshot", { format: "png", clip });
        await writeFile(join(outputDir, `${width}x${height}-blur-stripes-${enabled ? "on" : "off"}.png`), Buffer.from(shot.data, "base64"));
        contrastSamples.push(await evaluate(`(async () => {
          const image = new Image(); image.src = ${JSON.stringify(`data:image/png;base64,${shot.data}`)};
          await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          const rgba = context.getImageData(0, 0, image.width, image.height).data;
          const origin = ${JSON.stringify(clip)}, circle = ${JSON.stringify(reference.circle)};
          const boxes = [...document.querySelectorAll('.minimap-marker:not(.minimap-marker--edge) .minimap-marker__dot')].map(dot => {
            const r = dot.getBoundingClientRect(), marker = dot.closest('.minimap-marker');
            return { id: marker.dataset.playerId, visibility: marker.dataset.visibility, role: marker.dataset.role,
              x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height };
          });
          const rgb = (x, y) => rgba.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3);
          const luminance = (x, y) => { const [r,g,b] = rgb(x,y); return .2126*r + .7152*g + .0722*b; };
          const cx = circle.x - origin.x + circle.width / 2, cy = circle.y - origin.y + circle.height / 2;
          const usable = (x, y) => Math.hypot(x-cx, y-cy) < circle.width * .36
            && !boxes.some(b => x >= b.x-5 && x < b.x+b.width+5 && y >= b.y-5 && y < b.y+b.height+5);
          let sum = 0, pairs = 0;
          for (let y = 0; y < image.height; y++) for (let x = 0; x + 8 < image.width; x++) {
            if (usable(x,y) && usable(x+8,y)) { sum += Math.abs(luminance(x,y)-luminance(x+8,y)); pairs++; }
          }
          const markers = boxes.filter(b => b.visibility !== 'self').map(box => {
            let coloredPixels = 0, peakChroma = 0;
            for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(image.height, Math.ceil(box.y+box.height)); y++) {
              for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(image.width, Math.ceil(box.x+box.width)); x++) {
                const [r,g,b] = rgb(x,y), chroma = Math.max(r,g,b)-Math.min(r,g,b);
                const matchingHue = box.visibility.startsWith('spotted-') ? r > g+70 && r > b+70
                  : box.role === 'ntf' ? b > r+70 && g > r+50 : r > g+70 && r > b+60;
                if (matchingHue) { coloredPixels++; peakChroma = Math.max(peakChroma, chroma); }
              }
            }
            return { id: box.id, coloredPixels, peakChroma };
          });
          return { enabled: ${enabled}, contrast: sum/pairs, pairs, markers,
            blend: getComputedStyle(document.querySelector('.minimap-radar__map')).mixBlendMode,
            foregroundFilters: ['.minimap-overlay', '.minimap-design-canvas', '.minimap-radar',
              '.minimap-radar__viewport', '.minimap-radar__map', '.minimap-radar__markers'].map(s => getComputedStyle(document.querySelector(s)).filter) };
        })()`));
      }
    } finally {
      await evaluate(`(() => {
        const scene = document.querySelector('#SlgoOverlayRoot'), original = ${JSON.stringify(sceneStyle)};
        if (original === null) scene.removeAttribute('style'); else scene.setAttribute('style', original);
      })()`);
      await configure({ blurBackground: true });
    }
    const [sharp, blurred] = contrastSamples;
    assert.ok(sharp.pairs > 100 && sharp.contrast > 30, "stripe baseline has measurable high-frequency background detail");
    assert.ok(blurred.contrast < sharp.contrast * 0.25,
      `Backdrop blur must remove at least 75% of stripe contrast with mapBlend=true (off=${sharp.contrast.toFixed(2)}, on=${blurred.contrast.toFixed(2)}). Use a browser that actually composites backdrop filters; CSS support alone is insufficient.`);
    assert.equal(blurred.blend, "screen");
    assert.ok(blurred.foregroundFilters.every(value => value === "none"), "blur must not filter the foreground layers");
    const coloredMarkers = sharp.markers.filter(marker => marker.coloredPixels >= 2);
    assert.ok(coloredMarkers.length > 0, "the actual foreground has visible colored player markers");
    for (const marker of coloredMarkers) {
      const after = blurred.markers.find(candidate => candidate.id === marker.id);
      assert.ok(after.coloredPixels >= marker.coloredPixels * 0.7 && after.peakChroma >= marker.peakChroma * 0.85,
        `marker ${marker.id} retains its colored core while the background loses detail`);
    }
    backdropContrast.push({ viewport: [width, height], sharp, blurred, ratio: blurred.contrast / sharp.contrast });
    async function comparePixels(name, off, on) {
      await configure(off);
      const before = await capture(`${name}-off`);
      const stable = await request("Page.captureScreenshot", { format: "png", clip: { ...before.circle, scale: 1 } });
      assert.equal(createHash("sha256").update(Buffer.from(stable.data, "base64")).digest("hex"), before.radarPixelHash, `${name}: stationary baseline pixels are repeatable`);
      await configure(on);
      const after = await capture(`${name}-on`);
      assert.deepEqual(before.mapTransforms, after.mapTransforms, `${name}: camera and artwork do not change`);
      assert.deepEqual(before.markers, after.markers, `${name}: authorized marker positions do not change`);
      assert.notEqual(before.radarPixelHash, after.radarPixelHash, `${name}: setting changes rendered radar pixels`);
      pixelComparisons.push({ viewport: [width, height], setting: name, before: before.radarPixelHash, after: after.radarPixelHash });
    }
    await comparePixels("background-alpha", { backgroundAlpha: 0 }, { backgroundAlpha: 1 });
    await configure({ backgroundAlpha: 0.63 });
    await comparePixels("background-blur", { blurBackground: false }, { blurBackground: true });
    await comparePixels("map-blend", { mapBlend: false }, { mapBlend: true });
    await configure({ hudScale: 0.8 });
    const smallHud = await capture("hud-small", { hudScale: "0.8" });
    await configure({ hudScale: 1.3 });
    const largeHud = await capture("hud-large", { hudScale: "1.3" });
    assert.deepEqual(smallHud.mapTransforms, largeHud.mapTransforms, "HUD scale does not change map camera");
    assert.ok(reference.hudWidth > 0, "independent match HUD is present");
    assert.equal(smallHud.hudWidth, reference.hudWidth, "small radar leaves other HUD size intact");
    assert.equal(largeHud.hudWidth, reference.hudWidth, "large radar leaves other HUD size intact");
    await configure({ hudScale: 1, mapScale: 1 });
    const near = await capture("map-near", { mapScale: "1" });
    assert.equal(near.circle.width, reference.circle.width, "map zoom leaves the HUD frame size intact");
    assert.notDeepEqual(near.mapTransforms, referenceTransform, "map zoom changes projected room geometry");
    await configure({ mapScale: 0.25, alternateMapScale: 1, alternateZoomActive: true });
    const alternate = await capture("alternate-zoom", { alternateZoom: "true", fullMap: "false", mapScale: "1" });
    assert.deepEqual(alternate.mapTransforms, near.mapTransforms, "alternate scale is independent from scoreboard overview");
    await configure({ alternateZoomActive: false, alwaysCentered: false });
    const noncentered = await capture("noncentered", { fullMap: "false", mapScale: "0.25" });
    assert.notDeepEqual(noncentered.mapTransforms, referenceTransform, "non-centered camera clamps to the rotated zone extent");
    await configure({ alwaysCentered: true, forceSquare: true });
    await capture("force-square", { shape: "square", fullMap: "false" });
    await configure({ forceSquare: false, squareWithScoreboard: false, scoreboard: true });
    await capture("scoreboard-circle", { shape: "circle", fullMap: "true" });
    await configure({ scoreboard: false, mapScale: 1, dynamicZoom: true, dynamicTargets: "near" });
    const dynamic = await capture("dynamic-zoom", { dynamicZoom: "true", fullMap: "false" });
    assert.ok(Number(dynamic.mapScale) >= 0.25 && Number(dynamic.mapScale) <= 1, "dynamic scale stays in the selected range");
    await configure({ dynamicTargets: "far" });
    const expanded = await capture("dynamic-far-target", { dynamicZoom: "true", fullMap: "false" });
    assert.ok(Number(expanded.mapScale) < Number(dynamic.mapScale), "a fresh authorized far target expands the radar");
    assert.notDeepEqual(expanded.mapTransforms, dynamic.mapTransforms, "dynamic expansion moves actual room image geometry");
    await configure({ dynamicTargets: "near" });
    const recovery = [];
    for (let sample = 0; sample < 12; sample += 1) {
      recovery.push(await evaluate(`(() => ({ time: performance.now(), scale: Number(document.querySelector('.minimap-radar').dataset.mapScale),
        transform: document.querySelector('.minimap-map__room image').getAttribute('transform') }))()`));
      if (sample < 11) await wait(450);
    }
    const recoveryStart = recovery[0];
    assert.ok(recovery.filter((sample) => sample.time - recoveryStart.time < 1400)
      .every((sample) => sample.scale <= recoveryStart.scale + 0.001), "dynamic recovery waits before zooming back in");
    assert.ok(recovery.some((sample) => sample.scale > recoveryStart.scale + 0.05 && sample.scale < 0.999), "dynamic recovery visibly progresses through intermediate scales");
    assert.ok(recovery.at(-1).scale > recoveryStart.scale + 0.1, "dynamic camera recovers after target extent shrinks");
    assert.ok(recovery.every((sample) => sample.scale >= 0.25 && sample.scale <= 1));
    cameraMotion.push({ viewport: [width, height], kind: "dynamic-recovery", samples: recovery });
    await capture("dynamic-recovered", { dynamicZoom: "true" });

    await request("Page.navigate", { url: `${previewUrl}?hudDebug=0&shopDebug=0&background=0&minimapMotion=0&minimapPreset=cs2-reference` });
    await until('document.querySelector(".minimap-radar")?.dataset.availability === "live" && !!window.__SLUI_MINIMAP_DEBUG__');
    const transparent = await capture("transparent-capability-fallback", { pageBackdrop: "false", blurBackground: "false" });
    assert.equal(transparent.backdropFilter, "none", "no page backdrop deterministically disables effective blur");
  }
  assert.deepEqual([...bombsiteTiers].sort(), ["false", "true"], "both bombsite tiers (on-map and edge) were rendered");
  assert.deepEqual(runtimeErrors, [], "Browser runtime/resource errors");
  await saveReport("passed");
  console.log(`Minimap browser audit passed: ${report.length} screenshots in ${outputDir}`);
} catch (error) {
  auditError = error;
  try { await saveReport("failed", error); }
  catch (writeError) { console.warn(`Unable to save failed audit report: ${writeError.message}`); }
  throw error;
} finally {
  // The launcher may already have exited after de-elevating. Close the browser
  // reached through this isolated profile's endpoint, including on audit failure.
  if (socket?.readyState === WebSocket.OPEN) {
    const closed = new Promise((done) => {
      const timeout = setTimeout(() => done(false), 5000);
      socket.addEventListener("close", () => { clearTimeout(timeout); done(true); }, { once: true });
    });
    try {
      socket.send(JSON.stringify({ id: -1, method: "Browser.close" }));
      if (!await closed) console.warn(`Audit browser did not confirm shutdown; temporary profile: ${profile}`);
    } catch (error) {
      console.warn(`Unable to close audit browser for ${profile}: ${error.message}`);
    }
  }
  socket?.close();
  try {
    if (browser.exitCode === null && !browser.killed) {
      const exited = new Promise((done) => browser.once("exit", done));
      browser.kill();
      await Promise.race([exited, wait(3000)]);
    }
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()), "Only remove the temporary audit profile");
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch (error) {
    console.warn(`Audit profile cleanup failed; retained path ${profile}: ${error.message}`);
    if (!auditError) process.exitCode = 1;
  }
}
