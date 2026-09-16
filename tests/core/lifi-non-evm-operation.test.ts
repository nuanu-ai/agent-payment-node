import assert from "node:assert/strict";
import test from "node:test";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "../../src/lifi/circle-v2-source-receipt.js";
import { BRIDGE_DIAMOND } from "../../src/lifi/validation.js";
import { freezeNonEvmBridgeOperation, NonEvmBridgeOperationRepository,
  validateNonEvmBridgeOperation, type NonEvmBridgeOperationInput } from "../../src/lifi/non-evm-operation.js";
import { temporaryState } from "./helpers.js";

const H = "a".repeat(64), W = `0x${"b".repeat(64)}` as const;
const owner = "0x1111111111111111111111111111111111111111";
const source = { chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  owner, amountAtomic: "1000000" } as const;
const common = { schemaVersion: "apn.non-evm-bridge-operation.v1", kind: "non_evm_bridge_intent",
  executionAdmitted: false, state: "frozen", profileHash: H, operationId: H, requestHash: H,
  createdAt: "2026-09-16T00:00:00.000Z", expiresAt: "2026-09-16T00:05:00.000Z", source,
  maxSourceNativeDebitWei: "1000000000000000", maxProviderFeeAtomic: "10000" } as const;
const circle: NonEvmBridgeOperationInput = { ...common, route: "base_usdc_to_solana_usdc_circle_cctp_v2",
  destination: { chain: "solana-mainnet", token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    recipient: "11111111111111111111111111111111", minimumReceivedAtomic: "900000" },
  sourceCall: { chainId: 8453, from: owner, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
    valueAtomic: "0", data: "0xc62fa55e" },
  provider: { kind: "circle_cctp_v2", feeQuoteHash: H, requestId: "circle-quote-1", sourceDomain: 6, destinationDomain: 5 } };
const near: NonEvmBridgeOperationInput = { ...common, route: "base_usdc_to_tron_usdt_lifi_near_intents",
  destination: { chainId: 728126428, token: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    recipient: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", minimumReceivedAtomic: "800000" },
  sourceCall: { chainId: 8453, from: owner, to: BRIDGE_DIAMOND, valueAtomic: "0", data: "0x3110c7b9" },
  provider: { kind: "lifi_near_intents", quoteHash: H, routeId: "route-1", stepId: "step-1",
    transactionId: W, quoteId: W, depositAddress: owner } };

for (const input of [circle, near]) test(`${input.route} immutable durable round trip`, async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const repo = new NonEvmBridgeOperationRepository(temp.root), op = freezeNonEvmBridgeOperation(input);
  await repo.save(op);
  assert.deepEqual(await repo.load(op.profileHash, op.operationId), op);
  await repo.save(op);
  assert.equal(op.executionAdmitted, false);
  const changed = { ...op, maxProviderFeeAtomic: "10001" };
  assert.throws(() => validateNonEvmBridgeOperation(changed), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateNonEvmBridgeOperation({ ...op, route: "wrong" }), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateNonEvmBridgeOperation({ ...op, executionAdmitted: true }), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateNonEvmBridgeOperation({ ...op, destination: { ...op.destination, chainId: 1 } }), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(repo.save(freezeNonEvmBridgeOperation({ ...input, maxProviderFeeAtomic: "10001" })), { code: "APN_STATE_CORRUPT" });
});

test("source call and provider cannot be swapped across pairs, even with a fresh integrity hash", () => {
  for (const [input, other] of [[circle, near], [near, circle]] as const) {
    const mixed = { ...input, destination: other.destination, provider: other.provider };
    assert.throws(() => freezeNonEvmBridgeOperation(mixed as NonEvmBridgeOperationInput), { code: "APN_STATE_CORRUPT" });
    assert.throws(() => freezeNonEvmBridgeOperation({ ...input, sourceCall: other.sourceCall } as NonEvmBridgeOperationInput), { code: "APN_STATE_CORRUPT" });
  }
});
