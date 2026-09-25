import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalJson, domainHash } from "../../src/canonical.js";

const SCHEMA = "apn.jupiter-solana-abi-blocker.v1";
const EXPECTED_DIGEST = "e2948c8a30829be4b7f73d870b80f0b19bae110b7a6c0b40f95385a05cc3334b";
const PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

test("the pinned Jupiter ABI review remains fail closed and digest bound", () => {
  const record = JSON.parse(readFileSync(new URL("../../../data/swap/jupiter-solana-abi-blocker-2026-09-17.json", import.meta.url), "utf8")) as Record<string, unknown>;
  assert.equal(record.schemaVersion, SCHEMA);
  assert.equal(record.programId, PROGRAM);
  assert.deepEqual(Object.keys(record).sort(), ["blockers", "decision", "evidenceDigest", "officialSources", "pair", "programId", "reviewedAt", "schemaVersion", "verifiedInterface"].sort());
  const decision = record.decision as Record<string, unknown>;
  assert.deepEqual(decision, {
    signable: false,
    reason: "route_v2 is syntactically decodable from the current JUP6 on-chain IDL, but RoutePlanStepV2 does not bind the quoted ammKey, the IDL does not define Quantum route-dependent remaining-account positions, and no deployed executable source/build attestation links the binary to this IDL. Keep JUP6 signing fail closed.",
  });
  const verifiedInterface = record.verifiedInterface as Record<string, unknown>;
  const routeV2 = (verifiedInterface.exactInInstructions as Array<Record<string, unknown>>)[0];
  assert.ok(routeV2);
  assert.equal(routeV2.name, "route_v2");
  assert.equal(routeV2.discriminatorHex, "bb64facc31c4af14");
  assert.equal((routeV2.fixedAccounts as string[]).length, 10);
  const blockers = record.blockers as Array<Record<string, unknown>>;
  assert.deepEqual(blockers.map((item) => item.code), [
    "ROUTE_PLAN_DOES_NOT_BIND_QUOTED_AMM_KEY",
    "REMAINING_ACCOUNT_ABI_IS_ROUTE_DEPENDENT",
    "NO_PINNED_ONCHAIN_ARTIFACT_PROVENANCE",
  ]);
  assert.equal(blockers.some((item) => item.code === "REMAINING_ACCOUNT_ABI_IS_ROUTE_DEPENDENT"), true);
  assert.equal(blockers.some((item) => item.code === "NO_PINNED_ONCHAIN_ARTIFACT_PROVENANCE"), true);
  const { evidenceDigest, ...body } = record;
  assert.equal(evidenceDigest, EXPECTED_DIGEST);
  assert.equal(evidenceDigest, domainHash(SCHEMA, canonicalJson(body)));
});
