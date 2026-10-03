// The repository is public. Fails when tracked files contain machine-specific
// paths, real SteamIDs, CS2-extracted assets, or media under .trellis/ (task
// research is text only; screenshots of CS2-era builds embed CS2 assets).
// Usage: node scripts/public-content-check.mjs
import { execFileSync } from "node:child_process";

const SELF = "scripts/public-content-check.mjs";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const files = git("ls-files", "-z").split("\0").filter(Boolean);
const problems = [];

const FILE_RULES = [
  [/^\.trellis\/.*\.(png|jpe?g|webp|gif|bmp|wav|ogg|mp3|ttf|otf|woff2?)$/i, "media file under .trellis/"],
  [/stratum2[^/]*\.(otf|ttf|woff2?)$/i, "Stratum2 font (theme pack only)"],
  [/\.vtex(_c)?$/i, "Source 2 texture"],
  [/radial_[^/]*\.wav$/i, "CS2 shop sound (theme pack only)"],
  [/^public\/panorama\//, "Panorama asset tree"],
];
for (const file of files) {
  for (const [pattern, reason] of FILE_RULES) {
    if (pattern.test(file)) problems.push({ reason, where: file });
  }
}

// Placeholder SteamIDs are 76561198000000000-76561198000000999.
const CONTENT_RULES = [
  ["[A-Za-z]:[\\\\/]+(Users|dev|Tools|Projects)[\\\\/]", "machine-specific absolute path", () => true],
  ["7656119[0-9]{10}", "real SteamID", (match) => !/^76561198000000\d{3}$/.test(match)],
];
for (const [pattern, reason, isProblem] of CONTENT_RULES) {
  let output = "";
  try {
    output = git("grep", "-nIoE", pattern, "--", ".", `:!${SELF}`);
  } catch (error) {
    if (error.status !== 1) throw error; // 1 = no matches
  }
  for (const line of output.split("\n").filter(Boolean)) {
    const [file, lineNumber, ...rest] = line.split(":");
    const match = rest.join(":");
    if (isProblem(match)) problems.push({ reason, where: `${file}:${lineNumber} (${match})` });
  }
}

if (problems.length > 0) {
  console.error(`public content check failed (${problems.length}):`);
  for (const reason of new Set(problems.map((problem) => problem.reason))) {
    const hits = problems.filter((problem) => problem.reason === reason);
    console.error(`- ${reason} (${hits.length}):`);
    for (const hit of hits.slice(0, 20)) console.error(`    ${hit.where}`);
    if (hits.length > 20) console.error(`    ... and ${hits.length - 20} more`);
  }
  process.exit(1);
}
console.log(`public content check passed (${files.length} tracked files)`);
