// CI's npm audit gate (`npm run audit`). Shipped dependencies get no exceptions: `--omit=dev` must find nothing
// at high or above. Build tooling may carry an advisory that has no fix yet only if it is listed below with the
// reason it cannot reach users; the exception lapses on its own once npm offers a fix inside the declared
// ranges (`fixAvailable: true`) or after `until`, so the gate fails again and the entry is revisited.
// The registry is pinned because the local mirror has no audit endpoint.
import { spawnSync } from "node:child_process";

const REGISTRY = "https://registry.npmjs.org";
const BLOCKING = new Set(["high", "critical"]);

/** Dev-only advisories without a usable fix, by GHSA id. */
const DEV_EXCEPTIONS = {
  // picomatch <= 4.0.7 (the latest) ReDoS on crafted extglobs; no patched release. Reached only through vite,
  // which matches the project's own glob patterns at build time; nothing user-supplied, not in the bundle.
  // npm's only "fix" is a downgrade to vite 6.2.7.
  "GHSA-fc5q-39xc-vjpf": { packages: ["picomatch"], until: "2027-01-31" },
};

function audit(args) {
  const result = spawnSync(`npm audit --json --registry=${REGISTRY} ${args}`, { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  try {
    return JSON.parse(result.stdout);
  } catch {
    console.error(result.stdout, result.stderr);
    throw new Error(`npm audit ${args} did not return JSON (exit ${result.status})`);
  }
}

/** Every high or critical advisory: { id, url, title, pkg, fixAvailable } from the packages it is reported on. */
function advisories(report) {
  if (report.error) throw new Error(`npm audit failed: ${JSON.stringify(report.error)}`);
  const found = [];
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via) {
      if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
      found.push({ id: via.url.split("/").pop(), url: via.url, title: via.title, pkg: via.name, fixAvailable: vuln.fixAvailable });
    }
  }
  return found;
}

const today = new Date().toISOString().slice(0, 10);
const failures = [];
for (const advisory of advisories(audit("--omit=dev"))) failures.push(`${advisory.pkg}: ${advisory.title} (${advisory.url}) in a shipped dependency`);
for (const advisory of advisories(audit(""))) {
  const exception = DEV_EXCEPTIONS[advisory.id];
  const label = `${advisory.pkg}: ${advisory.title} (${advisory.url})`;
  if (!exception || !exception.packages.includes(advisory.pkg)) failures.push(label);
  else if (advisory.fixAvailable === true) failures.push(`${label}: a fix is available now (npm audit fix); drop the exception`);
  else if (today > exception.until) failures.push(`${label}: exception expired ${exception.until}; re-check the advisory`);
  else console.log(`allowed until ${exception.until}: ${label}`);
}

if (failures.length > 0) {
  console.error(`npm audit: ${failures.length} blocking advisor${failures.length === 1 ? "y" : "ies"}`);
  for (const failure of new Set(failures)) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("npm audit passed");
