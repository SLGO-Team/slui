import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(process.argv[2] ?? ".trellis/tasks/08-26-panorama-source-translation/research/hud-manual-react-1920x1080.png");
const previewUrl = process.env.HUD_PREVIEW_URL ?? "http://127.0.0.1:1423/";
const viewportWidth = Number(process.env.HUD_VIEWPORT_WIDTH ?? 1920);
const viewportHeight = Number(process.env.HUD_VIEWPORT_HEIGHT ?? 1080);
const auditBackground = process.env.HUD_AUDIT_BACKGROUND ?? "#121518";
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
// The mock HUD writes its debug options into the query string after the first load,
// so the target is matched on origin + path rather than the exact preview URL.
const preview = new URL(previewUrl);
const target = targets.find((candidate) => {
  if (candidate.type !== "page" || !URL.canParse(candidate.url)) return false;
  const url = new URL(candidate.url);
  return url.origin === preview.origin && url.pathname === preview.pathname;
});
if (!target) throw new Error("HUD preview target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let requestId = 0;
function request(method, params = {}) {
  requestId += 1;
  const id = requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolveRequest(message.result);
    };
    socket.addEventListener("message", onMessage);
  });
}

await request("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
// Navigate instead of reloading: a reload keeps whatever preset the debug panel last wrote
// into the URL, while the preview URL restores the default (standard) HUD debug options.
await request("Page.navigate", { url: previewUrl });
await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
// A cold Vite load imports the overlay lazily and can take longer than the fixed wait.
for (let attempt = 0; attempt < 40; attempt += 1) {
  const ready = await request("Runtime.evaluate", { expression: 'document.querySelectorAll(".hud-player").length', returnByValue: true });
  if ((ready.result?.value ?? 0) > 0) break;
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
}
await request("Runtime.evaluate", {
  expression: `document.documentElement.style.background=${JSON.stringify(auditBackground)}; document.body.style.background=${JSON.stringify(auditBackground)}`,
});
const image = await request("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
await writeFile(output, Buffer.from(image.data, "base64"));
socket.close();
console.log(output);
