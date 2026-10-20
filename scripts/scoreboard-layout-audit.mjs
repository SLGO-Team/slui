import assert from "node:assert/strict";

// Scoreboard geometry against the 1920x1080 CS2 captures (task research `cs2-scoreboard-layout.md`), in a CDP-enabled
// browser on port 9223 showing the mock preview (`npm run dev:mock`). The scenes are pinned with `hudSceneAt` and the
// scoreboard with `scoreboard=passive|cursor` (debug build only). Vite listens on localhost, which may not include
// 127.0.0.1. Run it at 16:9, 16:10 and 4:3:
//   SCOREBOARD_VIEWPORT_WIDTH=1728 SCOREBOARD_VIEWPORT_HEIGHT=1080 npm run scoreboard-layout-audit
//   SCOREBOARD_VIEWPORT_WIDTH=1440 SCOREBOARD_VIEWPORT_HEIGHT=1080 npm run scoreboard-layout-audit
const previewOrigin = process.env.SCOREBOARD_PREVIEW_URL ?? "http://localhost:1430/";
const viewportWidth = Number(process.env.SCOREBOARD_VIEWPORT_WIDTH ?? 1920);
const viewportHeight = Number(process.env.SCOREBOARD_VIEWPORT_HEIGHT ?? 1080);
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

// Panorama layout space: scale = height / 1080, canvas min(1920, 1080 * aspect) wide, centred.
const scale = viewportHeight / 1080;
const canvasWidth = Math.min(1920, (1080 * viewportWidth) / viewportHeight);
const canvasX = viewportWidth / 2 - (canvasWidth / 2) * scale;
// The panel is centred on the canvas: capture x 480 at 1920 = canvas centre - 480.
const panelX = canvasWidth / 2 - 480;
const near = (actual, expected, label, tolerance = 0.75) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual} vs ${expected}`);
const nearX = (actual, designX, label, tolerance) => near(actual, canvasX + (panelX + designX - 480) * scale, label, tolerance);
const nearY = (actual, designY, label, tolerance) => near(actual, designY * scale, label, tolerance);
const nearSize = (actual, design, label, tolerance) => near(actual, design * scale, label, tolerance);

const measure = `JSON.stringify((() => {
  const box = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  const panel = document.querySelector(".scoreboard");
  if (!panel) return null;
  const labels = Object.fromEntries([...panel.querySelectorAll(".sb-label")].map((node) => [node.dataset.stat, { ...box(node), text: node.innerText }]));
  const teams = [...panel.querySelectorAll(".sb-team")].map((team) => ({
    role: team.dataset.role,
    emblem: box(team.querySelector(".sb-team__emblem")),
    rows: [...team.querySelectorAll(".sb-row")].map((row) => ({ ...box(row), id: row.dataset.playerId, state: row.dataset.state })),
  }));
  const rounds = Object.fromEntries([...panel.querySelectorAll(".sb-round")].map((round) => [round.dataset.round, box(round.querySelector(".sb-round__tick"))]));
  const buttons = [...panel.querySelectorAll(".sb-meta__button")].map((node) => ({ ...box(node), opacity: getComputedStyle(node.parentElement).opacity }));
  const loss = panel.querySelector(".sb-loss__label");
  const hint = panel.querySelector(".sb-footer__hint");
  const shadows = [...panel.querySelectorAll("*")].filter((node) => getComputedStyle(node).textShadow !== "none").length;
  return {
    panel: box(panel), labels, teams, rounds, buttons,
    loss: loss ? box(loss) : null,
    hint: { ...box(hint), opacity: getComputedStyle(hint).opacity },
    timeline: panel.querySelector(".sb-timeline:not(.sb-timeline--spacer)") !== null,
    shadows,
    mode: document.querySelector(".scoreboard-overlay").dataset.mode,
    generatedNodeCount: document.querySelectorAll("[data-panorama-tag]").length,
    hasRawBindingText: /#Scoreboard_|#SFUI_|\\{[sdg]:/.test(panel.innerText),
  };
})())`;

const SCENES = [
  { name: "competitive passive", query: { hudScene: "scoreboard-competitive", scoreboard: "passive" }, rowsPerTeam: 5, timeline: true, cursor: false },
  { name: "competitive cursor page 2", query: { hudScene: "scoreboard-competitive", scoreboard: "cursor", scoreboardPage: "2" }, rowsPerTeam: 5, timeline: true, cursor: true, page: 2 },
  { name: "casual 10v10", query: { hudScene: "scoreboard-casual", scoreboard: "passive" }, rowsPerTeam: 10, timeline: false, cursor: false },
];

await call("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
for (const scene of SCENES) {
  const url = new URL(previewOrigin);
  for (const [key, value] of Object.entries({ hudDebug: "0", shopDebug: "0", hudSceneAt: "1000", viewerTeam: "team-a", ...scene.query })) url.searchParams.set(key, value);
  await call("Page.navigate", { url: url.href });
  let audit = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const ready = await evaluate(`document.querySelectorAll('.sb-row').length === ${scene.rowsPerTeam * 2} && document.fonts.status === 'loaded'`);
    if (ready) {
      audit = JSON.parse(await evaluate(measure));
      break;
    }
  }
  assert.ok(audit, `${scene.name}: the scoreboard never rendered`);
  assert.equal(audit.mode, scene.cursor ? "cursor" : "passive", scene.name);

  // Panel: 960 wide, centred on the canvas, its centre at y 570; 5v5 competitive is 584 high (capture y 278-861).
  const teamHeight = Math.max(scene.rowsPerTeam * 26, 134);
  const height = 20 + 75 + 26 + teamHeight + (scene.timeline ? 107 : 24) + teamHeight + 40 + 48;
  nearX(audit.panel.x, 480, `${scene.name} panel x`);
  nearSize(audit.panel.width, 960, `${scene.name} panel width`);
  nearSize(audit.panel.height, height, `${scene.name} panel height`);
  nearY(audit.panel.y + audit.panel.height / 2, 570, `${scene.name} panel centre`, 1);
  const top = 570 - height / 2;
  if (scene.rowsPerTeam === 5 && scene.timeline) near(top, 278, "5v5 competitive top");

  // Columns (capture centres): page 1 kills 1121, deaths 1171, assists 1221, HS% 1278; page 2 MVPs 1085, ADR 1285; damage 1335.
  const centre = (label) => label.x + label.width / 2;
  const expectedCentres = scene.page === 2
    ? { mvps: 1085, utilitydamage: 1135, enemiesflashed: 1185, kdr: 1235, adr: 1285, damage: 1335 }
    : { money: 1063, kills: 1121, deaths: 1171, assists: 1221, hsp: 1278, damage: 1335 };
  assert.deepEqual(Object.keys(audit.labels), Object.keys(expectedCentres), `${scene.name} columns`);
  for (const [stat, x] of Object.entries(expectedCentres)) nearX(centre(audit.labels[stat]), x, `${scene.name} ${stat} label`);
  nearY(audit.labels.damage.y, top + 96, `${scene.name} label row y`);

  // Team blocks: emblem 80x80 at x 500, rows 24 high, 26 apart, from x 590; the top team is SCP.
  const [upper, lower] = audit.teams;
  assert.equal(upper.role, "scp");
  assert.equal(lower.role, "ntf");
  const upperTop = top + 121;
  const lowerTop = upperTop + teamHeight + (scene.timeline ? 107 : 24);
  for (const [team, blockTop] of [[upper, upperTop], [lower, lowerTop]]) {
    nearX(team.emblem.x, 500, `${scene.name} emblem x`);
    nearY(team.emblem.y, blockTop, `${scene.name} emblem y`);
    nearSize(team.emblem.width, 80, `${scene.name} emblem size`);
    assert.equal(team.rows.length, scene.rowsPerTeam);
    const ys = team.rows.map((row) => row.y).sort((a, b) => a - b);
    ys.forEach((y, index) => nearY(y, blockTop + 1 + index * 26, `${scene.name} ${team.role} row ${index}`));
    for (const row of team.rows) {
      nearX(row.x, 590, `${scene.name} row x`);
      nearSize(row.width, 770, `${scene.name} row width`);
      nearSize(row.height, 24, `${scene.name} row height`);
    }
  }
  if (scene.rowsPerTeam === 5 && scene.timeline) {
    nearY(Math.min(...upper.rows.map((row) => row.y)), 400, "first top row (capture y 400)");
    nearY(Math.min(...lower.rows.map((row) => row.y)), 641, "first bottom row (capture y 641)");
  }

  // Timeline: round centres 669 + 20 (n - 1) in the first half, 931 + 20 (n - 13) in the second; ticks 18x2 at y 584.
  assert.equal(audit.timeline, scene.timeline, `${scene.name} timeline template`);
  if (scene.timeline) {
    for (const [round, x] of [[1, 669], [5, 749], [12, 889], [13, 931], [24, 1151]]) {
      const tick = audit.rounds[round];
      nearX(tick.x + tick.width / 2, x, `round ${round} centre`);
      nearSize(tick.width, 18, `round ${round} tick width`);
      nearY(tick.y, upperTop + 134 + 2 + 49, `round ${round} tick y`);
    }
    // 战败补偿 is centred in the space right of the rounds area (capture ink x 1296-1354).
    nearX(audit.loss.x + audit.loss.width / 2, 1325, "loss bonus label centre", 2);
  }

  // Cursor buttons: 26 wide, 10 apart, right edge 1360, top y 350 (capture, clipped by the 75px meta).
  if (scene.cursor) {
    assert.equal(audit.buttons.length, 2, "side swap and stats");
    nearX(audit.buttons[1].x, 1334, "stats button x");
    nearX(audit.buttons[0].x, 1298, "side button x");
    nearY(audit.buttons[1].y, top + 72, "stats button y");
    nearSize(audit.buttons[1].width, 26, "button width");
    assert.equal(audit.buttons[1].opacity, "1");
    assert.equal(audit.hint.opacity, "0", "the mouse hint hides in cursor mode");
  } else {
    assert.equal(audit.hint.opacity, "1");
    near(audit.hint.right, canvasX + (panelX + 1410 - 480) * scale, "mouse hint right edge", 1.5);
  }

  assert.equal(audit.shadows, 0, `${scene.name}: no text shadow on new UI`);
  assert.equal(audit.generatedNodeCount, 0);
  assert.equal(audit.hasRawBindingText, false);
}

socket.close();
console.log(`scoreboard layout audit ok at ${viewportWidth}x${viewportHeight}: competitive passive, cursor page 2 and casual 10v10`);
