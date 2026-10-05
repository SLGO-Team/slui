import assert from "node:assert/strict";

// Win panel geometry against the 1920x1080 CS2 captures (hudwinpanel.xml / hudwinpanel.css), in a
// CDP-enabled browser on port 9223 showing the mock preview (`npm run dev:mock`). Each scene is pinned
// with `hudSceneAt`, which also turns the panel animations off. Vite listens on localhost, which may
// not include 127.0.0.1.
// Usage: WINPANEL_VIEWPORT_WIDTH=1600 WINPANEL_VIEWPORT_HEIGHT=900 npm run winpanel-layout-audit
const previewOrigin = process.env.WINPANEL_PREVIEW_URL ?? "http://localhost:1430/";
const viewportWidth = Number(process.env.WINPANEL_VIEWPORT_WIDTH ?? 1920);
const viewportHeight = Number(process.env.WINPANEL_VIEWPORT_HEIGHT ?? 1080);
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

// Viewer team-a plays NTF in the mock roster.
const NTF = "rgb(150, 200, 250)";
const SCP = "rgb(217, 70, 82)";
const LOSS = "rgb(219, 68, 55)";
const SCENES = [
  // Kit row present: details are 300px wide, so the 380px block starts at x 770 (capture).
  { scene: "win-mvp-kills", title: "回合胜利", accent: NTF, mvp: true, kit: true, avatarX: 770 },
  // No kit row: the block is 72 + 8 + 250 (name) = 330px wide.
  { scene: "win-mvp-ace", title: "回合胜利", accent: NTF, mvp: true, kit: false, avatarX: 795 },
  { scene: "win-no-mvp", title: "回合胜利", accent: NTF, mvp: false },
  { scene: "lost", title: "回合败北", accent: LOSS, mvp: false },
  { scene: "match-won", title: "比赛胜利", accent: NTF, mvp: true, kit: true, avatarX: 770 },
  { scene: "match-draw", title: "平局", accent: "rgb(226, 226, 226)", mvp: false },
  { scene: "observer", title: "NTF获胜", accent: NTF, mvp: true, kit: false, avatarX: 795 },
  { scene: "win-mvp-kills", viewerTeam: "team-b", title: "回合胜利", accent: SCP, mvp: true, kit: true, avatarX: 770 },
];

const measure = `JSON.stringify((() => {
  const rect = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right,
      text: node.textContent, color: style.color, fontSize: style.fontSize };
  };
  return {
    result: rect(".winpanel-result"), title: rect(".winpanel-result__title"),
    arrowLeft: rect(".winpanel-result__arrows--left"), arrowRight: rect(".winpanel-result__arrows--right"),
    subtitle: rect(".winpanel-result__subtitle"), mvp: rect(".winpanel-mvp"),
    avatar: rect(".winpanel-mvp__avatar"), reason: rect(".winpanel-mvp__reason"), name: rect(".winpanel-mvp__name"),
    kit: rect(".winpanel-mvp__kit"), counter: rect(".hud-team-counter"),
    still: document.querySelector(".winpanel")?.dataset.still ?? null,
    panelCount: document.querySelectorAll(".winpanel").length,
    generatedNodeCount: document.querySelectorAll("[data-panorama-tag]").length,
    hasRawBindingText: /#SFUI_|#Panorama_|\\{[sdg]:|\\{time_remaining\\}|(?:SFUI|CSGO|SLGO)_[A-Za-z]/.test(document.body.innerText),
  };
})())`;

await call("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
const results = [];
for (const expected of SCENES) {
  const url = new URL(previewOrigin);
  url.searchParams.set("hudDebug", "0");
  url.searchParams.set("shopDebug", "0");
  url.searchParams.set("hudScene", expected.scene);
  url.searchParams.set("hudSceneAt", "2000");
  url.searchParams.set("viewerTeam", expected.viewerTeam ?? "team-a");
  await call("Page.navigate", { url: url.href });
  let audit = null;
  // A cold Vite load imports the overlay lazily; wait for the panel and its fonts.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const ready = await evaluate("document.querySelector('.winpanel') !== null && document.fonts.status === 'loaded'");
    if (ready) {
      audit = JSON.parse(await evaluate(measure));
      break;
    }
  }
  const label = `${expected.scene}${expected.viewerTeam ? ` (${expected.viewerTeam})` : ""}`;
  assert.ok(audit, `${label}: the win panel never appeared`);
  results.push({ scene: label, ...audit });

  assert.equal(audit.panelCount, 1, `${label}: one panel`);
  assert.equal(audit.still, "true", `${label}: pinned scene draws without animation`);
  // Title box: x 760-1160, y 190-270 (capture).
  nearX(audit.result.x, 760, `${label} title box x`);
  nearY(audit.result.y, 190, `${label} title box y`);
  nearSize(audit.result.width, 400, `${label} title box width`);
  nearSize(audit.result.height, 80, `${label} title box height`);
  assert.equal(audit.title.text, expected.title, `${label} title text`);
  assert.equal(audit.title.color, expected.accent, `${label} title colour`);
  // Chevrons: 12px inside the 4px bars (capture ink x 776-789 and 1130-1143).
  nearX(audit.arrowLeft.x, 776, `${label} left chevron x`);
  nearX(audit.arrowRight.right, 1144, `${label} right chevron right`);
  nearY(audit.arrowLeft.y, 215, `${label} chevron y`);
  // Subtitle row: 16px, 3px above the box bottom.
  assert.ok(audit.subtitle?.text, `${label} subtitle`);
  nearY(audit.subtitle.y, 251, `${label} subtitle y`);
  nearSize(audit.subtitle.height, 16, `${label} subtitle height`);

  if (!expected.mvp) {
    assert.equal(audit.mvp, null, `${label}: no MVP strip`);
  } else {
    // MVP strip: 640x90 centred, 16px under the title box (capture y 286-376).
    nearX(audit.mvp.x, 640, `${label} MVP strip x`);
    nearY(audit.mvp.y, 286, `${label} MVP strip y`);
    nearSize(audit.mvp.width, 640, `${label} MVP strip width`);
    nearSize(audit.mvp.height, 90, `${label} MVP strip height`);
    nearSize(audit.avatar.width, 72, `${label} avatar width`);
    nearSize(audit.avatar.height, 72, `${label} avatar height`);
    nearY(audit.avatar.y, 295, `${label} avatar y`);
    nearX(audit.avatar.x, expected.avatarX, `${label} avatar x`, 1);
    // Chip 21px tall at y 294 (capture), 8px right of the avatar, in the winner colour.
    nearX(audit.reason.x, expected.avatarX + 80, `${label} chip x`, 1);
    nearY(audit.reason.y, 294, `${label} chip y`, 1);
    nearSize(audit.reason.height, 21, `${label} chip height`);
    nearSize(audit.name.height, 38, `${label} name height`);
    assert.equal(audit.kit !== null, expected.kit, `${label} music-kit row`);
    if (audit.kit) nearSize(audit.kit.height, 16, `${label} kit height`);
  }
  // The panel is its own layer: the team counter stays at the top.
  assert.ok(audit.counter, `${label}: team counter rendered`);
  nearY(audit.counter.y, 6, `${label} team counter y`);
  assert.equal(audit.generatedNodeCount, 0, `${label}: generated nodes`);
  assert.equal(audit.hasRawBindingText, false, `${label}: raw key or binding text`);
}
socket.close();
console.log(JSON.stringify(results, null, 2));
console.log(`win panel layout audit: ${viewportWidth}x${viewportHeight} ok (${SCENES.length} scenes)`);
