import assert from "node:assert/strict";

// Bottom HUD geometry (balance, circle, kill cards, clip and reserve) against the 1920x1080 CS2 recordings and
// hudhealthammocenter.css, in a CDP-enabled browser on port 9223 showing the mock preview (`npm run dev:mock`).
// Each scene is pinned with `hudSceneAt`, which also turns the animations off.
// Usage: BOTTOMHUD_VIEWPORT_WIDTH=1600 BOTTOMHUD_VIEWPORT_HEIGHT=900 npm run bottomhud-layout-audit
const previewOrigin = process.env.BOTTOMHUD_PREVIEW_URL ?? "http://localhost:1430/";
const viewportWidth = Number(process.env.BOTTOMHUD_VIEWPORT_WIDTH ?? 1920);
const viewportHeight = Number(process.env.BOTTOMHUD_VIEWPORT_HEIGHT ?? 1080);
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
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
const canvasX = viewportWidth / 2 - 960 * scale;
const near = (actual, expected, label, tolerance = 0.75) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual} vs ${expected}`);
const nearX = (actual, designX, label, tolerance) => near(actual, canvasX + designX * scale, label, tolerance);
const nearY = (actual, designY, label, tolerance) => near(actual, designY * scale, label, tolerance);
const nearSize = (actual, design, label, tolerance) => near(actual, design * scale, label, tolerance);

const NTF = "rgb(150, 200, 250)";
const SCP = "rgb(217, 70, 82)";
// The mock local player is team-a's first player (NTF, $14600) or team-b's (SCP, $3200).
const SCENES = [
  { scene: "bottom-kills", at: 300, kills: 0, balance: "$14600", clip: "40", reserve: "120", wash: NTF },
  { scene: "bottom-kills", at: 2_100, kills: 2, balance: "$14600", clip: "40", reserve: "120", wash: NTF },
  { scene: "bottom-kills", at: 7_000, kills: 5, balance: "$14600", clip: "40", reserve: "120", wash: NTF },
  { scene: "bottom-kills", at: 21_000, kills: 14, balance: "$14600", clip: "40", reserve: "120", wash: NTF },
  { scene: "bottom-kills", at: 5_000, viewerTeam: "team-b", kills: 4, balance: "$3200", clip: null, wash: SCP },
  { scene: "bottom-fire", at: 4_200, kills: 0, balance: "$14600", clip: "5", reserve: "120", wash: NTF, low: true },
  { scene: "bottom-balance", at: 9_500, kills: 0, balance: "$0", clip: "40", reserve: "120", wash: NTF },
  { scene: "bottom-dead", at: 1_000, hidden: true },
];

const measure = `JSON.stringify((() => {
  const root = document.querySelector(".bhud");
  if (!root) return { present: false };
  const rect = (node) => { const box = node?.getBoundingClientRect(); return box ? { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom } : null; };
  const cards = [...root.querySelectorAll(".bhud-kills__hand > .bhud-card")];
  const shadowed = [...root.querySelectorAll("*")].filter((node) => getComputedStyle(node).textShadow !== "none").length;
  return {
    present: true,
    still: root.dataset.still ?? null,
    row: rect(root),
    circle: rect(root.querySelector(".bhud__disc")),
    balance: rect(root.querySelector(".bhud-odometer")),
    balanceText: root.querySelector(".bhud-odometer").getAttribute("aria-label"),
    balanceCells: root.querySelectorAll(".bhud-odometer__cell").length,
    balanceColor: getComputedStyle(root.querySelector(".bhud__balance")).color,
    clip: root.querySelector(".bhud-weapon__clip-label")?.textContent ?? null,
    clipBox: rect(root.querySelector(".bhud-weapon__clip")),
    bar: rect(root.querySelector(".bhud-weapon__bar")),
    reserve: root.querySelector(".bhud-weapon__reserve")?.textContent ?? null,
    low: root.querySelector(".bhud-weapon")?.dataset.low ?? null,
    cards: cards.length,
    counter: root.querySelector(".bhud-card--counter .bhud-card__number")?.textContent ?? null,
    numbers: [...root.querySelectorAll(".bhud-kills__hand .bhud-card__number")].map((node) => node.textContent),
    strokeLeft: rect(root.querySelector(".bhud__stroke--left")),
    strokeRight: rect(root.querySelector(".bhud__stroke--right")),
    shadowed,
    burst: root.querySelector(".bhud-burst") !== null,
  };
})())`;

await call("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
const results = [];
for (const expected of SCENES) {
  const url = new URL(previewOrigin);
  url.searchParams.set("hudDebug", "0");
  url.searchParams.set("shopDebug", "0");
  url.searchParams.set("hudScene", expected.scene);
  url.searchParams.set("hudSceneAt", String(expected.at));
  url.searchParams.set("viewerTeam", expected.viewerTeam ?? "team-a");
  await call("Page.navigate", { url: url.href });
  let audit = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const ready = await evaluate(`document.querySelector('.hud-team-counter') !== null && document.fonts.status === 'loaded'
      && (${expected.hidden === true} || document.querySelectorAll('.bhud-kills__hand > .bhud-card').length === ${expected.kills > 5 ? 1 : expected.kills ?? 0})`);
    if (ready) {
      // One more scene tick, so a hidden HUD cannot be a not-yet-mounted one.
      await new Promise((resolve) => setTimeout(resolve, 600));
      audit = JSON.parse(await evaluate(measure));
      break;
    }
  }
  const label = `${expected.scene} @${expected.at}${expected.viewerTeam ? ` (${expected.viewerTeam})` : ""}`;
  assert.ok(audit, `${label}: the bottom HUD never settled`);
  results.push({ scene: label, ...audit });
  if (expected.hidden) {
    assert.equal(audit.present, false, `${label}: hidden while dead`);
    continue;
  }
  assert.equal(audit.present, true, `${label}: rendered`);
  assert.equal(audit.still, "true", `${label}: pinned scene draws without animation`);
  assert.equal(audit.burst, false, `${label}: no burst in a still`);
  // hud-HA 800 x 72 at y 992; circle 62px (64 minus the 1px inset) centred at (960, 1028).
  nearX(audit.row.x, 560, `${label} row x`);
  nearY(audit.row.y, 992, `${label} row y`);
  nearSize(audit.row.width, 800, `${label} row width`);
  nearX(audit.circle.x + audit.circle.width / 2, 960, `${label} circle centre x`);
  nearY(audit.circle.y + audit.circle.height / 2, 1028, `${label} circle centre y`);
  nearSize(audit.circle.width, 62, `${label} circle size`);
  // Strokes 184px each, from the circle outwards.
  nearX(audit.strokeLeft.x, 744, `${label} left stroke`);
  nearX(audit.strokeRight.right, 1176, `${label} right stroke`);
  // Balance: right edge where CS2's health number ends (x 710), at least six cells.
  nearX(audit.balance.right, 710, `${label} balance right edge`, 1);
  nearY(audit.balance.y + audit.balance.height / 2, 1028 - 1, `${label} balance centre y`, 1.5);
  assert.equal(audit.balanceText, expected.balance, `${label} balance`);
  assert.ok(audit.balanceCells >= 6, `${label}: at least six odometer cells`);
  assert.equal(audit.balanceColor, expected.wash, `${label} team colour`);
  if (expected.clip === null) {
    assert.equal(audit.clip, null, `${label}: no firearm, empty right block`);
  } else {
    assert.equal(audit.clip, expected.clip, `${label} clip`);
    assert.equal(audit.reserve, expected.reserve, `${label} reserve`);
    // Clip label 70px from x 1192; clip bar 65 x 2 at y 1047-1048, no border (recording).
    nearX(audit.clipBox.x, 1192, `${label} clip x`);
    nearSize(audit.bar.width, 65, `${label} clip bar width`);
    nearSize(audit.bar.height, 2, `${label} clip bar height`);
    nearY(audit.bar.bottom, 1049, `${label} clip bar bottom`);
    assert.equal(audit.low, expected.low ? "true" : null, `${label} low clip`);
  }
  // Kill cards: the fan for 1-5 (only the top card numbered, none on the ace), one counter card from 6.
  if (expected.kills > 5) {
    assert.equal(audit.cards, 1, `${label}: one counter card`);
    assert.equal(audit.counter, String(expected.kills), `${label} counter`);
  } else {
    assert.equal(audit.cards, expected.kills, `${label} cards`);
    assert.deepEqual(audit.numbers, expected.kills === 0 || expected.kills === 5 ? [] : [String(expected.kills)], `${label} card numbers`);
  }
  assert.equal(audit.shadowed, 0, `${label}: no text shadow`);
}
socket.close();
console.log(JSON.stringify(results, null, 2));
console.log(`bottom HUD layout audit: ${viewportWidth}x${viewportHeight} ok (${SCENES.length} scenes)`);
