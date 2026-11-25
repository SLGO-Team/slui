// Packages must carry no mock code: the overlay gets the mocks only as the `harness` prop, which main.tsx
// imports dynamically in the `mock` mode (never built). Fails when code outside src/mocks reaches it in any other
// way: a value import, a re-export (`export ... from`), a side-effect import (`import "..."`) or a dynamic import.
// `import type` / `export type` are erased and allowed.
// Usage: node scripts/mock-boundary-check.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: the pathname keeps %20 and percent-encoded non-ASCII, which no file API opens.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
// Value imports from src/mocks allowed outside it, each behind a build-time constant.
const ALLOWED = new Map([
  ["src/main.tsx", /import\("\.\/mocks\/harness"\)/],
  // Browser previews of the home window's update states, Steam tile and game-condition banners; behind
  // import.meta.env.DEV, so release builds drop them.
  ["src/app/home/HomeApp.tsx", /from "\.\.\/\.\.\/mocks\/(updatePreview|steamPreview|gameConditionsPreview)"/],
]);

const MOCK = String.raw`["']([^"']*\/mocks(?:\/[^"']*)?)["']`;
// Statement starts at a line start: `import` / `export` up to `from "<mock>"` (any specifiers, across lines), a bare
// `import "<mock>"`, and `import("<mock>")` anywhere.
const STATEMENTS = new RegExp(String.raw`^\s*(import|export)\s+(type\s+)?[^;]*?\bfrom\s+${MOCK}|^\s*import\s+${MOCK}|\bimport\(\s*${MOCK}\s*\)`, "gm");

/** Statements in `source` that bring mock code in (type-only ones excluded). */
export function mockImports(source) {
  return [...source.matchAll(STATEMENTS)].filter(([, , typeOnly]) => !typeOnly).map(([statement]) => statement.trim());
}

// The matcher itself, on each form it must catch or let through.
assert.deepEqual(mockImports(`import { a } from "../mocks/x";`), [`import { a } from "../mocks/x"`]);
assert.deepEqual(mockImports(`import {\n  a,\n  b,\n} from '../../mocks/x';`).length, 1, "multi-line, single quotes");
assert.deepEqual(mockImports(`export { a } from "../mocks/x";`), [`export { a } from "../mocks/x"`]);
assert.deepEqual(mockImports(`export * from "./mocks";`), [`export * from "./mocks"`]);
assert.deepEqual(mockImports(`import "../mocks/setup";`), [`import "../mocks/setup"`]);
assert.deepEqual(mockImports(`const m = await import("./mocks/harness");`), [`import("./mocks/harness")`]);
assert.deepEqual(mockImports(`import type { A } from "../mocks/x";\nexport type { A } from "../mocks/x";`), []);
assert.deepEqual(mockImports(`import { a } from "../shocks/x";\nimport b from "./mockery";`), [], "other modules");

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
  for (const statement of mockImports(readFileSync(path, "utf8"))) {
    if (ALLOWED.get(file)?.test(statement)) continue;
    problems.push(`${file}: ${statement}`);
  }
}
if (problems.length > 0) {
  console.error(`Mock code reached outside src/mocks (use src/mocks/harness.ts through the harness prop, or import type):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`mock boundary check passed (${files.length} files)`);
