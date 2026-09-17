import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalJson, domainHash } from "../../src/canonical.js";

const SCHEMA = "apn.jupiter-solana-abi-blocker.v1";
const EXPECTED_DIGEST = "41f74b2c2588a44c153b85eba13b519af5f5dbfadd96d03f7f6214e8684c88cd";
const PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

test("the pinned Jupiter ABI review remains fail closed and digest bound", () => {
  const record = JSON.parse(readFileSync(new URL("../../../data/swap/jupiter-solana-abi-blocker-2026-09-17.json", import.meta.url), "utf8")) as Record<string, unknown>;
  assert.equal(record.schemaVersion, SCHEMA);
  assert.equal(record.programId, PROGRAM);
  assert.deepEqual(Object.keys(record).sort(), ["blockers", "decision", "evidenceDigest", "officialSources", "pair", "programId", "reviewedAt", "schemaVersion", "verifiedInterface"].sort());
  const decision = record.decision as Record<string, unknown>;
  assert.deepEqual(decision, {
    signable: false,
    reason: "A finite decoder cannot bind every route-dependent account and quoted AMM identity from the reviewed official artifacts without guessing. Keep JUP6 signing fail closed.",
  });
  const blockers = record.blockers as Array<Record<string, unknown>>;
  assert.deepEqual(blockers.map((item) => item.code), [
    "NO_OFFICIAL_EXACT_BUILD_FIXTURE",
    "ROUTE_PLAN_DOES_NOT_BIND_QUOTED_AMM_KEY",
    "REMAINING_ACCOUNT_ABI_IS_ROUTE_DEPENDENT",
    "NO_PINNED_ONCHAIN_ARTIFACT_PROVENANCE",
    "LOCAL_BUILD_CODEC_IS_NOT_V2_BUILD_SHAPE",
  ]);
  const { evidenceDigest, ...body } = record;
  assert.equal(evidenceDigest, EXPECTED_DIGEST);
  assert.equal(evidenceDigest, domainHash(SCHEMA, canonicalJson(body)));
});
