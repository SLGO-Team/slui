// Builds the distributed installer SLUI-Setup-<version>.exe:
//   1. the installer shell (installer/src-tauri), compiled once for both roles: slui-setup.exe,
//   2. the branded uninstaller slui-uninstall.exe = the shell + an uninstall overlay,
//   3. the SLUI NSIS package (internal artifact, the payload), which installs that uninstaller
//      through src-tauri/windows/installer-hooks.nsh,
//   4. src-tauri/target/release/bundle/setup/SLUI-Setup-<version>.exe = the shell + a setup
//      overlay carrying the payload.
// The overlay layout is the contract with installer/src-tauri/src/overlay.rs.
//
// node scripts/build-installer.mjs           production payload (`tauri build --bundles nsis`)
// node scripts/build-installer.mjs --local   local-test payload (`npm run tauri:build:local`)
// node scripts/build-installer.mjs --dev     shell UI only: `tauri dev`, no payload
//                                            (add --uninstall for the uninstaller UI)
// add --reuse-payload to skip steps 2-3 and attach the package already in bundle/nsis
// (for shell-only changes; the package must match the current version).
// add --theme-pack <dir> to install a local theme pack directory (`fonts/`, `sounds/`) as
// `<install dir>\theme-pack`; the result is SLUI-Setup-<version>-theme-pack.exe and the
// regular installer is left untouched. Nothing is written into the repository.
//
// The uninstaller and the theme pack reach the NSIS package through a generated hooks
// wrapper in target/release that defines their paths and includes installer-hooks.nsh. The
// theme pack is deliberately not a Tauri resource: NSIS deletes registered resources on
// every uninstall, and the uninstaller keeps the pack unless asked to delete it.
//
// The shell is a member of the Cargo workspace rooted at src-tauri (one Cargo.lock, one target
// dir), and workspace-hack unifies the features of their shared dependencies, so the Tauri
// dependencies are compiled and stored once. Its own release compile is about as slow as
// SLUI's, which is why both roles share one build instead of a cargo feature.
//
// The shell is a second Tauri app. The root .taurignore hides installer/ from the CLI's
// tauri.conf.json lookup, and here the CLI is pointed at it explicitly with
// TAURI_APP_PATH / TAURI_FRONTEND_PATH (both read by @tauri-apps/cli).
import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installerDir = join(root, "installer");
const shellTauriDir = join(installerDir, "src-tauri");
const tauriCli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
// The NSIS uninstaller and installer bookkeeping next to slui.exe.
const INSTALL_OVERHEAD_BYTES = 4 * 1024 * 1024;
// MAGIC in installer/src-tauri/src/overlay.rs.
const OVERLAY_MAGIC = Buffer.from("SLUISETUP\0v1\0\0\0\0", "latin1");

const { flags, themePack } = parseArgs(process.argv.slice(2));
const mode = flags.has("--dev") ? "dev" : flags.has("--local") ? "local" : "production";
const reusePayload = flags.has("--reuse-payload");
if (flags.has("--uninstall") && mode !== "dev") fail("--uninstall only applies to --dev");
if (themePack && (mode === "dev" || reusePayload)) {
  fail("--theme-pack builds its own payload; it cannot be combined with --dev or --reuse-payload");
}
if (themePack && !isNonEmptyDirectory(themePack)) fail(`--theme-pack ${themePack} is not a non-empty directory`);

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
  // A debug build without an overlay takes its role from SLUI_SETUP_ROLE (src/lib.rs).
  run(process.execPath, [tauriCli, "dev", "--config", shellConfig], {
    cwd: installerDir,
    env: { ...shellEnv, SLUI_SETUP_ROLE: flags.has("--uninstall") ? "uninstall" : "setup" },
  });
  process.exit(0);
}

const started = Date.now();
const release = join(root, "src-tauri", "target", "release");
const uninstaller = join(release, "slui-uninstall.exe");
console.log(`build-installer: SLUI ${version}, ${reusePayload ? "reused" : mode} payload${themePack ? `, theme pack ${themePack}` : ""}`);

// No freshness check: cargo leaves an up-to-date exe untouched, and there is only one variant.
run(process.execPath, [tauriCli, "build", "--config", shellConfig], { cwd: installerDir, env: shellEnv });
const shellExe = join(release, "slui-setup.exe");
statOrFail(shellExe, "installer shell");

if (!reusePayload) {
  writeWithOverlay(uninstaller, shellExe, { role: "uninstall", version, payloadBytes: 0, requiredBytes: 0 });

  const hooks = writeHooksWrapper(join(release, "slui-installer-hooks.nsh"), {
    SLUI_UNINSTALLER_SOURCE: uninstaller,
    ...(themePack ? { SLUI_THEME_PACK_SOURCE: themePack } : {}),
  });
  // Same as `npm run tauri:build:local` / `npm run tauri -- build --bundles nsis`, but without a
  // shell so the inline config needs no quoting. Tauri merges --config in order.
  const buildArgs = ["build", "--bundles", "nsis"];
  if (mode === "local") buildArgs.push("--config", join("src-tauri", "tauri.local.conf.json"));
  buildArgs.push("--config", JSON.stringify({ bundle: { windows: { nsis: { installerHooks: hooks } } } }));
  run(process.execPath, [tauriCli, ...buildArgs], { cwd: root });
}

const payload = join(release, "bundle", "nsis", `SLUI_${version}_x64-setup.exe`);
const payloadStat = statOrFail(payload, "NSIS package");
// The bundle directory keeps older packages; only one written by this run is accepted.
if (reusePayload) {
  console.log(`build-installer: reusing ${payload} built ${payloadStat.mtime.toLocaleString()}`);
} else if (payloadStat.mtimeMs < started - 1000) {
  fail(`${payload} was not rebuilt by this run`);
}
const appStat = statOrFail(join(release, "slui.exe"), "slui.exe");
const uninstallerStat = statOrFail(uninstaller, "slui-uninstall.exe");
const requiredBytes = appStat.size + uninstallerStat.size + (themePack ? directorySize(themePack) : 0)
  + INSTALL_OVERHEAD_BYTES;

const outDir = join(release, "bundle", "setup");
mkdirSync(outDir, { recursive: true });
const output = join(outDir, `SLUI-Setup-${version}${themePack ? "-theme-pack" : ""}.exe`);
writeWithOverlay(output, shellExe, { role: "setup", version, payloadBytes: payloadStat.size, requiredBytes }, payload);
const size = statSync(output).size;
console.log(`build-installer: ${output} (${size.toLocaleString("en-US")} bytes, payload ${payloadStat.size.toLocaleString("en-US")} bytes)`);
if (themePack) {
  // Keep the themed NSIS package out of a later --reuse-payload, which must fail rather than
  // silently embed it.
  renameSync(payload, payload.replace(/\.exe$/, "-theme-pack.exe"));
}

/**
 * Writes `dest` = the compiled shell + the overlay installer/src-tauri/src/overlay.rs reads:
 * [payload][meta JSON][meta length, u32 LE][OVERLAY_MAGIC].
 */
function writeWithOverlay(dest, shell, meta, payload) {
  copyFileSync(shell, dest);
  const metaBytes = Buffer.from(JSON.stringify(meta), "utf8");
  const metaLength = Buffer.alloc(4);
  metaLength.writeUInt32LE(metaBytes.length);
  const out = openSync(dest, "a");
  try {
    if (payload) appendFile(out, payload, meta.payloadBytes);
    for (const chunk of [metaBytes, metaLength, OVERLAY_MAGIC]) writeSync(out, chunk);
  } finally {
    closeSync(out);
  }
}

/** Appends the file at `path`, which must be `bytes` long, to the open descriptor `out`. */
function appendFile(out, path, bytes) {
  const input = openSync(path, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  let copied = 0;
  try {
    for (let read; (read = readSync(input, buffer, 0, buffer.length, null)) > 0; copied += read) {
      writeSync(out, buffer, 0, read);
    }
  } finally {
    closeSync(input);
  }
  if (copied !== bytes) fail(`${path} changed while it was attached (${copied} of ${bytes} bytes)`);
}

/** Writes an NSIS include that defines `defines` and includes the checked-in hooks. */
function writeHooksWrapper(path, defines) {
  const lines = ["; Generated by scripts/build-installer.mjs; do not edit."];
  for (const [name, value] of Object.entries(defines)) lines.push(`!define ${name} ${nsisString(value)}`);
  lines.push(`!include ${nsisString(join(root, "src-tauri", "windows", "installer-hooks.nsh"))}`);
  // makensis reads an include as UTF-8 when it starts with a BOM; paths may be non-ASCII.
  writeFileSync(path, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
  return path;
}

/** A double-quoted NSIS string; `$` starts a variable there. Windows paths cannot contain `"`. */
function nsisString(value) {
  if (/["\r\n]/.test(value)) fail(`cannot pass ${JSON.stringify(value)} to NSIS`);
  return `"${value.replaceAll("$", "$$$$")}"`;
}

function directorySize(dir) {
  return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return total + directorySize(path);
    return entry.isFile() ? total + statSync(path).size : total;
  }, 0);
}

function parseArgs(argv) {
  const flags = new Set();
  let themePack = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--theme-pack") themePack = argv[++index] ?? "";
    else if (arg.startsWith("--theme-pack=")) themePack = arg.slice("--theme-pack=".length);
    else flags.add(arg);
  }
  if (themePack === null) return { flags, themePack };
  if (!themePack || themePack.startsWith("--")) fail("--theme-pack needs a directory");
  return { flags, themePack: resolve(themePack) };
}

function isNonEmptyDirectory(path) {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

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
