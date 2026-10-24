import assert from "node:assert/strict";
import test from "node:test";
import { classifyAudit, EXCEPTIONS } from "../../scripts/audit-production.mjs";

// The release audit's one owner-approved exception (GHSA-mrhx-c7xc-m3w5, approved 2026-10-24) must stay this narrow.
const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const ZOD = { source: 1243066, name: "zod", url: "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5", severity: "high", range: "<4.6.6" };
const lock = { "node_modules/awal/node_modules/zod": { version: "3.25.76" }, "node_modules/@x402/core/node_modules/zod": { version: "3.25.76" },
  "node_modules/zod": { version: "4.4.3" }, "node_modules/@x402/evm/node_modules/zod": { version: "4.5.0" } };
const report = (nodes, extra = {}) => ({ vulnerabilities: { zod: { name: "zod", severity: "high", via: [ZOD], nodes },
  awal: { name: "awal", severity: "high", via: ["zod"], nodes: ["node_modules/awal"] }, ...extra } });

test("only zod 3.x under awal and @x402 is excepted, with the packages flagged through it", () => {
  const result = classifyAudit(report(["node_modules/awal/node_modules/zod", "node_modules/@x402/core/node_modules/zod"]), lock, NOW, EXCEPTIONS);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.excepted.map(item => item.package), ["zod", "awal"]);
  assert.deepEqual(classifyAudit({ vulnerabilities: {} }, lock, NOW, EXCEPTIONS), { findings: 0, excepted: [], failures: [] });
});

test("APN's own zod, a zod 4 copy, another advisory, an expired exception and an unknown severity all still fail", () => {
  for (const nodes of [["node_modules/zod"], ["node_modules/@x402/evm/node_modules/zod"], ["node_modules/awal/node_modules/zod", "node_modules/zod"]]) {
    assert.deepEqual(classifyAudit(report(nodes), lock, NOW, EXCEPTIONS).failures.map(failure => failure.split(":")[0]), ["zod", "awal"], nodes.join());
  }
  const other = report(["node_modules/awal/node_modules/zod"], { "fast-uri": { name: "fast-uri", severity: "low", via: [{ source: 1243101 }], nodes: ["node_modules/fast-uri"] } });
  assert.deepEqual(classifyAudit(other, lock, NOW, EXCEPTIONS).failures.map(failure => failure.split(":")[0]), ["fast-uri"]);
  const expired = classifyAudit(report(["node_modules/awal/node_modules/zod"]), lock, Date.parse(EXCEPTIONS[0].expires), EXCEPTIONS);
  assert.ok(expired.failures.some(failure => failure.includes("expired")), JSON.stringify(expired));
  assert.equal(expired.failures.some(failure => failure.startsWith("awal:")), true);
  assert.throws(() => classifyAudit({ vulnerabilities: { x: { severity: "severe", via: ["y"], nodes: [] } } }, lock, NOW, EXCEPTIONS), /unknown npm audit severity/);
  assert.deepEqual(classifyAudit({ vulnerabilities: { x: { severity: "info", via: [{ source: 1 }], nodes: [] } } }, lock, NOW, EXCEPTIONS).failures, []);
});

test("the exception names its advisory, package, major, paths and a 30-day expiry", () => {
  assert.deepEqual(EXCEPTIONS, [{ advisory: 1243066, ghsa: "GHSA-mrhx-c7xc-m3w5", package: "zod", major: "3",
    under: ["node_modules/awal/", "node_modules/@x402/"], expires: "2026-11-23T00:00:00.000Z" }]);
  assert.ok(Object.isFrozen(EXCEPTIONS) && Object.isFrozen(EXCEPTIONS[0]) && Object.isFrozen(EXCEPTIONS[0].under));
});
