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
export const EXCEPTIONS = Object.freeze([Object.freeze({ advisory: 1243066, ghsa: "GHSA-mrhx-c7xc-m3w5", package: "zod", major: "3",
  under: Object.freeze(["node_modules/awal/", "node_modules/@x402/"]), expires: "2026-11-23T00:00:00.000Z" })]);

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
      return entry.nodes.every(node => exception.under.some(prefix => node.startsWith(prefix)) &&
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = resolve(import.meta.dirname, "..");
  const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error !== undefined) throw run.error;
  const result = classifyAudit(JSON.parse(run.stdout), JSON.parse(readFileSync(join(root, "npm-shrinkwrap.json"), "utf8")).packages, Date.now(), EXCEPTIONS);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failures.length > 0) process.exitCode = 1;
}
