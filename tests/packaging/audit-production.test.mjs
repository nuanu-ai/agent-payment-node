import assert from "node:assert/strict";
import test from "node:test";
import { classifyAudit, EXCEPTIONS, VENDOR_EXCEPTIONS, vendorExcepted } from "../../scripts/audit-production.mjs";

// The release audit's exceptions (GHSA-mrhx-c7xc-m3w5, approved 2026-10-24; GHSA-gcqx-w48m-w2h4, accepted 2026-10-29)
// must stay this narrow.
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

test("each exception names its advisory, package, major, scope and a 30-day expiry", () => {
  assert.deepEqual(EXCEPTIONS, [{ advisory: 1243066, ghsa: "GHSA-mrhx-c7xc-m3w5", package: "zod", major: "3",
    under: ["node_modules/awal/", "node_modules/@x402/"], expires: "2026-11-23T00:00:00.000Z" },
  { advisory: 1243505, ghsa: "GHSA-gcqx-w48m-w2h4", package: "deepmerge", major: "4",
    requiredBy: ["@toruslabs/customauth", "@toruslabs/http-helpers"], expires: "2026-11-28T00:00:00.000Z" }]);
  assert.deepEqual(VENDOR_EXCEPTIONS, [{ advisory: 1243505, ghsa: "GHSA-gcqx-w48m-w2h4", package: "deepmerge", versions: ["4.3.1"],
    bundles: ["metamask-evm-sdk"], expires: "2026-11-28T00:00:00.000Z" }]);
  for (const list of [EXCEPTIONS, VENDOR_EXCEPTIONS]) {
    assert.ok(Object.isFrozen(list) && list.every(item => Object.isFrozen(item) && Object.values(item).every(value => typeof value !== "object" || Object.isFrozen(value))));
  }
});

// QA 0.5.77 RELEASE-AUDIT-DEEPMERGE-077-001: deepmerge has no fixed release; it is excepted only while the Torus helpers
// under @metamask/agent-wallet are the production packages that require it.
const DEEPMERGE = { source: 1243505, name: "deepmerge", url: "https://github.com/advisories/GHSA-gcqx-w48m-w2h4", severity: "low", range: ">=4.2.0 <=4.3.1" };
const merged = { "": { dependencies: { "@metamask/agent-wallet": "6.1.5" } }, "node_modules/deepmerge": { version: "4.3.1" },
  "node_modules/@toruslabs/http-helpers": { version: "9.0.0", dependencies: { deepmerge: "^4.3.1" } },
  "node_modules/@toruslabs/customauth": { version: "22.3.3", dependencies: { deepmerge: "^4.3.1" } },
  "node_modules/@metamask/accounts-controller": { version: "1.0.0", dev: true, dependencies: { deepmerge: "^4.2.2" } } };
const deepmergeReport = { vulnerabilities: { deepmerge: { name: "deepmerge", severity: "low", via: [DEEPMERGE], nodes: ["node_modules/deepmerge"] },
  "@toruslabs/http-helpers": { name: "@toruslabs/http-helpers", severity: "low", via: ["deepmerge"], nodes: ["node_modules/@toruslabs/http-helpers"] } } };

test("deepmerge 4 required only by the Torus helpers is excepted, with what is flagged through it; any other requirer fails", () => {
  const ok = classifyAudit(deepmergeReport, merged, NOW, EXCEPTIONS);
  assert.deepEqual([ok.failures, ok.excepted.map(item => item.package)], [[], ["deepmerge", "@toruslabs/http-helpers"]]);
  const failing = lock => classifyAudit(deepmergeReport, lock, NOW, EXCEPTIONS).failures.map(failure => failure.split(":")[0]);
  for (const [label, lock] of [
    ["APN's own manifest", { ...merged, "": { dependencies: { deepmerge: "4.3.1" } } }],
    ["another production package", { ...merged, "node_modules/other": { version: "1.0.0", dependencies: { deepmerge: "^4.0.0" } } }],
    ["an optional dependency", { ...merged, "node_modules/other": { version: "1.0.0", optionalDependencies: { deepmerge: "^4.0.0" } } }],
    ["another major", { ...merged, "node_modules/deepmerge": { version: "5.0.0" } }],
    ["a requirer through an npm alias", { ...merged, "node_modules/other": { version: "1.0.0", dependencies: { dm: "npm:deepmerge@4.3.1" } } }],
    ["another package installed under a Torus name", { ...merged, "node_modules/@toruslabs/customauth": { name: "evil", version: "1.0.0",
      dependencies: { deepmerge: "^4.3.1" } } }],
    ["deepmerge installed under another name", { ...merged, "node_modules/deepmerge": { name: "evil", version: "4.3.1" } }]]) {
    assert.deepEqual(failing(lock), ["deepmerge", "@toruslabs/http-helpers"], label);
  }
  // The aliased copy itself is flagged under its install name: it is not deepmerge's own node.
  const aliased = { vulnerabilities: { dm: { name: "dm", severity: "low", via: [{ ...DEEPMERGE, name: "dm" }], nodes: ["node_modules/dm"] } } };
  assert.deepEqual(classifyAudit(aliased, { ...merged, "node_modules/dm": { name: "deepmerge", version: "4.3.1" } }, NOW, EXCEPTIONS).failures.map(failure => failure.split(":")[0]), ["dm"]);
  const empty = { vulnerabilities: { deepmerge: { ...deepmergeReport.vulnerabilities.deepmerge, nodes: [] } } };
  assert.deepEqual(classifyAudit(empty, merged, NOW, EXCEPTIONS).failures.map(failure => failure.split(":")[0]), ["deepmerge"], "a row with no nodes");
  const unscoped = [{ ...EXCEPTIONS[1], requiredBy: undefined }];
  assert.throws(() => classifyAudit(deepmergeReport, merged, NOW, unscoped), /exactly one scope/);
  const expired = classifyAudit(deepmergeReport, merged, Date.parse(EXCEPTIONS[1].expires), EXCEPTIONS);
  assert.ok(expired.failures.some(failure => failure.includes("expired")), JSON.stringify(expired));
});

test("the vendored deepmerge is excepted only at 4.3.1, for its advisory, in the MetaMask EVM SDK bundle, until the expiry", () => {
  const row = { id: 1243505 }, covered = (name, advisory, versions, bundles, now = NOW) => vendorExcepted(name, advisory, versions, bundles, now, VENDOR_EXCEPTIONS);
  assert.equal(covered("deepmerge", row, ["4.3.1"], ["metamask-evm-sdk"]), true);
  assert.equal(covered("deepmerge", row, ["4.3.1", "4.2.2"], ["metamask-evm-sdk"]), false);
  assert.equal(covered("deepmerge", row, ["4.3.1"], ["metamask-evm-sdk", "tron-utils"]), false);
  assert.equal(covered("deepmerge", { id: 1 }, ["4.3.1"], ["metamask-evm-sdk"]), false);
  assert.equal(covered("zod", row, ["4.3.1"], ["metamask-evm-sdk"]), false);
  assert.equal(covered("deepmerge", row, [], []), false, "an answer for a package no bundle emitted");
  assert.equal(covered("deepmerge", row, ["4.3.1"], ["metamask-evm-sdk"], Date.parse(VENDOR_EXCEPTIONS[0].expires)), false);
});
