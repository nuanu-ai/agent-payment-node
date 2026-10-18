import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, type Hex } from "viem";
import { hashObject } from "../../src/canonical.js";
import { CIRCLE_SOURCE_TOKEN } from "../../src/circle-v2-evm/catalog.js";
import { circleAmbiguousOutcome, circleSentOutcome } from "../../src/circle-v2-evm/funding-never-lands.js";
import { circleEnvelope, type CircleEffect } from "../../src/circle-v2-evm/operation-model.js";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import { ERA, finalizedNode, type FinalizedNodeOptions } from "./finalized-node.js";

/**
 * Circle V2 EVM funding on the shared never-lands rule (T1 index coverage): a possibly-sent effect ends only from a node
 * that indexes the era block its envelope recorded (hash-bound) before signing; an envelope without one never proves it.
 */
const from = getAddress(`0x${"aa".repeat(20)}`), hash = `0x${"77".repeat(32)}` as Hex;
const envelope = (era: boolean) => circleEnvelope({ chainId: 42161, from, to: CIRCLE_SOURCE_TOKEN, data: "0x095ea7b3", valueAtomic: "0", nonceAtomic: "7",
  gasLimitAtomic: "50000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0", ...(era ? { eraBlock: { numberAtomic: ERA.number.toString(), hash: ERA.hash as Hex } } : {}) });
const effect = (era = true): CircleEffect => ({ role: "approval", phase: "unknown", envelope: envelope(era), transactionHash: hash, materialHash: "9".repeat(64), proof: null });
const reader = (finalized: bigint, options: FinalizedNodeOptions = {}, latest = finalized) => {
  const node = finalizedNode(42161, () => finalized, options);
  return { node, rpc: { chainId: 42161, finalizedBatch: async (calls: Parameters<typeof node.batch>[0]) => {
    // The resend check reads the latest nonce on its own; every other row is the finalized-tag node's answer.
    if (calls.length === 1 && calls[0]!.method === "eth_getTransactionCount" && calls[0]!.params[1] === "latest") return [`0x${latest.toString(16)}`];
    return await node.batch(calls);
  } } };
};

test("a possibly-sent approval or burn never lands only from a node indexing its envelope's era block", async () => {
  assert.equal(await circleSentOutcome(reader(8n).rpc, effect()), "never_lands");
  assert.equal(await circleSentOutcome(reader(8n, { indexFrom: ERA.number + 1n }).rpc, effect()), "not_proven", "a pruned node proves nothing");
  assert.equal(await circleSentOutcome(reader(8n, { indexFrom: ERA.number + 1_000n, landed: { [hash]: ERA.number + 5n } }).rpc, effect()), "not_proven",
    "an approval that landed before the node's index window is not taken for one that never did");
  const old = reader(8n);
  assert.equal(await circleSentOutcome(old.rpc, effect(false)), "not_proven", "an envelope frozen before eras were recorded");
  assert.equal(old.node.batches.length, 1);
  assert.equal(await circleSentOutcome(reader(8n, { landed: { [hash]: ERA.number + 5n } }).rpc, effect()), "own_transaction_known");
  assert.equal(await circleSentOutcome(reader(7n).rpc, effect()), "not_proven");
});

test("a possibly-sent mint or cleanup: resend only below the finalized and latest nonces, wait when the nonce moved without proof", async () => {
  assert.equal(await circleAmbiguousOutcome(reader(7n, {}, 7n).rpc, effect()), "resend_identical");
  assert.equal(await circleAmbiguousOutcome(reader(7n, {}, 8n).rpc, effect()), "other_transaction_pending");
  assert.equal(await circleAmbiguousOutcome(reader(8n, { indexFrom: ERA.number + 1n }).rpc, effect()), "other_transaction_pending");
  assert.equal(await circleAmbiguousOutcome(reader(8n).rpc, effect(false)), "other_transaction_pending");
  assert.equal(await circleAmbiguousOutcome(reader(8n).rpc, effect()), "never_lands");
  assert.equal(await circleAmbiguousOutcome(reader(8n, { pending: [hash] }).rpc, effect()), "own_transaction_known");
});

test("a new envelope records its era block inside envelopeHash, and the batch reader sends one POST per batch", async () => {
  const posts: { method: string; params: unknown[] }[][] = [];
  const https = { request: async (_url: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
    const rows = Array.isArray(parsed) ? parsed : [parsed]; posts.push(rows.map(r => ({ method: r.method, params: r.params })));
    const answer = (method: string) => method === "eth_chainId" ? "0xa4b1" : method === "eth_getBlockByNumber" ? { number: "0x3039", hash: ERA.hash, baseFeePerGas: "0x1" }
      : method === "eth_estimateGas" ? "0x5208" : method === "eth_getTransactionCount" ? "0x7" : null;
    const results = rows.map(r => ({ jsonrpc: "2.0", id: r.id, result: answer(r.method) }));
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? results : results[0]) };
  } };
  const rpc = new CircleRpc("https://arbitrum.example", 42161, https as never);
  const frozen = await rpc.envelope(from, CIRCLE_SOURCE_TOKEN, "0x095ea7b3", "7");
  assert.deepEqual(frozen.eraBlock, { numberAtomic: "12345", hash: ERA.hash });
  const { envelopeHash, ...body } = frozen;
  assert.equal(envelopeHash, hashObject(body), "the era is bound by the envelope hash");
  posts.length = 0;
  const rows = await rpc.finalizedBatch([{ method: "eth_getTransactionCount", params: [from, "finalized"] }, { method: "eth_getTransactionReceipt", params: [hash] },
    { method: "eth_getTransactionByHash", params: [hash] }]);
  assert.deepEqual([rows, posts.length, posts[0]!.length], [["0x7", null, null], 1, 3]);
});
