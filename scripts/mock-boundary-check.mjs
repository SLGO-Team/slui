// Packages must carry no mock code: the overlay gets the mocks only as the `harness` prop, which main.tsx
// imports dynamically in the `mock` mode (never built). Fails when code outside src/mocks imports a value
// from it in any other way; type-only imports are erased and allowed.
// Usage: node scripts/mock-boundary-check.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");
// Value imports from src/mocks allowed outside it, each behind a build-time constant.
const ALLOWED = new Map([
  ["src/main.tsx", /import\("\.\/mocks\/harness"\)/],
  // Browser previews of the home window's update states; behind import.meta.env.DEV, so release builds drop it.
  ["src/app/home/HomeApp.tsx", /from "\.\.\/\.\.\/mocks\/updatePreview"/],
]);

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== join(SRC, "mocks")) walk(path);
    } else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
};
walk(SRC);

const problems = [];
for (const path of files) {
  const file = relative(ROOT, path).replaceAll("\\", "/");
  const source = readFileSync(path, "utf8");
  const imports = [...source.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+"([^"]*\/mocks\/[^"]*)"|import\("([^"]*\/mocks\/[^"]*)"\)/gm)];
  for (const [statement, typeOnly] of imports) {
    if (typeOnly) continue;
    if (ALLOWED.get(file)?.test(statement)) continue;
    problems.push(`${file}: ${statement.trim()}`);
  }
}
if (problems.length > 0) {
  console.error(`Mock values imported outside src/mocks (use src/mocks/harness.ts through the harness prop, or import type):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`mock boundary check passed (${files.length} files)`);
