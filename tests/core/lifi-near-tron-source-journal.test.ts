import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { canonicalJson, hashObject, sha256 } from "../../src/canonical.js";
import { bindNearTronSourcePreparationToJournal } from "../../src/lifi/near-tron-source-journal.js";
import { inspectNearBaseTronQuoteOffline } from "../../src/lifi/near-tron-offline.js";
import { freezeNonEvmBridgeOperation } from "../../src/lifi/non-evm-operation.js";
import type { NearTronSourcePreparation } from "../../src/lifi/near-tron-source-preparation.js";
import { NonEvmSourceJournalRepository } from "../../src/lifi/non-evm-source-journal.js";
import { temporaryState } from "./helpers.js";

const saved = JSON.parse(readFileSync(resolve("tests/core/lifi-fixtures/base-tron-near-synthetic-20260916.json"), "utf8"));
const profileHash = "a".repeat(64), operationId = "b".repeat(64);
const createdAt = "2026-09-16T00:00:00.000Z";
const sender = "0x1111111111111111111111111111111111111111";
const recipient = "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV";
const admission = { backendSigner: "0x2222222222222222222222222222222222222222",
  facetAddress: "0x3333333333333333333333333333333333333333", facetCodeHash: "d".repeat(64),
  claimedValidationHash: "9".repeat(64), note: "synthetic test only" };

function fixture() {
  const quote = structuredClone(saved);
  const inspection = inspectNearBaseTronQuoteOffline(quote, { sender, tronRecipient: recipient,
    sourceAmountAtomic: "100000000", maxFeeAtomic: "250000", minOutputAtomic: "97000000" });
  const quoteHash = sha256(canonicalJson(quote));
  const draft = freezeNonEvmBridgeOperation({ schemaVersion: "apn.non-evm-bridge-operation.v2",
    kind: "non_evm_bridge_intent", executionAdmitted: false, state: "unchecked_draft",
    sourceCallValidation: "unchecked", profileHash, operationId, requestHash: "c".repeat(64),
    createdAt, expiresAt: "2099-01-01T00:00:00.000Z",
    source: { chainId: 8453, token: inspection.sourceToken, owner: sender, amountAtomic: "100000000" },
    sourceCall: { chainId: 8453, from: sender, to: inspection.transactionTarget, valueAtomic: "0",
      data: quote.transactionRequest.data, dataSha256: inspection.calldataSha256 },
    maxSourceNativeDebitWei: "10000000000000000", maxProviderFeeAtomic: "250000",
    route: "base_usdc_to_tron_usdt_lifi_near_intents",
    destination: { chainId: 728126428, token: inspection.quotedDestinationToken, recipient,
      minimumReceivedAtomic: "97000000" },
    provider: { kind: "lifi_near_intents", quoteHash, routeId: quote.id, stepId: quote.includedSteps[1].id,
      transactionId: quote.transactionId, quoteId: inspection.quoteId, depositAddress: inspection.depositAddress } } as any);
  const sourceCall = { chainId: 8453 as const, from: sender as `0x${string}`,
    to: inspection.transactionTarget, valueAtomic: "0", data: quote.transactionRequest.data as `0x${string}`,
    dataSha256: inspection.calldataSha256, type: "eip1559" as const, nonceAtomic: "7",
    gasLimitAtomic: BigInt(quote.transactionRequest.gasLimit).toString(),
    maxFeePerGasAtomic: "3", maxPriorityFeePerGasAtomic: "1", accessList: [] as const };
  const body = { kind: "read_only_near_tron_source_preparation" as const, executionAdmitted: false as const,
    evidenceTrust: "untrusted_quote_and_rpc" as const, draftIntegrityHash: draft.integrityHash,
    quoteHash, quoteId: inspection.quoteId, preflightBlockHash: `0x${"e".repeat(64)}` as `0x${string}`,
    sourceCall, maxSourceNativeDebitWei: draft.maxSourceNativeDebitWei };
  const preparation: NearTronSourcePreparation = { ...body, preparationDigest: hashObject(body) };
  return { draft, quote, preparation, profileHash, operationId, createdAt, syntheticAdmission: admission };
}
function rehash(preparation: NearTronSourcePreparation): NearTronSourcePreparation {
  const { preparationDigest: _, ...body } = preparation;
  return { ...body, preparationDigest: hashObject(body) };
}

test("pure projection maps the exact envelope and gives a stable separate protocol hash", () => {
  const input = fixture();
  const first = bindNearTronSourcePreparationToJournal(input);
  const again = bindNearTronSourcePreparationToJournal(input);
  assert.deepEqual(first, again);
  assert.equal(first.executionAdmitted, false);
  assert.equal(first.evidenceTrust, "untrusted_quote_and_rpc");
  assert.equal(first.binding.sourceCall.nonceAtomic, "7");
  assert.equal(first.binding.sourceCall.gasLimitAtomic, input.preparation.sourceCall.gasLimitAtomic);
  assert.equal(first.binding.sourceCall.maxFeePerGasAtomic, "3");
  assert.equal(first.binding.sourceCall.maxPriorityFeePerGasAtomic, "1");
  assert.equal(first.binding.sourceCall.dataSha256, sha256(Buffer.from(first.binding.sourceCall.data.slice(2), "hex")));
  assert.deepEqual(first.binding.sourceCall.accessList, []);
  assert.equal(first.binding.maxSourceNativeDebitWei, input.preparation.maxSourceNativeDebitWei);
  assert.equal(first.binding.admissionProof.kind, "synthetic_untrusted");
  assert.notEqual(first.protocolInputHash, first.binding.admissionProof.claimedValidationHash);
  assert.deepEqual(Object.keys(first.binding).sort(), ["profileHash", "operationId", "draftIntegrityHash", "route",
    "createdAt", "sourceCall", "maxSourceNativeDebitWei", "admissionProof"].sort());
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.binding) && Object.isFrozen(first.binding.sourceCall));
});
test("NEAR projection stages its exact protocol hash in v2", async t => {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const projected = bindNearTronSourcePreparationToJournal(fixture());
  const repo = new NonEvmSourceJournalRepository(tmp.root);
  const j = await repo.stageV2({ ...projected.binding,
    schemaVersion: "apn.non-evm-source-journal.v2", protocolInputHash: projected.protocolInputHash });
  assert.equal(j.protocolInputHash, projected.protocolInputHash);
  assert.equal(j.executionAdmitted, false);
  const loaded = await new NonEvmSourceJournalRepository(tmp.root).load(j.profileHash, j.operationId);
  assert.equal(loaded?.schemaVersion, "apn.non-evm-source-journal.v2");
  if (loaded?.schemaVersion !== "apn.non-evm-source-journal.v2") throw new Error("missing v2");
  assert.equal(loaded.protocolInputHash, projected.protocolInputHash);
});

test("drift in preparation, quote, recipient, envelope and synthetic context fails or changes binding hash", () => {
  const input = fixture();
  const mutate = (changes: Partial<NearTronSourcePreparation>) => rehash({ ...input.preparation, ...changes });
  assert.throws(() => bindNearTronSourcePreparationToJournal({ ...input,
    preparation: { ...input.preparation, sourceCall: { ...input.preparation.sourceCall, nonceAtomic: "8" } } }));
  for (const changes of [
    { sourceCall: { ...input.preparation.sourceCall, nonceAtomic: "8", dataSha256: "f".repeat(64) } },
    { sourceCall: { ...input.preparation.sourceCall, gasLimitAtomic: "1" } },
    { sourceCall: { ...input.preparation.sourceCall, accessList: ["bad"] } as any },
    { sourceCall: { ...input.preparation.sourceCall, maxFeePerGasAtomic: "99999999999999999" } },
    { preflightBlockHash: "bad" as any },
  ]) assert.throws(() => bindNearTronSourcePreparationToJournal({ ...input, preparation: mutate(changes) }));
  assert.throws(() => bindNearTronSourcePreparationToJournal({ ...input, quote: { ...input.quote, id: "mutated" } }));
  assert.throws(() => bindNearTronSourcePreparationToJournal({ ...input,
    quote: { ...input.quote, action: { ...input.quote.action, toAddress: "TQjXzKYMsbfGPezxMPt2ZQ6n3NNmd9u3cA" } } }));
  assert.throws(() => bindNearTronSourcePreparationToJournal({ ...input, operationId: "f".repeat(64) }));
  const altered = bindNearTronSourcePreparationToJournal({ ...input,
    syntheticAdmission: { ...admission, backendSigner: "0x4444444444444444444444444444444444444444" } });
  assert.notEqual(altered.protocolInputHash, bindNearTronSourcePreparationToJournal(input).protocolInputHash);
  assert.throws(() => bindNearTronSourcePreparationToJournal({ ...input,
    syntheticAdmission: { ...admission, facetCodeHash: "0xinvalid" } }));
});
