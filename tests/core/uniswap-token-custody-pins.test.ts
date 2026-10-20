import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ApnError } from "../../src/errors.js";
import { StateStore } from "../../src/state.js";
import { UniswapTokenCustody } from "../../src/swap/uniswap-v3/token-custody.js";
import { UniswapTokenNonceStore } from "../../src/swap/uniswap-v3/token-nonce.js";
import { validateUniswapTokenOperation, type UniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { temporaryState } from "./helpers.js";
import { blockHash, movingNode, tokenSession, WRAPPING } from "./uniswap-token-qa0552-harness.js";

const LIVE = JSON.parse(readFileSync("tests/core/fixtures/uniswap-token-qa0552.json", "utf8")) as { stranded: { operation: UniswapTokenOperation } };
const hex = (value: bigint) => `0x${value.toString(16)}`;

test("the cleaned decision's allowance read needs a head that includes the approval and is pinned to that head by hash", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root); await state.initialize();
  const op = validateUniswapTokenOperation(LIVE.stranded.operation), approval = op.approvalAttempt!.transactionHash!, block = 26_232_480n;
  const chain = movingNode({ account: op.account, allowance: "0", pending: 10n });
  const custody = () => new UniswapTokenCustody(state, WRAPPING, tokenSession(state, chain, 4), () => new Date());
  const behind = (error: ApnError) => error.code === "APN_RPC_PROTOCOL" && error.details?.reason === "uniswap_token_allowance_head_behind_effect";

  // A lagging node: first it does not know the approval, then it knows it above its own head. Either would answer the zero
  // allowance from before the approval, which is exactly what its unpinned latest read shows.
  chain.node.head = block - 20n;
  await assert.rejects(custody().currentAllowance(op, approval), behind);
  chain.node.txs.set(approval, { hash: approval, blockNumber: hex(block), blockHash: blockHash(block) });
  await assert.rejects(custody().currentAllowance(op, approval), behind);
  assert.deepEqual(chain.node.calls, [], "nothing is read at a head below the approval");
  assert.equal(await custody().currentAllowance(op), "0");

  // Caught up: the head includes the approval; the read is pinned to that head's hash (EIP-1898) and shows the standing approval.
  chain.node.head = block + 5n; chain.node.allowance = op.route.amountIn; chain.node.calls.length = 0;
  assert.equal(await custody().currentAllowance(op, approval), op.route.amountIn);
  assert.deepEqual(chain.node.calls.map((params) => params[1]), [{ blockHash: blockHash(block + 6n), requireCanonical: true }]);
});

test("custody frees a nonce only from a reservation no signed effect committed; a committed one counts as signed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const state = new StateStore(temporary.root); await state.initialize();
  const op = validateUniswapTokenOperation(LIVE.stranded.operation), nonces = new UniswapTokenNonceStore(temporary.root);
  const custody = new UniswapTokenCustody(state, WRAPPING, async () => { throw new Error("custody reads no RPC here"); }, () => new Date());
  await nonces.allocate(op, "approval", 9n); await nonces.commit(op, "approval", "9"); assert.equal(await nonces.allocate(op, "swap", 10n), "10");
  // Custody holds no bytes for either effect (no wallet, no effect journal): only the reservation tells them apart.
  assert.equal(await custody.releaseNonce(op, "approval", "9"), false, "committed: its signed effect may exist elsewhere");
  assert.equal(await custody.releaseNonce(op, "swap", "10"), true);
  assert.equal(await custody.releaseNonce(op, "swap", "10"), true, "a free slot stays free");
  assert.deepEqual(await nonces.occupied(op.account), [9n]);
});
