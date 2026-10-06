import assert from "node:assert/strict";

// Message-zone geometry (alerts, high and low hints, the generator progress card) against the 1920x1080 CS2 captures and recording
// (hudalerts.css / hudhinttext.css), in a CDP-enabled browser on port 9223 showing the mock preview
// (`npm run dev:mock`). Each scene is pinned with `hudSceneAt`, which also turns the animations off.
// Vite listens on localhost, which may not include 127.0.0.1.
// Usage: HUDMESSAGES_VIEWPORT_WIDTH=1600 HUDMESSAGES_VIEWPORT_HEIGHT=900 npm run hudmessages-layout-audit
const previewOrigin = process.env.HUDMESSAGES_PREVIEW_URL ?? "http://localhost:1430/";
const viewportWidth = Number(process.env.HUDMESSAGES_VIEWPORT_WIDTH ?? 1920);
const viewportHeight = Number(process.env.HUDMESSAGES_VIEWPORT_HEIGHT ?? 1080);
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
// Any page will do: the audit navigates it to the preview.
const target = targets.find((candidate) => candidate.type === "page");
if (!target) throw new Error("No CDP page target was found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const call = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  const onMessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== id) return;
    socket.removeEventListener("message", onMessage);
    resolve(message);
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", reject, { once: true });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await call("Runtime.evaluate", { expression, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result?.result?.value;
};

const scale = Math.min(viewportWidth / 1920, viewportHeight / 1080);
// The 1920x1080 canvas is centred horizontally and anchored to the top.
const canvasX = viewportWidth / 2 - 960 * scale;
const near = (actual, expected, label, tolerance = 0.5) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual} vs ${expected}`);
const nearX = (actual, designX, label, tolerance) => near(actual, canvasX + designX * scale, label, tolerance);
const nearY = (actual, designY, label, tolerance) => near(actual, designY * scale, label, tolerance);
const nearSize = (actual, design, label, tolerance) => near(actual, design * scale, label, tolerance);
const nearScale = (design) => design * scale;

// Captures: every box x 810-1109 (300 wide); alert y 750, high hint y 802, low hint y 868; one line
// 40px, two lines 60px (lines 21px apart).
const SLOT_Y = { alert: 750, hint_high: 802, hint_low: 868 };
const GOLD = "rgb(236, 189, 87)";
const BAR = { alert: "rgba(236, 189, 87, 0.5)", hint_high: "rgb(255, 24, 0)", hint_low: GOLD };
// Viewer team-a plays NTF in the mock roster; texts at hudSceneAt 2000 unless `at` says otherwise.
const SCENES = [
  { scene: "match-point", slots: { alert: { text: "赛点", lines: 1, tone: "match_point" } } },
  { scene: "final-round", slots: { alert: { text: "最终局", lines: 1, tone: "final_round" } } },
  { scene: "warmup", slots: { alert: { text: "热身时间 0:43", lines: 1 } } },
  { scene: "timeout", slots: { alert: { text: "SCP 队暂停还剩 0:56", lines: 1 } } },
  { scene: "pause-high-hint", slots: { alert: { text: "NTF 队暂停还剩 0:28", lines: 1 }, hint_high: { text: "当前无法购买", lines: 1 } } },
  // CS2 bomb planted: a two-line high hint, then the standing overload countdown in the same slot.
  { scene: "generator-started", slots: { hint_high: { text: "发电机已被启动。\n离过载还剩 40 秒。", lines: 2 } } },
  { scene: "generator-started", at: 8_000, slots: { hint_high: { text: "离过载还剩 32 秒", lines: 1 } } },
  { scene: "hint-low-keycard", slots: { hint_low: { text: "你捡起了指挥官钥匙卡。", lines: 1 } } },
  { scene: "hint-low-dropped", slots: { hint_low: { text: "您已扔掉 E-11 SR", lines: 1 } } },
  { scene: "generator-start-progress", slots: {}, progress: { text: "你正在启动发电机。", icon: "keycard" } },
  { scene: "generator-shutdown-progress", slots: {}, progress: { text: "你正在关闭发电机。", icon: "keycard" } },
  // Team b's first mock player carries the generator upgrade: the CS2 defuse-kit look.
  { scene: "generator-shutdown-progress", viewerTeam: "team-b", slots: {}, progress: { text: "你正在关闭发电机。", icon: "wire-cutters" } },
  {
    scene: "all-slots",
    progress: { text: "你正在关闭发电机。", icon: "keycard" },
    slots: {
      alert: { text: "赛点", lines: 1, tone: "match_point" },
      hint_high: { text: "你的购买时间已过", lines: 1 },
      hint_low: { text: "你捡起了指挥官钥匙卡。", lines: 1 },
    },
  },
];

const measure = `JSON.stringify((() => {
  const slots = {};
  for (const node of document.querySelectorAll(".hudmsg")) {
    const box = node.querySelector(".hudmsg__box").getBoundingClientRect();
    const text = node.querySelector(".hudmsg__text");
    const leftBar = getComputedStyle(node.querySelector(".hudmsg__bar--left"));
    const rightBar = node.querySelector(".hudmsg__bar--right").getBoundingClientRect();
    slots[node.dataset.hudmsg] = {
      x: box.x, y: box.y, width: box.width, height: box.height,
      text: text.innerText, color: getComputedStyle(text).color, textShadow: getComputedStyle(text).textShadow,
      lineHeight: parseFloat(getComputedStyle(text).lineHeight),
      textHeight: text.getBoundingClientRect().height,
      bar: leftBar.backgroundColor, barWidth: parseFloat(leftBar.width), rightBarRight: rightBar.right,
      tone: node.dataset.tone, flash: node.classList.contains("hudmsg--flash"), still: node.dataset.still ?? null,
    };
  }
  const card = document.querySelector(".hudprogress");
  const rect = (selector) => {
    const box = card?.querySelector(selector)?.getBoundingClientRect();
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom } : null;
  };
  const progress = card ? {
    card: rect(".hudprogress__body"), circle: rect(".hudprogress__circle"),
    // The icon pulses with a transform: its layout box, not the transformed one.
    iconSize: card.querySelector(".hudprogress__icon").offsetWidth,
    info: rect(".hudprogress__info"), side: rect(".hudprogress__side--left"),
    title: card.querySelector(".hudprogress__title").innerText,
    countdown: card.querySelector(".hudprogress__countdown").textContent,
    iconKind: card.dataset.icon, still: card.querySelector(".hudprogress__body").dataset.still ?? null,
    titleShadow: getComputedStyle(card.querySelector(".hudprogress__title")).textShadow,
  } : null;
  return {
    slots,
    progress,
    count: document.querySelectorAll(".hudmsg").length,
    counter: document.querySelector(".hud-team-counter")?.getBoundingClientRect().y ?? null,
    generatedNodeCount: document.querySelectorAll("[data-panorama-tag]").length,
    hasRawBindingText: /#SFUI_|#Panorama_|\\{[sdg]:|\\{(?:time|seconds)_remaining\\}|(?:SFUI|CSGO|SLGO)_[A-Za-z]/.test(document.body.innerText),
  };
})())`;

await call("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
const results = [];
for (const expected of SCENES) {
  const url = new URL(previewOrigin);
  url.searchParams.set("hudDebug", "0");
  url.searchParams.set("shopDebug", "0");
  url.searchParams.set("hudScene", expected.scene);
  url.searchParams.set("hudSceneAt", String(expected.at ?? 2_000));
  url.searchParams.set("viewerTeam", expected.viewerTeam ?? "team-a");
  await call("Page.navigate", { url: url.href });
  const slotCount = Object.keys(expected.slots).length;
  let audit = null;
  // A cold Vite load imports the overlay lazily; wait for every slot and the fonts.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const ready = await evaluate(`document.querySelectorAll('.hudmsg').length === ${slotCount}
      && (document.querySelector('.hudprogress') !== null) === ${expected.progress !== undefined}
      && document.fonts.status === 'loaded'`);
    if (ready) {
      audit = JSON.parse(await evaluate(measure));
      break;
    }
  }
  const label = `${expected.scene}${expected.at ? ` @${expected.at}` : ""}${expected.viewerTeam ? ` (${expected.viewerTeam})` : ""}`;
  assert.ok(audit, `${label}: the message slots never appeared`);
  results.push({ scene: label, ...audit });

  assert.equal(audit.count, slotCount, `${label}: slot count`);
  for (const [slot, want] of Object.entries(expected.slots)) {
    const actual = audit.slots[slot];
    const name = `${label} ${slot}`;
    assert.ok(actual, `${name}: rendered`);
    assert.equal(actual.still, "true", `${name}: pinned scene draws without animation`);
    nearX(actual.x, 810, `${name} x`);
    nearSize(actual.width, 300, `${name} width`);
    nearY(actual.y, SLOT_Y[slot], `${name} y`);
    nearSize(actual.height, want.lines === 1 ? 40 : 60, `${name} height`);
    // Computed styles are canvas pixels (before the overlay scale).
    near(actual.lineHeight, 21, `${name} line pitch`);
    nearSize(actual.textHeight, want.lines === 1 ? 40 : 60, `${name} text block`);
    assert.equal(actual.text, want.text, `${name} text`);
    assert.equal(actual.color, "rgb(255, 255, 255)", `${name} text colour`);
    assert.equal(actual.textShadow, "none", `${name}: no text shadow`);
    assert.equal(actual.bar, BAR[slot], `${name} side bar colour`);
    near(actual.barWidth, 2, `${name} side bar width`);
    nearX(actual.rightBarRight, 1110, `${name} right bar edge`);
    assert.equal(actual.flash, slot === "alert" && (want.tone === "match_point" || want.tone === "final_round"), `${name} flash`);
  }
  if (expected.progress) {
    const { progress } = audit;
    assert.ok(progress, `${label}: progress card rendered`);
    assert.equal(progress.still, "true", `${label}: pinned scene draws without animation`);
    // Card 500x120 at x 710 / y 630, 4px side bars (recording).
    nearX(progress.card.x, 710, `${label} card x`);
    nearY(progress.card.y, 630, `${label} card y`);
    nearSize(progress.card.width, 500, `${label} card width`);
    nearSize(progress.card.height, 120, `${label} card height`);
    nearSize(progress.side.width, 4, `${label} side bar width`);
    // Ring 95px, 10px under the card top (centre y 687.5); icon 50px centred in it.
    nearSize(progress.circle.width, 95, `${label} ring width`);
    nearY(progress.circle.y, 640, `${label} ring y`);
    near(progress.iconSize, 50, `${label} icon size (canvas px)`);
    // The layout is centred as one row: ring margin 10 (left) and info margin 10 (right) are equal gaps.
    near(progress.circle.x - nearScale(10) - progress.card.x, progress.card.right - progress.info.right - nearScale(10), `${label} layout centred`, 1);
    assert.equal(progress.title, expected.progress.text, `${label} title`);
    assert.match(progress.countdown, /^\d\d:\d\d\.\d{3} $/, `${label} countdown mm:ss.mmm`);
    assert.equal(progress.iconKind, expected.progress.icon, `${label} icon`);
    assert.equal(progress.titleShadow, "none", `${label}: no text shadow`);
    // The card ends where the alert slot starts.
    assert.ok(progress.card.bottom <= SLOT_Y.alert * scale + 0.5, `${label}: card overlaps the alert slot`);
  } else {
    assert.equal(audit.progress, null, `${label}: no progress card`);
  }
  // Fixed slots never overlap.
  const boxes = Object.values(audit.slots).sort((a, b) => a.y - b.y);
  for (let index = 1; index < boxes.length; index += 1) {
    assert.ok(boxes[index - 1].y + boxes[index - 1].height <= boxes[index].y + 0.5, `${label}: slots overlap`);
  }
  // The zone is its own layer: the team counter stays at the top.
  assert.ok(audit.counter !== null, `${label}: team counter rendered`);
  nearY(audit.counter, 6, `${label} team counter y`);
  assert.equal(audit.generatedNodeCount, 0, `${label}: generated nodes`);
  assert.equal(audit.hasRawBindingText, false, `${label}: raw key or binding text`);
}
socket.close();
console.log(JSON.stringify(results, null, 2));
console.log(`message zone layout audit: ${viewportWidth}x${viewportHeight} ok (${SCENES.length} scenes)`);
