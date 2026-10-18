import assert from "node:assert/strict";
import test from "node:test";
import { checkNeverLands, type SignedEffectFacts } from "../../src/evm-finalized-proof.js";
import { ERA, ERA_PROBE, finalizedNode } from "./finalized-node.js";

/**
 * R4 exit 2 counts a null lookup only from a node whose transaction index provably reaches the effect's era: a node that
 * prunes its index (geth `--history.transactions`) answers null for a transaction that landed before its window.
 */
const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", EFFECT = `0x${"77".repeat(32)}`;
const effect = (extra: Partial<SignedEffectFacts> = {}): SignedEffectFacts =>
  ({ chainId: 8453, account: ACCOUNT, nonce: 7n, transactionHash: EFFECT, before: { hash: ERA.hash, number: ERA.number }, ...extra });
const FIRST = ["eth_chainId", "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash"];
const DECIDING = ["eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getTransactionByHash"];
/** The era step: the block's transaction count and first transaction, one POST of block data (never a whole body). */
const ERA_STEP = ["eth_getBlockTransactionCountByNumber", "eth_getTransactionByBlockNumberAndIndex"];

test("a node whose index starts after the era answers null for an effect that landed: never-lands is not proven", async () => {
  // The effect landed ten blocks after the era; the node indexes only the last blocks, so it knows neither it nor a receipt.
  const node = finalizedNode(8453, () => 8n, { indexFrom: ERA.number + 1_000n, landed: { [EFFECT]: ERA.number + 10n } });
  assert.deepEqual(await checkNeverLands(effect(), node.batch), { neverLands: false, finalizedNonce: 8n, receiptFound: false, transactionKnown: false });
  assert.deepEqual(node.batches, [FIRST, ERA_STEP, DECIDING], "the era block's first transaction is read, and looked up in the deciding batch");
  // The same pruned node cannot tell a never-landed effect from that one either.
  const unknown = finalizedNode(8453, () => 8n, { indexFrom: ERA.number + 1n });
  assert.equal((await checkNeverLands(effect(), unknown.batch)).neverLands, false);
});

test("a node that indexes the era proves an effect it does not know never lands, in one deciding batch", async () => {
  const node = finalizedNode(8453, () => 8n, { indexFrom: ERA.number });
  assert.deepEqual(await checkNeverLands(effect(), node.batch), { neverLands: true, finalizedNonce: 8n });
  assert.deepEqual(node.batches, [FIRST, ERA_STEP, DECIDING]);
  // The same node knows the effect once it landed after the era: observation, not an exit, decides it.
  const landed = finalizedNode(8453, () => 8n, { landed: { [EFFECT]: ERA.number + 10n } });
  assert.deepEqual(await checkNeverLands(effect(), landed.batch), { neverLands: false, finalizedNonce: 8n, receiptFound: true, transactionKnown: true });
  assert.equal(landed.batches.length, 1);
});

test("a record that kept only the era hash is read by hash; a record that kept no era block never proves never-lands", async () => {
  const byHash = finalizedNode(8453, () => 8n);
  assert.deepEqual(await checkNeverLands(effect({ before: { hash: ERA.hash } }), byHash.batch), { neverLands: true, finalizedNonce: 8n });
  assert.deepEqual(byHash.batches[1], ["eth_getBlockTransactionCountByHash", "eth_getTransactionByBlockHashAndIndex"]);
  const none = finalizedNode(8453, () => 8n);
  const { before: _before, ...bare } = effect();
  assert.deepEqual(await checkNeverLands(bare, none.batch), { neverLands: false, finalizedNonce: 8n, receiptFound: false, transactionKnown: false });
  assert.equal(none.batches.length, 1, "nothing beyond the first batch is read");
});

test("an era block the node does not hold as canonical, or that holds no transaction, proves nothing (no body is read)", async () => {
  for (const eraBody of ["absent", "reorged", "empty"] as const) {
    const node = finalizedNode(8453, () => 8n, { eraBody });
    assert.equal((await checkNeverLands(effect(), node.batch)).neverLands, false, eraBody);
    assert.equal(node.batches.length, 2, `${eraBody}: no deciding batch`);
  }
  // Read by hash, a node answering another block is a protocol violation, never a proof.
  const lying = finalizedNode(8453, () => 8n, { era: { number: ERA.number, hash: `0x${"0d".repeat(32)}` } });
  await assert.rejects(checkNeverLands(effect({ before: { hash: `0x${"0d".repeat(32)}` } }), async calls => {
    const rows = await lying.batch(calls);
    return calls[0]!.method === "eth_getBlockTransactionCountByHash" ? ["0x1", { hash: ERA_PROBE, blockHash: ERA.hash, blockNumber: "0x1" }] : rows;
  }), { code: "APN_RPC_PROTOCOL" });
});

test("a nonce not past, a known transaction, a receipt or a pending effect end the check after the first batch", async () => {
  const cases = [finalizedNode(8453, () => 7n), finalizedNode(8453, () => 8n, { landed: { [EFFECT]: ERA.number + 1n } }),
    finalizedNode(8453, () => 8n, { pending: [EFFECT] })];
  for (const node of cases) {
    assert.equal((await checkNeverLands(effect(), node.batch)).neverLands, false);
    assert.equal(node.batches.length, 1);
  }
  await assert.rejects(checkNeverLands(effect({ chainId: 10 }), finalizedNode(8453, () => 8n).batch), { code: "APN_CHAIN_MISMATCH" });
});
