import test from "node:test";
import assert from "node:assert/strict";
import { executeHistoricalJupiterRetirementCli } from "../../src/swap/jupiter-solana/historical-retirement-cli.js";
import { historicalRetirementDiagnostic, executeJupiterHistoricalRetirement as realExecute } from "../../src/swap/jupiter-solana/historical-retirement-owner.js";
import { HISTORICAL_JUPITER_IDS } from "../../src/swap/jupiter-solana/historical-pins.js";

// Output doubles only: no private authentication, canonical proof or retirement write.
test("retirement CLI exposes only unknown-outcome conservative accounting whitelist", async t => {
  const id = HISTORICAL_JUPITER_IDS[1]!, calls: string[] = [];
  const publicResult = {status: "retired_unknown", operationId: id, profile: "solana-local",
    accountingAt: "2026-10-10T00:00:00.000Z", conservativeNativeAmount: "6000000",
    additionalAdmissionNativeAmount: "5000000", effectAt: null, actualNativeFee: null,
    transactionOutcome: "unknown", transactionMayHaveBeenSubmitted: true,
    retirementRecordHash: "a".repeat(64), idempotentRecovered: true};
  const owner = t.mock.module("../../src/swap/jupiter-solana/historical-retirement-owner.js", {namedExports: {
    executeJupiterHistoricalRetirement: async (operationId: string, root: string) => {
      assert.equal(operationId, id); assert.equal(root, "/TEST_ONLY/root"); calls.push("owner");
      return {...publicResult, rawPayload: "NOT_PUBLIC", token: {secret: "NOT_PUBLIC"}, actualOutcome: "paid"};
    },
  }}); t.after(() => owner.restore());
  const result = await executeHistoricalJupiterRetirementCli(["swap", "solana", "jupiter", "historical-retire", "--operation", id], () => "/TEST_ONLY/root");
  assert.equal(result.ok, true); assert.deepEqual(calls, ["owner"]);
  assert.deepEqual((result.data as {retirement: unknown}).retirement, publicResult);
  assert.equal(JSON.stringify(result).includes("NOT_PUBLIC"), false);
  assert.equal(result.operation, null); assert.equal(result.receipt, null); assert.deepEqual(result.next_actions, []);
});

test("retirement CLI preserves sanitized failure without material or retry projection", async t => {
  const owner = t.mock.module("../../src/swap/jupiter-solana/historical-retirement-owner.js", {namedExports: {
    executeJupiterHistoricalRetirement: async () => {throw Error("NOT_PUBLIC:private-stage");},
  }}); t.after(() => owner.restore());
  const result = await executeHistoricalJupiterRetirementCli(["swap", "solana", "jupiter", "historical-retire", "--operation", HISTORICAL_JUPITER_IDS[0]!], () => "/TEST_ONLY/root");
  assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(result.data, null); assert.equal(JSON.stringify(result).includes("NOT_PUBLIC"), false);
  assert.equal(result.operation, null); assert.equal(result.receipt, null); assert.deepEqual(result.next_actions, []);
});

test("retirement CLI ignores fabricated diagnostics and raw exception secrets", async t => {
  const fake = Object.assign(Error("PRIVATE_KEY https://secret/key"), {code:"PRIVATE_CODE",stage:"canonical_proof",reason:"archive_data_missing",details:{stage:"publication",reason:"PRIVATE_CIPHER"}});
  const owner = t.mock.module("../../src/swap/jupiter-solana/historical-retirement-owner.js", {namedExports: {
    executeJupiterHistoricalRetirement: async () => { throw fake; }, historicalRetirementDiagnostic,
  }}); t.after(() => owner.restore());
  const result = await executeHistoricalJupiterRetirementCli(["swap","solana","jupiter","historical-retire","--operation",HISTORICAL_JUPITER_IDS[0]!], () => "/TEST_ONLY/root");
  assert.deepEqual(result.error, {code:"APN_OPERATION_BLOCKED",message:"Historical Jupiter conservative retirement is unavailable."});
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.equal(historicalRetirementDiagnostic(fake), undefined);
});
test("retirement CLI exposes a genuine owned frame refusal as constants only", async t => {
  const owner = t.mock.module("../../src/swap/jupiter-solana/historical-retirement-owner.js", {namedExports: {
    executeJupiterHistoricalRetirement: realExecute, historicalRetirementDiagnostic,
  }}); t.after(() => owner.restore());
  const result = await executeHistoricalJupiterRetirementCli(["swap","solana","jupiter","historical-retire","--operation",HISTORICAL_JUPITER_IDS[0]!], () => "/TEST_ONLY/absent/private-root");
  assert.deepEqual(result.error, {code:"APN_OPERATION_BLOCKED",message:"Historical Jupiter conservative retirement is unavailable.",details:{stage:"frame",reason:"stage_refused"}});
  assert.equal(JSON.stringify(result).includes("private-root"), false);
  assert.equal(result.data, null); assert.equal(result.receipt, null); assert.deepEqual(result.next_actions, []);
});
