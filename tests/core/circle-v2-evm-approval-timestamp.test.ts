import assert from "node:assert/strict";
import test from "node:test";
import { approvalObservationFixture, savedApprovalProof } from "./circle-v2-evm-approval-public-fixture.js";
import { approvalReceiptIdentity, sealedBurnEvidence } from "../../src/circle-v2-evm/burn-retirement-rpc.js";
import { sealCircle, circleEnvelope } from "../../src/circle-v2-evm/operation-model.js";
import { initial } from "./circle-v2-evm-nonce-runtime-fixtures.js";
import type { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import type { CircleReceiptProof, CircleObservation } from "../../src/circle-v2-evm/protocol.js";
test("legacy retirement retains full raw transaction binding and never reconstructs optional timestamp", async () => {
  const parent = initial("/tmp/public-fixture-only", 1329, "evm-live-seller");
  const { envelopeHash: _hash, ...envelope } = parent.effects[0]!.envelope;
  const op = sealCircle({ ...parent, effects: parent.effects.map((e, i) => i === 0 ? { ...e, envelope: circleEnvelope({ ...envelope, nonceAtomic: "83", gasLimitAtomic: "68201", maxFeePerGasAtomic: "40300000", maxPriorityFeePerGasAtomic: "0" }), transactionHash: savedApprovalProof.transactionHash as `0x${string}`, proof: savedApprovalProof as CircleReceiptProof } : e) });
  const original = structuredClone(approvalObservationFixture) as CircleObservation;
  const source = { observation: async () => original, read: async () => 97924n, block: async () => original.canonicalBlock } as unknown as CircleRpc;
  await assert.rejects(sealedBurnEvidence(source, op, async () => "40100"), /retirement_original_approval_reorg/);
  assert.equal(Object.hasOwn(original.transaction as object, "blockTimestamp"), false);
});
test("authentic saved identity pins all original approval receipt and transaction fields", () => {
  assert.equal(approvalReceiptIdentity(savedApprovalProof as CircleReceiptProof), "b9af6f9f65b2fc0f3ac51f3cad9fa47c9411824c4dd646715b5dde0edba4827b");
});
