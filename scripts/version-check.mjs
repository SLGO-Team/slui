// Fails when the SLUI version differs between the files that carry it. release-please
// bumps all of them in the release PR (release-please-config.json); this check is what
// proves it did, so a release never ships with mismatched npm / Tauri / Cargo versions.
// Usage: node scripts/version-check.mjs
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const json = (path) => JSON.parse(read(path));

// The version line of a Cargo.toml `[package]` table or of a Cargo.lock `[[package]]`
// entry with the given name.
function cargoVersion(path, packageName) {
  for (const block of read(path).split(/^(?=\[)/m)) {
    const header = block.match(/^\[\[?package\]\]?\s*$/m);
    const name = block.match(/^name = "([^"]+)"$/m)?.[1];
    if (header && (!packageName || name === packageName)) return block.match(/^version = "([^"]+)"$/m)?.[1];
  }
  return undefined;
}

const lock = json("package-lock.json");
const versions = [
  ["package.json", json("package.json").version],
  ["package-lock.json version", lock.version],
  ['package-lock.json packages[""].version', lock.packages?.[""]?.version],
  [".release-please-manifest.json", json(".release-please-manifest.json")["."]],
  ["src-tauri/tauri.conf.json", json("src-tauri/tauri.conf.json").version],
  ["installer/src-tauri/tauri.conf.json", json("installer/src-tauri/tauri.conf.json").version],
  ["src-tauri/Cargo.toml", cargoVersion("src-tauri/Cargo.toml")],
  ["installer/src-tauri/Cargo.toml", cargoVersion("installer/src-tauri/Cargo.toml")],
  ["src-tauri/Cargo.lock (slui)", cargoVersion("src-tauri/Cargo.lock", "slui")],
  ["installer/src-tauri/Cargo.lock (slui-setup)", cargoVersion("installer/src-tauri/Cargo.lock", "slui-setup")],
];

const expected = versions[0][1];
if (versions.some(([, version]) => typeof version !== "string" || version !== expected)) {
  console.error("version check failed: the SLUI version must be identical everywhere:");
  for (const [where, version] of versions) console.error(`  ${version === expected ? " " : "x"} ${where}: ${version ?? "(missing)"}`);
  process.exit(1);
}
console.log(`version check passed (${expected} in ${versions.length} places)`);
