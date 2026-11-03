// Usage: node cdp.mjs <port> <targetFilterJs|index> <expression>
// Evaluates `expression` in each page target and prints the JSON result.
const [port, which, expression] = process.argv.slice(2);
const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === "page");
async function evaluate(target, expr) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const result = await new Promise((resolve) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d.result); };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  return result.exceptionDetails ? { error: result.exceptionDetails.exception?.description ?? result.exceptionDetails.text } : result.result.value;
}
for (const [i, t] of targets.entries()) {
  const label = await evaluate(t, "window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null");
  if (which !== "all" && which !== label && which !== String(i)) continue;
  console.log(JSON.stringify({ i, label, value: await evaluate(t, expression) }));
}
