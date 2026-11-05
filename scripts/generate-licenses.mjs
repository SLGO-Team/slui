// Writes THIRD_PARTY_LICENSES.txt: the license texts of every third-party dependency compiled into what the
// installer ships. The installer bundles the file next to slui.exe (src-tauri/tauri.conf.json bundle.resources).
//
//   npm run licenses          regenerate (run after changing Cargo.lock or the npm runtime dependencies)
//   npm run licenses -- --check   fail when the committed file is out of date
//
// Rust: cargo-about 0.9.3, the version CI pins (`cargo install cargo-about --version 0.9.3 --locked --features cli`) over the workspace's Windows-target
// normal dependencies, configured in scripts/licenses/about.toml. npm: `npm ls --omit=dev` (the packages Vite
// bundles into dist). Both fail on a license outside the accepted list, which is shared from about.toml.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "THIRD_PARTY_LICENSES.txt");
const aboutConfig = join(root, "scripts/licenses/about.toml");
const check = process.argv.includes("--check");

const accepted = new Set(
  [...readFileSync(aboutConfig, "utf8").matchAll(/^\s*"([^"]+)",\s*$/gm)].map((match) => match[1]),
);
if (accepted.size === 0) throw new Error("No accepted licenses found in scripts/licenses/about.toml");

/** Whether an SPDX expression (AND / OR / WITH, parentheses) can be satisfied with accepted licenses only. */
export function satisfies(expression) {
  const tokens = expression.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/);
  let index = 0;
  const primary = () => {
    if (tokens[index] === "(") {
      index++;
      const value = or();
      if (tokens[index++] !== ")") throw new Error(`Unbalanced license expression: ${expression}`);
      return value;
    }
    let id = tokens[index++];
    if (tokens[index] === "WITH") id = `${id} WITH ${tokens[(index += 2) - 1]}`;
    return accepted.has(id) || accepted.has(id.replace(/\+$/, ""));
  };
  const and = () => {
    let value = primary();
    while (tokens[index] === "AND") { index++; value = primary() && value; }
    return value;
  };
  const or = () => {
    let value = and();
    while (tokens[index] === "OR") { index++; value = and() || value; }
    return value;
  };
  const value = or();
  if (index !== tokens.length) throw new Error(`Unparsed license expression: ${expression}`);
  return value;
}

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\.|-|$)/i;

function npmSection() {
  // Through npm's own CLI script when run as an npm script (no shell); a bare `npm` needs the shell on Windows.
  const args = ["ls", "--omit=dev", "--all", "--json", "--long"];
  const options = { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
  const tree = JSON.parse(process.env.npm_execpath
    ? execFileSync(process.execPath, [process.env.npm_execpath, ...args], options)
    : execFileSync("npm", args, { ...options, shell: process.platform === "win32" }));
  const packages = new Map();
  const walk = (node) => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      // First-party workspace packages (packages/*) are part of this repository.
      if (name.startsWith("@slgo/")) continue;
      // By name: Dependabot bumps these monthly, and a version bump that keeps the license must not stale the file.
      const key = name;
      if (!packages.has(key)) {
        // license and repository from the package's own package.json: `npm ls --long` leaves them out of some
        // entries (deduped ones), which made the output differ between runs.
        const manifest = JSON.parse(readFileSync(join(child.path, "package.json"), "utf8"));
        const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
        packages.set(key, { name, version: manifest.version, license: manifest.license, path: child.path, repository });
      }
      walk(child);
    }
  };
  walk(tree);
  const failures = [];
  const entries = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
    if (typeof entry.license !== "string" || !satisfies(entry.license)) failures.push(`${entry.name}@${entry.version}: ${entry.license ?? "no license"}`);
    const files = existsSync(entry.path) ? readdirSync(entry.path).filter((file) => LICENSE_FILE.test(file)).sort() : [];
    if (files.length === 0) failures.push(`${entry.name}@${entry.version}: no license file in ${entry.path}`);
    const texts = files.map((file) => readFileSync(join(entry.path, file), "utf8").replace(/\r\n/g, "\n").trim());
    return [
      "-".repeat(100),
      `${entry.name} (${entry.license})${entry.repository ? `\n${String(entry.repository).replace(/^git\+/, "")}` : ""}`,
      "",
      texts.join("\n\n"),
      "",
    ].join("\n");
  });
  if (failures.length > 0) throw new Error(`npm dependencies with unaccepted or missing licenses:\n  ${failures.join("\n  ")}`);
  return entries.join("\n");
}

function cargoSection() {
  try {
    return execFileSync("cargo", [
      "about", "generate", "--fail", "--workspace", "--frozen",
      "--manifest-path", join(root, "src-tauri/Cargo.toml"),
      "-c", aboutConfig,
      join(root, "scripts/licenses/about.hbs"),
    ], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] }).replace(/\r\n/g, "\n").trim();
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("cargo is not on PATH");
    throw new Error(`cargo about generate failed (install it with: cargo install cargo-about --version 0.9.3 --locked --features cli): ${error.message}`);
  }
}

const text = [
  "Third-party licenses",
  "",
  "SLUI (GPL-3.0-or-later, https://github.com/SLGO-Team/slui) includes the third-party software below. Each",
  "component remains under its own license, reproduced here. Generated by scripts/generate-licenses.mjs from",
  "Cargo.lock (cargo-about) and package-lock.json (npm ls); bundled artwork and fonts are listed in",
  "THIRD_PARTY_NOTICES.md.",
  "",
  "=".repeat(100),
  "JavaScript packages bundled into the user interface",
  "=".repeat(100),
  "",
  npmSection(),
  "=".repeat(100),
  "Rust crates compiled into slui.exe, slui-setup.exe and slui-uninstall.exe",
  "=".repeat(100),
  cargoSection(),
  "",
].join("\n");

if (check) {
  const current = existsSync(output) ? readFileSync(output, "utf8") : "";
  if (current !== text) {
    console.error("THIRD_PARTY_LICENSES.txt is out of date: run `npm run licenses` and commit the result.");
    process.exit(1);
  }
  console.log("THIRD_PARTY_LICENSES.txt is up to date");
} else {
  writeFileSync(output, text);
  console.log(`wrote ${output} (${text.length} bytes)`);
}
