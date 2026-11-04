// The webview Content Security Policy (scripts/vite-csp.mjs): directives, placement in index.html
// and the inline-element hashes. A real build is checked by `npm run build` in CI.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildContentSecurityPolicy, contentSecurityPolicy, injectContentSecurityPolicy, inlineHashes } from "./vite-csp.mjs";

const directives = (policy) => new Map(policy.split("; ").map((directive) => {
  const [name, ...sources] = directive.split(" ");
  return [name, sources];
}));

{
  const production = directives(buildContentSecurityPolicy({ dev: false, controlPlaneOrigin: "https://cp.example.com:8443" }));
  assert.deepEqual(production.get("default-src"), ["'none'"]);
  assert.deepEqual(production.get("script-src"), ["'self'"]);
  assert.deepEqual(production.get("style-src"), ["'self'"]);
  assert.deepEqual(production.get("img-src"), ["'self'", "data:", "https:"]);
  assert.deepEqual(production.get("font-src"), ["'self'", "theme:", "http://theme.localhost"]);
  assert.deepEqual(production.get("media-src"), ["'self'", "theme:", "http://theme.localhost"]);
  assert.deepEqual(production.get("connect-src"), ["'self'", "ipc:", "http://ipc.localhost", "https://cp.example.com:8443"]);
  for (const name of ["object-src", "base-uri", "form-action", "frame-src", "worker-src"]) assert.deepEqual(production.get(name), ["'none'"], name);
  assert.ok(![...production.values()].flat().some((source) => source.startsWith("'unsafe")), "no unsafe sources outside the dev server");
}

{
  const dev = directives(buildContentSecurityPolicy({ dev: true, controlPlaneOrigin: null, scriptHashes: ["'sha256-a'"] }));
  assert.deepEqual(dev.get("script-src"), ["'self'", "'sha256-a'"], "the dev server's inline preamble runs by hash, not unsafe-inline");
  assert.deepEqual(dev.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(dev.get("connect-src"), ["'self'", "ipc:", "http://ipc.localhost", "ws:", "wss:"]);
}

{
  const preamble = "\nimport { injectIntoGlobalHook } from \"/@react-refresh\";\n";
  const html = `<head><meta charset="UTF-8" /><script type="module">${preamble}</script><script type="module" src="/src/main.tsx"></script><style>a{}</style></head>`;
  const hash = (text) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
  assert.deepEqual(inlineHashes(html), { scriptHashes: [hash(preamble)], styleHashes: [hash("a{}")] }, "external scripts are not hashed");

  const injected = injectContentSecurityPolicy(html, "default-src 'none'");
  assert.ok(injected.startsWith("<head><meta charset=\"UTF-8\" />\n    <meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\" />"),
    "the policy follows <meta charset> and precedes every script and style");
  assert.ok(injectContentSecurityPolicy("<html><head><script></script>", "x").startsWith("<html><head>\n    <meta http-equiv=\"Content-Security-Policy\""),
    "without <meta charset> it opens <head>");
  assert.throws(() => injectContentSecurityPolicy("<body></body>", "x"), /no <head>/);
}

{
  // The plugin: the control plane's origin (not its path) is the only extra connect-src in a build.
  const plugin = contentSecurityPolicy({ controlPlaneUrl: "https://cp.example.com:8443/base" });
  plugin.configResolved({ command: "build" });
  const html = plugin.transformIndexHtml.handler("<!doctype html><html><head><meta charset=\"UTF-8\" /></head><body></body></html>");
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
  assert.deepEqual(directives(policy).get("connect-src"), ["'self'", "ipc:", "http://ipc.localhost", "https://cp.example.com:8443"]);
  assert.equal(plugin.transformIndexHtml.order, "post");
}

console.log("csp smoke: ok");
