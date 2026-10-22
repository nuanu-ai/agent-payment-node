import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// `npm audit --omit=dev` reads the lockfile's production closure. Vendored bundles carry code from
// packages the lockfile files under dev, so this gate asks the same advisory service about the exact
// package versions each bundle's provenance says it emitted. Severities mirror `--audit-level=low`.
const root = resolve(import.meta.dirname, "..");
const BULK_ADVISORY_URL = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const FAILING = new Set(["low", "moderate", "high", "critical"]);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Every regular file under a shipped vendor root; a symlink or other entry refuses. */
async function files(directory) {
  const found = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) found.push(...await files(path));
    else if (item.isFile()) found.push(path);
    else throw new Error(`vendor entry is not a regular file: ${path}`);
  }
  return found;
}

const shipped = JSON.parse(await readFile(join(root, "package.json"), "utf8")).files
  .map(pattern => /^vendor\/([^/]+)\/\*\*$/u.exec(pattern)?.[1]).filter(name => name !== undefined);
const versions = new Map(), bundles = [];
for (const name of shipped) {
  const directory = join(root, "vendor", name);
  if (!(await lstat(directory)).isDirectory()) throw new Error(`vendor ${name} is not a directory`);
  const contents = await files(directory), provenance = join(directory, "provenance.json");
  if (!contents.includes(provenance)) {
    // A root without provenance may ship data and notes only.
    const code = contents.filter(path => !/\.(?:json|md)$/u.test(path));
    if (code.length > 0) throw new Error(`vendor ${name} ships ${code.length} non-data files without provenance`);
    continue;
  }
  const emitted = JSON.parse(await readFile(provenance, "utf8")).emittedPackages;
  if (!isRecord(emitted) || Object.keys(emitted).length === 0) throw new Error(`vendor ${name} provenance lists no emitted packages`);
  for (const row of Object.values(emitted)) {
    if (typeof row?.name !== "string" || typeof row.version !== "string") throw new Error(`vendor ${name} emitted package row is malformed`);
    versions.set(row.name, new Set([...(versions.get(row.name) ?? []), row.version]));
  }
  bundles.push(name);
}
if (bundles.length === 0) throw new Error("no vendor bundle with provenance was audited");
const body = Object.fromEntries([...versions].sort(([a], [b]) => a.localeCompare(b, "en")).map(([name, set]) => [name, [...set].sort()]));
const response = await fetch(BULK_ADVISORY_URL, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
if (response.status !== 200) throw new Error(`advisory service answered ${response.status}`);
const advisories = await response.json();
if (!isRecord(advisories) || !Object.values(advisories).every(Array.isArray)) throw new Error("advisory service answer has an unexpected shape");
const findings = Object.entries(advisories).flatMap(([name, rows]) => rows.map(row => {
  if (!FAILING.has(row.severity) && row.severity !== "info") throw new Error(`unknown advisory severity ${row.severity} for ${name}`);
  return { name, emitted: body[name], severity: row.severity, vulnerableVersions: row.vulnerable_versions, url: row.url };
})).filter(row => FAILING.has(row.severity));
process.stdout.write(`${JSON.stringify({ bundles, emittedPackages: Object.values(body).flat().length, findings }, null, 2)}\n`);
if (findings.length > 0) process.exitCode = 1;
