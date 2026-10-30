import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The production closure's `npm audit --omit=dev`, failing at low like `--audit-level=low`, with dated exceptions the
// owner approved for advisories that have no fix a dependency APN cannot change would accept.
const FAILING = new Set(["low", "moderate", "high", "critical"]);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Owner-approved 2026-10-24 (APN 0.5.72): GHSA-mrhx-c7xc-m3w5 (npm advisory 1243066) affects zod <4.6.6. APN's own zod
 * is 4.6.7; awal 2.12.x and @x402/* 2.x require zod ^3, which has no fixed release, and zod 4 breaks their APIs
 * (single-argument z.record, errorMap). Only zod 3.x installed under those packages is excepted, until the expiry.
 */
/**
 * Maintainer-approved 2026-10-29 (APN 0.5.78), under the rule of the zod exception: GHSA-gcqx-w48m-w2h4 (npm advisory 1243505) covers every deepmerge from 4.2.0 to 4.3.1, the latest
 * release; upstream closed the report with no fix (TehShrike/deepmerge#273). Only the Torus HTTP and login helpers under
 * @metamask/agent-wallet require it in production. They merge request options and login parameters their own code
 * builds and never a response body. The `mm` CLI bundles its own copy, so no override of the installed package could
 * change what runs.
 */
export const EXCEPTIONS = Object.freeze([Object.freeze({ advisory: 1243066, ghsa: "GHSA-mrhx-c7xc-m3w5", package: "zod", major: "3",
  under: Object.freeze(["node_modules/awal/", "node_modules/@x402/"]), expires: "2026-11-23T00:00:00.000Z" }),
Object.freeze({ advisory: 1243505, ghsa: "GHSA-gcqx-w48m-w2h4", package: "deepmerge", major: "4",
  requiredBy: Object.freeze(["@toruslabs/customauth", "@toruslabs/http-helpers"]), expires: "2026-11-28T00:00:00.000Z" })]);

/**
 * The same advisory in the vendored MetaMask EVM SDK (audit-vendor-emitted.mjs): its bundle carries deepmerge 4.3.1 from
 * @toruslabs/http-helpers, called only by that helper's `get`, whose two callers (the gas-estimate fetches) pass literal
 * request options.
 */
export const VENDOR_EXCEPTIONS = Object.freeze([Object.freeze({ advisory: 1243505, ghsa: "GHSA-gcqx-w48m-w2h4", package: "deepmerge",
  versions: Object.freeze(["4.3.1"]), bundles: Object.freeze(["metamask-evm-sdk"]), expires: "2026-11-28T00:00:00.000Z" })]);

const packageName = path => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
/** A lockfile row installed under its own name (an npm alias row names the real package). */
const ownName = (lock, path) => isRecord(lock[path]) && (lock[path].name === undefined || lock[path].name === packageName(path));
/** Whether a lockfile row depends on `name`, by its own key or through an npm alias (`"x": "npm:name@…"`). */
const requires = (row, name) => ["dependencies", "optionalDependencies", "peerDependencies"].some(field => isRecord(row[field]) &&
  Object.entries(row[field]).some(([key, spec]) => key === name || spec === `npm:${name}` || typeof spec === "string" && spec.startsWith(`npm:${name}@`)));
/** Every production lockfile package that requires `name` is one of `allowed` under its own name; APN's manifest never does. */
function requiredOnlyBy(lock, name, allowed) {
  return Object.entries(lock).every(([path, row]) => !isRecord(row) || row.dev === true || !requires(row, name) ||
    path !== "" && allowed.includes(packageName(path)) && ownName(lock, path));
}

/** Which findings an approved exception covers and which still fail; `lock` is the lockfile's `packages` map. */
export function classifyAudit(report, lock, nowMs, exceptions) {
  if (!isRecord(report) || !isRecord(report.vulnerabilities) || !isRecord(lock)) throw new Error("npm audit report or lockfile is malformed");
  const failures = [], excepted = [], accepted = new Set(), entries = Object.entries(report.vulnerabilities);
  for (const [name, entry] of entries) {
    const advisories = entry.via.filter(isRecord);
    if (advisories.length === 0) continue;
    const covered = advisories.every(advisory => {
      const exception = exceptions.find(item => item.advisory === advisory.source && item.package === name);
      if (exception === undefined) return false;
      if (nowMs >= Date.parse(exception.expires)) { failures.push(`${name}: exception for ${exception.ghsa} expired at ${exception.expires}`); return false; }
      if ((exception.under === undefined) === (exception.requiredBy === undefined)) throw new Error(`audit exception for ${exception.ghsa} needs exactly one scope`);
      if (exception.requiredBy !== undefined && !requiredOnlyBy(lock, name, exception.requiredBy)) return false;
      return Array.isArray(entry.nodes) && entry.nodes.length > 0 && entry.nodes.every(node => packageName(node) === name && ownName(lock, node) &&
        (exception.under === undefined || exception.under.some(prefix => node.startsWith(prefix))) &&
        typeof lock[node]?.version === "string" && lock[node].version.startsWith(`${exception.major}.`));
    });
    if (covered && entry.via.every(isRecord)) { accepted.add(name); excepted.push({ package: name, advisories: advisories.map(advisory => advisory.source), nodes: entry.nodes }); }
  }
  // A package flagged only through excepted packages is covered too.
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, entry] of entries) {
      if (accepted.has(name) || entry.via.some(isRecord) || !entry.via.every(via => accepted.has(via))) continue;
      accepted.add(name); excepted.push({ package: name, through: entry.via }); grew = true;
    }
  }
  for (const [name, entry] of entries) {
    if (entry.severity === "info") continue;
    if (!FAILING.has(entry.severity)) throw new Error(`unknown npm audit severity for ${name}: ${entry.severity}`);
    if (!accepted.has(name)) failures.push(`${name}: ${entry.severity} via ${entry.via.map(via => isRecord(via) ? via.url ?? via.source : via).join(", ")}`);
  }
  return { findings: entries.length, excepted, failures };
}

/** Whether an approved vendor exception covers one advisory row of `name`, emitted at `versions` by `bundles`. */
export function vendorExcepted(name, row, versions, bundles, nowMs, exceptions) {
  return exceptions.some(exception => exception.package === name && exception.advisory === row.id && nowMs < Date.parse(exception.expires) &&
    versions.length > 0 && bundles.length > 0 &&
    versions.every(version => exception.versions.includes(version)) && bundles.every(bundle => exception.bundles.includes(bundle)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = resolve(import.meta.dirname, "..");
  const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error !== undefined) throw run.error;
  const result = classifyAudit(JSON.parse(run.stdout), JSON.parse(readFileSync(join(root, "npm-shrinkwrap.json"), "utf8")).packages, Date.now(), EXCEPTIONS);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failures.length > 0) process.exitCode = 1;
}
