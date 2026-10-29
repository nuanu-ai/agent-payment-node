/**
 * QA 0.5.77 supplement to CIRCLE-OBSERVER-PUBLICATION-RACE-077-001: the same create-only race refused parallel reads of a
 * direct transfer's fee facts and a swap's economics facts (`receipt_facts_unavailable` / APN_STATE_SECURITY) until the
 * next read. Fixed in the secure store (0.5.78); these are the regressions at both sidecar stores and their status
 * helpers, with the winner's file still validated against the record. The receipts are the QA 0.5.51 captures.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DirectReceiptFactsStore, directActualFee, directFeeFromReceipt } from "../../src/direct-receipt-facts.js";
import type { FinalizedChainRead } from "../../src/evm-finalized-proof.js";
import { validateSwapOperation } from "../../src/swap/model.js";
import { SwapReceiptFactsStore, swapActualEconomics } from "../../src/swap/receipt-facts.js";
import { uniswapEconomicsFromReceipt } from "../../src/swap/uniswap-receipt-facts.js";
import { racedAtSync } from "./atomic-race-helpers.js";
import { temporaryState } from "./helpers.js";

const fixture = async (name: string) => JSON.parse(await readFile(`tests/fixtures/qa0551/${name}`, "utf8")) as Record<string, any>;
const now = new Date("2026-10-29T12:00:00.000Z");
const sei = await fixture("direct-sei-usdc-ca0c90b1.json"), uniswap = await fixture("uniswap-eth-usdc-30448bcb.json");
/** The fields of a completed direct record this sidecar binds (as in direct-receipt-facts.test.ts). */
const direct = { operationId: sei.operationId, integrityHash: "a".repeat(64), state: "completed", chainId: 1329, transactionHash: sei.receipt.transactionHash,
  economics: { gasLimitAtomic: BigInt(sei.transaction.gas).toString(), maxFeePerGasAtomic: BigInt(sei.transaction.maxFeePerGas).toString() } } as never;
const directReceipt = { blockNumberAtomic: BigInt(sei.receipt.blockNumber).toString(), evmEvidence: { blockHash: sei.receipt.blockHash } } as never;
const fee = directFeeFromReceipt(direct, directReceipt, sei.receipt);
const swap = validateSwapOperation(uniswap.record), economics = uniswapEconomicsFromReceipt(swap, uniswap.receipt, uniswap.finalizedHead);
/** Sei at the finalized tag: chain id and the transfer's receipt, each read counted. */
function seiRead(reads: string[]): (chainId: number) => FinalizedChainRead {
  return () => ({ async call(method) {
    reads.push(method);
    if (method === "eth_chainId") return "0x531";
    if (method === "eth_getTransactionReceipt") return structuredClone(sei.receipt);
    throw new Error(`unexpected ${method}`);
  } });
}
const parallel = <T>(call: () => Promise<T>) => Promise.all(Array.from({ length: 8 }, call));

test("parallel first reads of a direct transfer's fee all return it; the facts are written once and read with no RPC after", async (t) => {
  for (let round = 0; round < 2; round++) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const stored = await parallel(() => new DirectReceiptFactsStore(temporary.root).create(direct, fee, now.toISOString()));
    assert.equal(new Set(stored.map(facts => facts.integrityHash)).size, 1, `round ${round}`);
    const other = await temporaryState(); t.after(other.cleanup);
    const reads: string[] = [];
    const views = await parallel(() => directActualFee(other.root, seiRead(reads), direct, async () => directReceipt, now));
    assert.deepEqual(views.map(view => [view.fee?.totalFeeAtomic, view.refusal]), Array(8).fill([fee.totalFeeAtomic, undefined]), `round ${round}`);
    const replay: string[] = [];
    assert.deepEqual((await directActualFee(other.root, seiRead(replay), direct, async () => directReceipt, now)).fee, fee);
    assert.deepEqual(replay, [], "the recorded facts are read from disk only");
  }
});

test("parallel first reads of a swap's economics all return them; the facts are written once and read with no RPC after", async (t) => {
  for (let round = 0; round < 2; round++) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const stored = await parallel(() => new SwapReceiptFactsStore(temporary.root).create(swap, economics, now.toISOString()));
    assert.equal(new Set(stored.map(facts => facts.integrityHash)).size, 1, `round ${round}`);
    const other = await temporaryState(); t.after(other.cleanup);
    let reads = 0;
    const views = await parallel(() => swapActualEconomics(other.root, swap, async () => { reads++; return economics; }, now));
    assert.deepEqual(views.map(view => [view.actualEconomics, view.actualFactsRefusal]), Array(8).fill([economics, undefined]), `round ${round}`);
    const before = reads;
    assert.deepEqual((await swapActualEconomics(other.root, swap, async () => { reads++; return economics; }, now)).actualEconomics, economics);
    assert.equal(reads, before, "the recorded facts are read from disk only");
  }
});

test("facts another writer publishes inside this write are returned after validation; facts of another record are refused", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const winner = () => new DirectReceiptFactsStore(temporary.root).create(direct, fee, now.toISOString());
  const lost = await racedAtSync(winner, () => new DirectReceiptFactsStore(temporary.root).create(direct, fee, new Date(now.getTime() + 1).toISOString()));
  assert.equal(lost.observedAt, now.toISOString(), "the loser shows the winner's file");
  // The winner's file belongs to this operation's record: a record with another integrity hash cannot adopt it.
  const changed = { ...(direct as object), integrityHash: "b".repeat(64) } as never;
  const rivalRoot = await temporaryState(); t.after(rivalRoot.cleanup);
  await racedAtSync(() => new DirectReceiptFactsStore(rivalRoot.root).create(direct, fee, now.toISOString()),
    async () => await assert.rejects(new DirectReceiptFactsStore(rivalRoot.root).create(changed, fee, now.toISOString()), { code: "APN_STATE_CORRUPT" }));
  const views = await racedAtSync(() => new SwapReceiptFactsStore(temporary.root).create(swap, economics, now.toISOString()),
    () => swapActualEconomics(temporary.root, swap, async () => economics, new Date(now.getTime() + 1)));
  assert.deepEqual([views.actualEconomics, views.actualFactsRefusal], [economics, undefined]);
});
