import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// `npm audit --omit=dev` reads the lockfile's production closure. Vendored bundles carry code from
// packages the lockfile files under dev, so this gate asks the same advisory service about the exact
// package versions each bundle's provenance says it emitted. Severities mirror `--audit-level=low`.
const root = resolve(import.meta.dirname, "..");
const BULK_ADVISORY_URL = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const FAILING = new Set(["low", "moderate", "high", "critical"]);

async function hasCode(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isDirectory() && await hasCode(join(directory, item.name))) return true;
    if (item.isFile() && /\.(?:mjs|cjs|js)$/u.test(item.name)) return true;
  }
  return false;
}

const versions = new Map(), bundles = [];
for (const item of (await readdir(join(root, "vendor"), { withFileTypes: true })).filter(entry => entry.isDirectory())) {
  const directory = join(root, "vendor", item.name);
  if (!await hasCode(directory)) continue;
  const emitted = JSON.parse(await readFile(join(directory, "provenance.json"), "utf8")).emittedPackages;
  if (emitted === null || typeof emitted !== "object" || Object.keys(emitted).length === 0) throw new Error(`vendor ${item.name} provenance lists no emitted packages`);
  for (const row of Object.values(emitted)) {
    if (typeof row?.name !== "string" || typeof row.version !== "string") throw new Error(`vendor ${item.name} emitted package row is malformed`);
    versions.set(row.name, new Set([...(versions.get(row.name) ?? []), row.version]));
  }
  bundles.push(item.name);
}
const body = Object.fromEntries([...versions].sort(([a], [b]) => a.localeCompare(b, "en")).map(([name, set]) => [name, [...set].sort()]));
const response = await fetch(BULK_ADVISORY_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
if (response.status !== 200) throw new Error(`advisory service answered ${response.status}`);
const advisories = await response.json();
const findings = Object.entries(advisories).flatMap(([name, rows]) => rows.map(row => {
  if (!FAILING.has(row.severity) && row.severity !== "info") throw new Error(`unknown advisory severity ${row.severity} for ${name}`);
  return { name, emitted: body[name], severity: row.severity, vulnerableVersions: row.vulnerable_versions, url: row.url };
})).filter(row => FAILING.has(row.severity));
process.stdout.write(`${JSON.stringify({ bundles, emittedPackages: Object.values(body).flat().length, findings }, null, 2)}\n`);
if (findings.length > 0) process.exitCode = 1;
