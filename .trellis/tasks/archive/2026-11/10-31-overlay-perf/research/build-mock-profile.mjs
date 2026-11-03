// Profiling only, never packaged: a production-React build of the mock overlay, so profile-overlay.cjs can
// measure without React's dev runtime. vite.config.ts refuses to build the mock mode on purpose; this calls
// Vite's build() with configFile: false instead.
// Usage: node .trellis/tasks/10-31-overlay-perf/research/build-mock-profile.mjs . <scratch-out-dir>
//        python3 -m http.server 1430 --bind 127.0.0.1 --directory <scratch-out-dir>
//        OVERLAY_URL=http://127.0.0.1:1430/ node .trellis/tasks/10-31-overlay-perf/research/profile-overlay.cjs
import { createRequire } from "node:module";
import { resolve } from "node:path";

const [repoArg = ".", outDir] = process.argv.slice(2);
if (!outDir) throw new Error("Usage: build-mock-profile.mjs <repo> <out-dir>");
const repo = resolve(repoArg);
const require = createRequire(resolve(repo, "package.json"));
const { build } = await import(require.resolve("vite"));
const react = (await import(require.resolve("@vitejs/plugin-react"))).default;
await build({ root: repo, configFile: false, mode: "mock", logLevel: "warn", plugins: [react()],
  build: { outDir: resolve(outDir), emptyOutDir: true } });
console.log(`built ${resolve(outDir)}`);
