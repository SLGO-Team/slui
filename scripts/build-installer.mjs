// Builds the distributed installer SLUI-Setup-<version>.exe:
//   1. the SLUI NSIS package (internal artifact, embedded as the payload),
//   2. the installer shell (installer/src-tauri) with that payload,
//   3. copies the shell to src-tauri/target/release/bundle/setup/SLUI-Setup-<version>.exe.
//
// node scripts/build-installer.mjs           production payload (`tauri build --bundles nsis`)
// node scripts/build-installer.mjs --local   local-test payload (`npm run tauri:build:local`)
// node scripts/build-installer.mjs --dev     shell UI only: `tauri dev`, no payload
// add --reuse-payload to skip the NSIS build and embed the package already in bundle/nsis
// (for shell-only changes; the package must match the current version).
//
// The shell shares src-tauri/target with SLUI (installer/src-tauri/.cargo/config.toml), so the
// Tauri dependencies are compiled and stored once.
//
// The shell is a second Tauri app. The root .taurignore hides installer/ from the CLI's
// tauri.conf.json lookup, and here the CLI is pointed at it explicitly with
// TAURI_APP_PATH / TAURI_FRONTEND_PATH (both read by @tauri-apps/cli).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installerDir = join(root, "installer");
const shellTauriDir = join(installerDir, "src-tauri");
const tauriCli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
// The NSIS uninstaller and installer bookkeeping next to slui.exe.
const INSTALL_OVERHEAD_BYTES = 4 * 1024 * 1024;

const args = new Set(process.argv.slice(2));
const mode = args.has("--dev") ? "dev" : args.has("--local") ? "local" : "production";
const reusePayload = args.has("--reuse-payload");

const version = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")).version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
  fail(`src-tauri/tauri.conf.json has no valid version (${version})`);
}

const shellEnv = {
  ...process.env,
  TAURI_APP_PATH: shellTauriDir,
  TAURI_FRONTEND_PATH: installerDir,
};
// The shell exe's version resource follows the SLUI version it installs.
const shellConfig = JSON.stringify({ version });

if (mode === "dev") {
  delete shellEnv.SLUI_SETUP_PAYLOAD;
  run(process.execPath, [tauriCli, "dev", "--config", shellConfig], { cwd: installerDir, env: shellEnv });
  process.exit(0);
}

const started = Date.now();
console.log(`build-installer: SLUI ${version}, ${reusePayload ? "reused" : mode} payload`);
if (reusePayload) {
  // Nothing is built, so nothing tells a local package from a production one.
} else if (mode === "local") {
  run("npm run tauri:build:local", [], { cwd: root, shell: true });
} else {
  run("npm run tauri -- build --bundles nsis", [], { cwd: root, shell: true });
}

const release = join(root, "src-tauri", "target", "release");
const payload = join(release, "bundle", "nsis", `SLUI_${version}_x64-setup.exe`);
const payloadStat = statOrFail(payload, "NSIS package");
// The bundle directory keeps older packages; only one written by this run is accepted.
if (reusePayload) {
  console.log(`build-installer: reusing ${payload} built ${payloadStat.mtime.toLocaleString()}`);
} else if (payloadStat.mtimeMs < started - 1000) {
  fail(`${payload} was not rebuilt by this run`);
}
const appStat = statOrFail(join(release, "slui.exe"), "slui.exe");
const requiredBytes = appStat.size + INSTALL_OVERHEAD_BYTES;

run(process.execPath, [tauriCli, "build", "--config", shellConfig], {
  cwd: installerDir,
  env: {
    ...shellEnv,
    SLUI_SETUP_PAYLOAD: payload,
    SLUI_SETUP_VERSION: version,
    SLUI_SETUP_REQUIRED_BYTES: String(requiredBytes),
  },
});

const shellExe = join(release, "slui-setup.exe");
statOrFail(shellExe, "installer shell");
const outDir = join(release, "bundle", "setup");
mkdirSync(outDir, { recursive: true });
const output = join(outDir, `SLUI-Setup-${version}.exe`);
copyFileSync(shellExe, output);
const size = statSync(output).size;
console.log(`build-installer: ${output} (${size.toLocaleString("en-US")} bytes, payload ${payloadStat.size.toLocaleString("en-US")} bytes)`);

function run(command, commandArgs, options) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", ...options });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${[command, ...commandArgs].join(" ")} exited with ${result.status}`);
}

function statOrFail(path, label) {
  try {
    return statSync(path);
  } catch {
    fail(`${label} not found at ${path}`);
  }
}

function fail(message) {
  console.error(`build-installer: ${message}`);
  process.exit(1);
}
